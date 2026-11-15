/**
 * POST /api/pay/create — 创建打赏支付订单并返回 HTML 支付表单
 *
 * 流程：
 *  1. 解析请求体 { amount, subject?, userId?, attach? }
 *  2. 校验金额（范围 0.01 ~ 100000000，两位小数）
 *  3. 生成商户订单号 outTradeNo（MS + 随机数）
 *  4. 持久化订单（PENDING_PAYMENT）
 *  5. 用 alipaySdk.pageExec('alipay.trade.page.pay', 'POST', ...) 生成 HTML form
 *  6. 返回 { outTradeNo, paymentHtml } 给前端
 *
 * 防坑：必须使用 pageExec() + POST；notifyUrl 空则不传 SDK；total_amount 为字符串。
 */
'use strict';

const express = require('express');
const crypto = require('crypto');
const { buildAlipaySdk, getRuntimeConfig } = require('../config/alipay');
const { createOrder } = require('../services/orders');

const router = express.Router();

/** 订单号生成：nunchaku + MS 时间戳 + 4 位随机 hex */
function genOutTradeNo() {
  const ts = Date.now().toString();
  const rand = crypto.randomBytes(2).toString('hex');
  return `NUNCHAKU${ts}${rand}`;
}

/** 金额校验：0.01 ~ 100000000.00，最多两位小数，字符串精确比较 */
function validateAmount(raw) {
  if (raw == null || raw === '') return { ok: false, reason: 'amount 不能为空' };
  const text = String(raw).trim();
  const match = text.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return { ok: false, reason: 'amount 格式非法，需为两位小数以内的金额字符串' };

  const intPart = match[1]; // 整数部分（可能有前导0）
  const decPart = match[2] || ''; // 小数部分（可能为空）

  // 全零判断：整数部分是 0 且（无小数 或 小数全为 0）
  const isAllZero = /^0+$/.test(intPart) && (decPart === '' || /^0+$/.test(decPart));
  if (isAllZero) return { ok: false, reason: 'amount 必须大于 0' };

  // 整数部分去掉前导 0 后再判断上限
  const normalizedInt = BigInt(intPart).toString();
  const max = BigInt('100000000');
  if (BigInt(intPart) > max) return { ok: false, reason: 'amount 超过上限 100000000' };

  // 规范化为 X.YY 格式
  return { ok: true, amountText: `${normalizedInt}.${decPart.padEnd(2, '0')}` };
}

router.post('/create', express.json({ limit: '10kb' }), (req, res) => {
  try {
    const cfg = getRuntimeConfig();
    if (cfg.missing.length > 0) {
      return res.status(503).json({
        code: 'CONFIG_NOT_READY',
        msg: `支付配置不完整，缺失：${cfg.missing.join(', ')}`,
        env: cfg.isSandbox ? 'sandbox' : 'prod',
      });
    }

    const body = req.body || {};
    const amountCheck = validateAmount(body.amount);
    if (!amountCheck.ok) {
      return res.status(400).json({ code: 'INVALID_AMOUNT', msg: amountCheck.reason });
    }

    const subject = (body.subject || '双龙棍格斗 · 打赏').slice(0, 128);
    const userId = (body.userId || '').slice(0, 64);
    const attach = (body.attach || '').slice(0, 256);

    const outTradeNo = genOutTradeNo();
    const order = createOrder({
      outTradeNo,
      totalAmount: amountCheck.amountText,
      subject,
      userId,
      attach,
    });
    if (!order) {
      return res.status(409).json({ code: 'ORDER_DUP', msg: '订单号重复，请重试' });
    }

    const sdk = buildAlipaySdk();

    // ↓↓↓ 关键：网站支付必须用 pageExec() + POST，返回 HTML form 字符串 ↓↓↓
    const requestOptions = {
      returnUrl: cfg.baseReturnUrl,
      bizContent: {
        out_trade_no: outTradeNo,
        total_amount: amountCheck.amountText,
        subject,
        product_code: 'FAST_INSTANT_TRADE_PAY', // 网站支付固定值
      },
    };
    // notify_url 可选：空字符串代表未配置，直接不传 SDK（不写 undefined 也不写占位 URL）
    if (cfg.notifyUrl) {
      requestOptions.notifyUrl = cfg.notifyUrl;
    }

    const paymentHtml = sdk.pageExec('alipay.trade.page.pay', 'POST', requestOptions);

    return res.json({
      outTradeNo,
      paymentHtml,
      amount: amountCheck.amountText,
      subject,
      env: cfg.isSandbox ? 'sandbox' : 'prod',
      _note: '前端将 paymentHtml 渲染到 DOM 后自动 form.submit()，禁止直接 window.location = paymentHtml',
    });
  } catch (err) {
    console.error('[create-pay] error:', err && err.message, err && err.stack);
    return res.status(500).json({ code: 'INTERNAL', msg: err && err.message || 'unknown' });
  }
});

module.exports = router;
