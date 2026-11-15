/**
 * GET /api/pay/refund-query —— 退款结果查询
 *
 * 契约要点：
 *  - out_request_no 必填；out_trade_no 或 trade_no 二选一
 *  - 退款查询发起时间不能离退款请求太短，建议至少间隔 10 秒
 *  - 只有 refund_status=REFUND_SUCCESS 表示退款成功
 */
'use strict';

const express = require('express');
const { getRuntimeConfig, createAlipaySdk } = require('../config/alipay');

const router = express.Router();

router.get('/', (req, res) => {
  (async () => {
    try {
      const cfg = getRuntimeConfig();
      if (cfg.missing.length > 0) return res.status(503).json({ ok: false, code: 'CONFIG_NOT_READY' });
      const { out_request_no: outRequestNo, out_trade_no: outTradeNo, trade_no: tradeNo } = req.query;
      if (!outRequestNo) return res.status(400).json({ ok: false, msg: 'out_request_no 必填' });
      if (!outTradeNo && !tradeNo) return res.status(400).json({ ok: false, msg: 'out_trade_no 或 trade_no 必填' });

      const sdk = createAlipaySdk(cfg);
      const bizContent = { out_request_no: outRequestNo };
      if (outTradeNo) bizContent.out_trade_no = outTradeNo;
      if (tradeNo) bizContent.trade_no = tradeNo;

      const result = await sdk.exec('alipay.trade.fastpay.refund.query', { bizContent });
      if (!result || result.code !== '10000') {
        return res.json({ ok: false, alipay: result });
      }
      return res.json({
        ok: true,
        // ⚠️ SDK exec() 返回驼峰字段；退款查询接口字段为 refundAmount（不是 refundFee）
        outTradeNo: result.outTradeNo,
        tradeNo: result.tradeNo,
        outRequestNo: result.outRequestNo,
        refundAmount: result.refundAmount,
        refundStatus: result.refundStatus,
        refundSuccess: result.refundStatus === 'REFUND_SUCCESS',
        raw: result,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, msg: err && err.message });
    }
  })();
});

module.exports = router;
