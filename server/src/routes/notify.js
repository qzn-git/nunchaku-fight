/**
 * POST /api/pay/notify —— 支付宝异步通知处理
 *
 * 关键契约（notify-url-contract.md）：
 *  1. 用 express.urlencoded({ extended: false }) 解析 application/x-www-form-urlencoded 表单
 *  2. SDK 验签：alipaySdk.checkNotifySignV2(params)
 *  3. 业务校验：app_id 匹配 + out_trade_no 匹配 + total_amount 字符串精确比较 + seller 匹配
 *  4. isPaidTradeNotification：TRADE_SUCCESS/FINISHED 且非退款事件（无 out_biz_no/gmt_refund/refund_fee）
 *  5. 幂等：insertNotifyOnce + markPaidIdempotently（持久化，不用内存 Map）
 *  6. 返回纯文本 success/fail（不是 JSON）；任何异常都返回 fail（让支付宝按策略重试）
 */
'use strict';

const express = require('express');
const { getRuntimeConfig, createAlipaySdk } = require('../config/alipay');
const {
  findByOutTradeNo,
  insertNotifyOnce,
  markPaidIdempotently,
  amountEquals,
} = require('../services/orders');

const router = express.Router();

/** 判断是否为付款成功事件：TRADE_SUCCESS 或 TRADE_FINISHED 且非退款/关单/分账事件 */
function isPaidTradeNotification(params) {
  const paidStatus = params.trade_status === 'TRADE_SUCCESS' || params.trade_status === 'TRADE_FINISHED';
  // 退款/关单/分账等事件特征字段
  const hasRefundFields = params.out_biz_no || params.gmt_refund || params.refund_fee;
  return paidStatus && !hasRefundFields;
}

/** 业务字段校验：app_id / out_trade_no / total_amount / seller 全部匹配 */
function businessFieldsMatch(order, params, cfg) {
  if (params.app_id !== cfg.appId) {
    console.warn('[notify] app_id 不匹配：notify=', params.app_id, 'cfg=', cfg.appId);
    return false;
  }
  if (params.out_trade_no !== order.outTradeNo) {
    console.warn('[notify] out_trade_no 不匹配');
    return false;
  }
  if (!amountEquals(order.totalAmount, params.total_amount)) {
    console.warn('[notify] total_amount 不匹配：order=', order.totalAmount, 'notify=', params.total_amount);
    return false;
  }
  const expectedSellerId = cfg.sellerId;
  const expectedSellerEmail = cfg.sellerEmail;
  const sellerOk = Boolean(
    (expectedSellerId && params.seller_id === expectedSellerId)
      || (expectedSellerEmail && params.seller_email === expectedSellerEmail)
      || (!expectedSellerId && !expectedSellerEmail) // 沙箱可能没配置 seller，跳过 seller 校验
  );
  if (!sellerOk) {
    console.warn('[notify] seller 不匹配');
    return false;
  }
  return true;
}

function safeLogError(message, params) {
  try {
    const safe = { ...(params || {}) };
    delete safe.sign; // sign 不入日志
    console.warn('[notify]', message, safe);
  } catch (_) { /* 日志失败不影响返回 fail */ }
}

router.use(express.urlencoded({ extended: false }));

router.post('/', async (req, res) => {
  const params = { ...(req.body || {}) };
  let sdk = null;

  try {
    const cfg = getRuntimeConfig();

    // 1. 运行时配置检查
    if (cfg.missing.length > 0) {
      safeLogError('支付配置不完整', params);
      return res.type('text/plain').send('fail');
    }

    sdk = createAlipaySdk(cfg);

    // 2. SDK 验签（checkNotifySignV2 必须存在，已在开发前验证过）
    const verifyOk = await Promise.resolve(sdk.checkNotifySignV2(params));
    if (!verifyOk) {
      safeLogError('验签失败', params);
      return res.type('text/plain').send('fail');
    }

    // 3. 查本地订单
    const order = findByOutTradeNo(params.out_trade_no);
    if (!order) {
      safeLogError('本地订单不存在', params);
      return res.type('text/plain').send('fail');
    }

    // 4. 业务字段校验
    if (!businessFieldsMatch(order, params, cfg)) {
      safeLogError('业务校验失败', params);
      return res.type('text/plain').send('fail');
    }

    // 5. 幂等插入通知事件
    const inserted = insertNotifyOnce({
      notifyId: params.notify_id,
      tradeNo: params.trade_no,
      outTradeNo: params.out_trade_no,
      tradeStatus: params.trade_status,
      rawParams: params,
    });
    if (!inserted) {
      // 已处理过本次通知，直接返回 success 让支付宝不再重试
      return res.type('text/plain').send('success');
    }

    // 6. 状态处理
    if (isPaidTradeNotification(params)) {
      markPaidIdempotently(order.outTradeNo, params.trade_no, params);
      console.info('[notify] 订单已支付：out_trade_no=', order.outTradeNo, 'trade_no=', params.trade_no);
    } else {
      // 非付款成功事件（退款、关单、WAIT_BUYER_PAY 等），记录但不改 PAID
      console.info('[notify] 非付款成功事件：trade_status=', params.trade_status, 'out_trade_no=', order.outTradeNo);
    }

    return res.type('text/plain').send('success');
  } catch (err) {
    safeLogError('异常', { ...params, _error: err && err.message });
    return res.type('text/plain').send('fail');
  }
});

module.exports = router;
