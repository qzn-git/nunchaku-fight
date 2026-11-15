/** POST /api/pay/refund — 退款 */
import { buildAlipaySdk } from '../config/alipay.js';
import { getOrder, markRefunded } from '../services/orders.js';
import { Hono } from 'hono';
import crypto from 'crypto';
const route = new Hono();

route.post('/refund', async (c) => {
  const env = c.env;
  const body = await c.req.json();
  const outTradeNo = body.out_trade_no;
  const refundAmount = body.refund_amount;
  if (!outTradeNo || !refundAmount) return c.json({ code: 'MISSING_PARAM' }, 400);

  const kv = env.NUNCHAKU_ORDERS;
  const order = await getOrder(kv, outTradeNo);
  if (!order) return c.json({ code: 'ORDER_NOT_FOUND' }, 404);
  if (order.status !== 'PAID') return c.json({ code: 'ORDER_NOT_PAID', status: order.status }, 400);

  const outRequestNo = 'REFUND' + outTradeNo + crypto.randomBytes(3).toString('hex');
  const sdk = buildAlipaySdk(env);
  const r = await sdk.exec('alipay.trade.refund', {
    bizContent: {
      out_trade_no: outTradeNo,
      refund_amount: refundAmount,
      out_request_no: outRequestNo,
      refund_reason: body.reason || '用户申请退款',
    },
  });

  const fundChange = r.fundChange || r.fund_change;
  if (fundChange === 'Y') {
    await markRefunded(kv, outTradeNo, refundAmount, {
      outRequestNo,
      reason: body.reason,
      status: 'SUCCESS',
    });
  }

  return c.json({
    ok: fundChange === 'Y',
    outTradeNo,
    outRequestNo,
    refundAmount,
    fundChange,
    tradeNo: r.tradeNo,
    gmtRefundPay: r.gmtRefundPay,
    msg: r.msg,
  });
});

export const refundRoute = route;
