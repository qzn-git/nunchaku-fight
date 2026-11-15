/**
 * GET /api/pay/return —— 支付宝同步回跳处理
 *
 * 注意：同步回跳只作跳转后的结果展示，不作为支付成功依据。
 * 页面应先展示"正在确认支付结果..."，再通过服务端主动查单（alipaySdk.exec('alipay.trade.query', ...)）
 * 确认最终状态，然后渲染相应 UI。以下实现内置查单 + 结果页。
 *
 * 契约要点：
 *  - 验签先做，不凭同步参数直接判成功
 *  - 主动查单兜底，交易查询用 exec 方法
 *  - 业务状态映射：TRADE_SUCCESS / TRADE_FINISHED = PAID
 */
'use strict';

const express = require('express');
const { getRuntimeConfig, createAlipaySdk } = require('../config/alipay');
const { findByOutTradeNo, markPaidIdempotently, amountEquals } = require('../services/orders');

const router = express.Router();

function renderResultPage({ paid, status, amount, outTradeNo, tradeNo }) {
  const title = paid ? '支付成功' : (status === 'WAIT_BUYER_PAY' ? '等待支付' : '支付状态未知');
  const color = paid ? '#22c55e' : '#f59e0b';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center}
.card{background:#fff;border-radius:12px;padding:32px 40px;box-shadow:0 4px 24px rgba(0,0,0,.08);text-align:center;min-width:360px}
.badge{display:inline-block;padding:6px 14px;border-radius:999px;background:${color}1a;color:${color};font-weight:600;font-size:14px;margin-bottom:12px}
.amount{font-size:36px;font-weight:700;color:#0f172a;margin:8px 0}
.meta{font-size:13px;color:#64748b;line-height:1.8;margin-top:16px;text-align:left}
.meta span{color:#334155;font-weight:500}
</style></head><body>
<div class="card">
  <div class="badge">${title}</div>
  <div class="amount">¥${amount || '—'}</div>
  <div class="meta">
    <div>交易号：<span>${tradeNo || '—'}</span></div>
    <div>订单号：<span>${outTradeNo || '—'}</span></div>
    <div>状态：<span>${status || '—'}</span></div>
    <div style="margin-top:12px;color:#94a3b8">如对结果有疑问，请刷新或重新查看订单记录</div>
  </div>
</div></body></html>`;
}

router.get('/', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const cfg = getRuntimeConfig();
    if (cfg.missing.length > 0) {
      return res.type('html').status(503).send(renderResultPage({ paid: false, status: 'CONFIG_NOT_READY' }));
    }

    // 支付宝同步回跳是 GET query string，SDK 验签 API checkNotifySignV2 兼容 GET 参数对象
    const params = { ...req.query };
    const sdk = createAlipaySdk(cfg);

    // 1. 验签（失败直接展示未知状态，不判成功）
    let verifyOk = false;
    try { verifyOk = await Promise.resolve(sdk.checkNotifySignV2(params)); } catch (_) { verifyOk = false; }
    if (!verifyOk) {
      return res.type('html').send(renderResultPage({
        paid: false, status: 'SIGN_INVALID',
        amount: '', outTradeNo: params.out_trade_no, tradeNo: '',
      }));
    }

    const outTradeNo = params.out_trade_no;
    const order = findByOutTradeNo(outTradeNo);
    if (!order) {
      return res.type('html').send(renderResultPage({
        paid: false, status: 'ORDER_NOT_FOUND',
        amount: params.total_amount, outTradeNo, tradeNo: '',
      }));
    }

    // 2. 业务字段校验
    if (!amountEquals(order.totalAmount, params.total_amount)) {
      return res.type('html').send(renderResultPage({
        paid: false, status: 'AMOUNT_MISMATCH',
        amount: params.total_amount, outTradeNo, tradeNo: '',
      }));
    }

    // 3. 主动查单兜底（即使异步通知已处理也查一次，以交易查询为准）
    const queryResult = await sdk.exec('alipay.trade.query', {
      bizContent: { out_trade_no: outTradeNo },
    });

    if (!queryResult || queryResult.code !== '10000') {
      return res.type('html').send(renderResultPage({
        paid: false, status: (queryResult && queryResult.sub_msg) || 'QUERY_FAILED',
        amount: order.totalAmount, outTradeNo, tradeNo: '',
      }));
    }

    // ⚠️ SDK exec() 返回驼峰字段
    const tradeStatus = queryResult.tradeStatus;
    const paid = tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED';

    // 如果查单确认已支付，幂等更新本地订单状态
    if (paid) {
      markPaidIdempotently(outTradeNo, queryResult.tradeNo, queryResult);
    }

    return res.type('html').send(renderResultPage({
      paid,
      status: tradeStatus,
      amount: order.totalAmount,
      outTradeNo,
      tradeNo: queryResult.tradeNo || '',
    }));
  } catch (err) {
    console.error('[return] error:', err && err.message);
    return res.type('html').status(500).send(renderResultPage({ paid: false, status: 'INTERNAL_ERROR' }));
  }
});

module.exports = router;
