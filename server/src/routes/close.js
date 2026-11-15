/**
 * POST /api/pay/close —— 关闭未支付订单
 *
 * 契约要点：
 *  - out_trade_no 或 trade_no 二选一
 *  - 关闭成功后该交易不可继续支付
 *  - 不得主动发起真实生产关单，除非用户明确要求
 */
'use strict';

const express = require('express');
const { getRuntimeConfig, createAlipaySdk } = require('../config/alipay');
const { markClosed } = require('../services/orders');

const router = express.Router();

router.post('/', express.json({ limit: '10kb' }), (req, res) => {
  (async () => {
    try {
      const cfg = getRuntimeConfig();
      if (cfg.missing.length > 0) return res.status(503).json({ ok: false, code: 'CONFIG_NOT_READY' });
      const { out_trade_no: outTradeNo, trade_no: tradeNo } = req.body;
      if (!outTradeNo && !tradeNo) return res.status(400).json({ ok: false, msg: 'out_trade_no 或 trade_no 必填' });

      const sdk = createAlipaySdk(cfg);
      const bizContent = {};
      if (outTradeNo) bizContent.out_trade_no = outTradeNo;
      if (tradeNo) bizContent.trade_no = tradeNo;

      const result = await sdk.exec('alipay.trade.close', { bizContent });
      if (!result || result.code !== '10000') {
        return res.json({ ok: false, alipay: result });
      }

      if (outTradeNo) markClosed(outTradeNo);
      return res.json({ ok: true, alipay: result });
    } catch (err) {
      return res.status(500).json({ ok: false, msg: err && err.message });
    }
  })();
});

module.exports = router;
