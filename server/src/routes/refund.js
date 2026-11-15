/**
 * POST /api/pay/refund —— 发起退款
 *
 * 契约要点：
 *  - refund_amount 必填；out_trade_no 和 trade_no 二选一
 *  - 累计退款金额不得超过原订单实付金额（本项目仅支持全额退款或一次部分退款 demo）
 *  - 新退款用新的 out_request_no；重试同一退款必须复用同一 out_request_no
 *  - code=10000 只代表受理成功；只有 fund_change=Y 才通常表示退款资金变化
 *  - fund_change=N 或缺失时必须用 out_request_no 查退款确认
 */
'use strict';

const express = require('express');
const crypto = require('crypto');
const { getRuntimeConfig, createAlipaySdk } = require('../config/alipay');
const { findByOutTradeNo, normalizeAmountText, ORDER_STATUS, updateOrder } = require('../services/orders');

const router = express.Router();

function genOutRequestNo(outTradeNo) {
  return `REFUND${outTradeNo}${crypto.randomBytes(2).toString('hex')}`;
}

router.post('/', express.json({ limit: '10kb' }), (req, res) => {
  (async () => {
    try {
      const cfg = getRuntimeConfig();
      if (cfg.missing.length > 0) {
        return res.status(503).json({ ok: false, code: 'CONFIG_NOT_READY' });
      }
      const { out_trade_no: outTradeNo, trade_no: tradeNo, refund_amount, out_request_no: outRequestNo, reason } = req.body;
      if (!outTradeNo && !tradeNo) return res.status(400).json({ ok: false, msg: 'out_trade_no 或 trade_no 必填' });
      if (!refund_amount) return res.status(400).json({ ok: false, msg: 'refund_amount 必填' });
      const normalizedRefund = normalizeAmountText(refund_amount);
      if (!normalizedRefund || normalizedRefund === '0.00') {
        return res.status(400).json({ ok: false, msg: 'refund_amount 非法' });
      }

      // 如果走 out_trade_no，先查本地订单校验退款金额不超过实付金额
      if (outTradeNo) {
        const order = findByOutTradeNo(outTradeNo);
        if (!order) return res.status(404).json({ ok: false, msg: '订单不存在' });
        if (order.status !== ORDER_STATUS.PAID) {
          return res.status(400).json({ ok: false, msg: '订单非 PAID 状态，不可退款' });
        }
        const paidBig = BigInt((order.totalAmount || '0').split('.')[0]);
        const refundBig = BigInt(normalizedRefund.split('.')[0]);
        if (refundBig > paidBig) {
          return res.status(400).json({ ok: false, msg: '退款金额超过实付金额' });
        }
      }

      const sdk = createAlipaySdk(cfg);
      // 新退款新 out_request_no；重试用原 out_request_no（此处由调用方传入）
      const requestNo = outRequestNo || genOutRequestNo(outTradeNo || 'UNKNOWN');
      const bizContent = { refund_amount: normalizedRefund, out_request_no: requestNo };
      if (outTradeNo) bizContent.out_trade_no = outTradeNo;
      if (tradeNo) bizContent.trade_no = tradeNo;
      if (reason) bizContent.refund_reason = reason.slice(0, 256);

      const result = await sdk.exec('alipay.trade.refund', { bizContent });
      if (!result || result.code !== '10000') {
        return res.json({ ok: false, alipay: result });
      }

      // 受理成功后 fundChange=Y 才通常表示退款资金变化
      // ⚠️ SDK exec() 返回驼峰字段
      if (outTradeNo) {
        const order = findByOutTradeNo(outTradeNo);
        // 数值累加 refundedAmount，用精确分计算避免浮点误差
        const prevCents = Math.round(parseFloat(order.refundedAmount || '0') * 100);
        const addCents = Math.round(parseFloat(normalizedRefund) * 100);
        const totalCents = prevCents + addCents;
        const refundedAmount = (totalCents / 100).toFixed(2);
        const history = (order.refundHistory || []).concat([{
          outRequestNo: requestNo,
          refundAmount: normalizedRefund,
          reason: reason || '',
          fundChange: result.fundChange || '',
          status: result.fundChange === 'Y' ? 'PROCESSED' : 'PENDING',
          createdAt: new Date().toISOString(),
        }]);
        const patch = {
          refundedAmount,
          refundHistory: history,
          updatedAt: new Date().toISOString(),
        };
        if (result.fundChange === 'Y') {
          patch.status = ORDER_STATUS.REFUNDED;
        }
        updateOrder(outTradeNo, patch);
      }

      return res.json({
        ok: true,
        outTradeNo: result.outTradeNo,
        tradeNo: result.tradeNo,
        outRequestNo: requestNo,
        refundAmount: normalizedRefund,
        fundChange: result.fundChange,
        tip: 'fundChange=N 或缺失时请用 GET /api/pay/refund-query?out_request_no=' + requestNo + ' 确认退款结果',
      });
    } catch (err) {
      return res.status(500).json({ ok: false, msg: err && err.message });
    }
  })();
});

module.exports = router;
