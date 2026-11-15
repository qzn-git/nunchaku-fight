/** POST /api/pay/create — 创建订单 */
import { buildAlipaySdk, getEnvMeta } from '../config/alipay.js';
import { createOrder } from '../services/orders.js';
import { Hono } from 'hono';
const route = new Hono();

import crypto from 'crypto';

function genOutTradeNo() {
  const ts = Date.now().toString();
  const rand = crypto.randomBytes(2).toString('hex');
  return 'NUNCHAKU' + ts + rand;
}

function validateAmount(raw) {
  if (raw == null || raw === '') return { ok: false, reason: 'amount 不能为空' };
  const text = String(raw).trim();
  const match = text.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return { ok: false, reason: 'amount 格式非法' };
  const intPart = match[1];
  const decPart = match[2] || '';
  const isAllZero = /^0+$/.test(intPart) && (decPart === '' || /^0+$/.test(decPart));
  if (isAllZero) return { ok: false, reason: 'amount 必须大于 0' };
  const normalizedInt = BigInt(intPart).toString();
  return { ok: true, amountText: normalizedInt + '.' + decPart.padEnd(2, '0') };
}

route.post('/create', async (c) => {
  const env = c.env;
  const cfg = getEnvMeta(env);
  const body = await c.req.json();
  const amountCheck = validateAmount(body.amount);
  if (!amountCheck.ok) return c.json({ code: 'INVALID_AMOUNT', msg: amountCheck.reason }, 400);

  const subject = (body.subject || '双龙棍格斗 · 打赏').slice(0, 128);
  const outTradeNo = genOutTradeNo();
  const order = await createOrder(env.NUNCHAKU_ORDERS, {
    outTradeNo,
    totalAmount: amountCheck.amountText,
    subject,
    userId: (body.userId || '').slice(0, 64),
  });
  if (!order) return c.json({ code: 'ORDER_DUP', msg: '订单号重复' }, 409);

  const sdk = buildAlipaySdk(env);
  const opts = {
    returnUrl: cfg.baseReturnUrl,
    bizContent: {
      out_trade_no: outTradeNo,
      total_amount: amountCheck.amountText,
      subject,
      product_code: 'FAST_INSTANT_TRADE_PAY',
    },
  };
  if (cfg.notifyUrl) opts.notifyUrl = cfg.notifyUrl;

  const paymentHtml = sdk.pageExec('alipay.trade.page.pay', 'POST', opts);

  return c.json({
    ok: true,
    outTradeNo,
    paymentHtml,
    amount: amountCheck.amountText,
    subject,
    env: cfg.isSandbox ? 'sandbox' : 'prod',
  });
});

export const createPayRoute = route;
