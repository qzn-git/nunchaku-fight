/**
 * GET /api/pay/query —— 主动查单兜底
 *
 * 任何时候都可调用。即使未配置 notify_url 也必须有此路由作为支付结果确认的唯一依据。
 * 参数：out_trade_no 或 trade_no（二选一）
 */
'use strict';

const express = require('express');
const { getRuntimeConfig, createAlipaySdk } = require('../config/alipay');
const { findByOutTradeNo, markPaidIdempotently } = require('../services/orders');

const router = express.Router();

function mapStatus(alipayStatus) {
  return {
    TRADE_SUCCESS: 'PAID',
    TRADE_FINISHED: 'PAID',
    WAIT_BUYER_PAY: 'PENDING_PAYMENT',
    TRADE_CLOSED: 'CLOSED',
    TRADE_REFUND: 'REFUNDING',
  }[alipayStatus] || 'UNKNOWN';
}

router.get('/', (req, res) => {
  (async () => {
    try {
      const cfg = getRuntimeConfig();
      if (cfg.missing.length > 0) {
        return res.status(503).json({ code: 'CONFIG_NOT_READY', msg: '支付配置不完整' });
      }
      const { out_trade_no: outTradeNo, trade_no: tradeNo } = req.query;
      if (!outTradeNo && !tradeNo) {
        return res.status(400).json({ code: 'MISSING_PARAM', msg: 'out_trade_no 或 trade_no 必填' });
      }

      const sdk = createAlipaySdk(cfg);
      const bizContent = {};
      if (outTradeNo) bizContent.out_trade_no = outTradeNo;
      if (tradeNo) bizContent.trade_no = tradeNo;

      const result = await sdk.exec('alipay.trade.query', { bizContent });
      if (!result || result.code !== '10000') {
        return res.json({ ok: false, alipay: result });
      }

      // 如果已支付，幂等更新本地订单
      // ⚠️ alipay-sdk exec() 返回驼峰字段（tradeStatus），不是下划线
      if (result.tradeStatus === 'TRADE_SUCCESS' || result.tradeStatus === 'TRADE_FINISHED') {
        const localOrder = findByOutTradeNo(result.outTradeNo);
        if (localOrder && localOrder.status !== 'PAID') {
          markPaidIdempotently(result.outTradeNo, result.tradeNo, result);
        }
      }

      return res.json({
        ok: true,
        outTradeNo: result.outTradeNo,
        tradeNo: result.tradeNo,
        tradeStatus: result.tradeStatus,
        bizState: mapStatus(result.tradeStatus),
        totalAmount: result.totalAmount,
        buyerPayAmount: result.buyerPayAmount,
        sendPayDate: result.sendPayDate,
        raw: result,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, msg: err && err.message });
    }
  })();
});

module.exports = router;
