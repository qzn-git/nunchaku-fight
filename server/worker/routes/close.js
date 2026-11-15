/** POST /api/pay/close — 关单 */
import { buildAlipaySdk } from '../config/alipay.js';
import { Hono } from 'hono';
const route = new Hono();

route.post('/close', async (c) => {
  const body = await c.req.json();
  const outTradeNo = body.out_trade_no;
  if (!outTradeNo) return c.json({ code: 'MISSING_OUT_TRADE_NO' }, 400);

  const sdk = buildAlipaySdk(c.env);
  const r = await sdk.exec('alipay.trade.close', {
    bizContent: { out_trade_no: outTradeNo },
  });

  return c.json({
    ok: r.code === '10000',
    outTradeNo,
    tradeNo: r.tradeNo,
    msg: r.msg,
    subCode: r.subCode,
    subMsg: r.subMsg,
  });
});

export const closeRoute = route;
