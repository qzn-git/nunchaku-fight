/** GET /api/pay/query — 主动查单 */
import { buildAlipaySdk } from '../config/alipay.js';
import { getOrder, markPaidIdempotently } from '../services/orders.js';
import { Hono } from 'hono';
const route = new Hono();

route.get('/query', async (c) => {
  const outTradeNo = c.req.query('out_trade_no');
  if (!outTradeNo) return c.json({ code: 'MISSING_OUT_TRADE_NO' }, 400);
  const env = c.env;
  const kv = env.NUNCHAKU_ORDERS;

  const local = await getOrder(kv, outTradeNo);
  if (!local) return c.json({ code: 'ORDER_NOT_FOUND', outTradeNo }, 404);

  const sdk = buildAlipaySdk(env);
  const remote = await sdk.exec('alipay.trade.query', { bizContent: { out_trade_no: outTradeNo } });
  const tradeStatus = remote?.tradeStatus || remote?.trade_status;

  let updated = local;
  if (tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED') {
    updated = await markPaidIdempotently(kv, outTradeNo,
      remote.tradeNo || remote.trade_no,
      { buyerId: remote.buyerUserId || remote.buyer_id }
    );
  }

  return c.json({
    ok: true,
    outTradeNo,
    tradeStatus,
    tradeNo: remote.tradeNo || remote.trade_no || null,
    localStatus: updated?.status || local.status,
    local,
  });
});

export const queryRoute = route;
