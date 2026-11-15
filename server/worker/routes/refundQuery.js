/** GET /api/pay/refund-query — 退款查询 */
import { buildAlipaySdk } from '../config/alipay.js';
import { Hono } from 'hono';
const route = new Hono();

route.get('/refund-query', async (c) => {
  const outTradeNo = c.req.query('out_trade_no');
  const outRequestNo = c.req.query('out_request_no');
  if (!outTradeNo || !outRequestNo) return c.json({ code: 'MISSING_PARAM' }, 400);

  const sdk = buildAlipaySdk(c.env);
  const r = await sdk.exec('alipay.trade.fastpay.refund.query', {
    bizContent: { out_trade_no: outTradeNo, out_request_no: outRequestNo },
  });

  const refundAmount = r.refundAmount || r.refund_fee || '0.00';
  const success = r.gmtRefundPay || r.gmt_refund_pay;

  return c.json({
    ok: r.code === '10000',
    outTradeNo,
    outRequestNo,
    refundAmount,
    refundStatus: success ? 'REFUND_SUCCESS' : (r.refundStatus || 'REFUND_PROCESSING'),
    refundSuccess: !!success,
    gmtRefundPay: success || null,
    raw: r,
  });
});

export const refundQueryRoute = route;
