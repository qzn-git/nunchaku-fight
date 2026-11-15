/** POST /api/pay/notify — 支付宝异步通知 */
import { buildAlipaySdk } from '../config/alipay.js';
import { markPaidIdempotently, insertNotifyOnce } from '../services/orders.js';
import { Hono } from 'hono';
const route = new Hono();

route.post('/notify', async (c) => {
  const env = c.env;
  const params = await c.req.formData();
  const obj = {};
  params.forEach((v, k) => { obj[k] = v; });

  const sdk = buildAlipaySdk(env);
  let signOk = false;
  try {
    signOk = await Promise.resolve(sdk.checkNotifySignV2(obj));
  } catch (e) {
    console.error('[notify] 验签异常:', e.message);
  }
  if (!signOk) return c.text('fail');

  const tradeStatus = obj.trade_status || obj.tradeStatus;
  const outTradeNo = obj.out_trade_no || obj.outTradeNo;
  const tradeNo = obj.trade_no || obj.tradeNo;
  const notifyId = obj.notify_id || obj.notifyId;

  if (!outTradeNo) return c.text('fail');

  // 幂等
  if (notifyId) {
    const first = await insertNotifyOnce(env.NUNCHAKU_ORDERS, notifyId, outTradeNo);
    if (!first) return c.text('success');
  }

  if (tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED') {
    await markPaidIdempotently(env.NUNCHAKU_ORDERS, outTradeNo, tradeNo, {
      buyerId: obj.buyer_id || obj.buyerId,
    });
  }

  return c.text('success');
});

export const notifyRoute = route;
