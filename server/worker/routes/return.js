/** GET /api/pay/return — 用户浏览器回跳 */
import { buildAlipaySdk } from '../config/alipay.js';
import { getOrder, markPaidIdempotently } from '../services/orders.js';
import { Hono } from 'hono';
const route = new Hono();

route.get('/return', async (c) => {
  const env = c.env;
  const params = c.req.query();
  const outTradeNo = params.out_trade_no;
  const kv = env.NUNCHAKU_ORDERS;
  const local = outTradeNo ? await getOrder(kv, outTradeNo) : null;

  let remote = null;
  try {
    const sdk = buildAlipaySdk(env);
    remote = await sdk.exec('alipay.trade.query', { bizContent: { out_trade_no: outTradeNo } });
    if (remote?.tradeStatus === 'TRADE_SUCCESS' || remote?.tradeStatus === 'TRADE_FINISHED') {
      await markPaidIdempotently(kv, outTradeNo, remote.tradeNo);
    }
  } catch (e) {}

  const ok = remote?.tradeStatus === 'TRADE_SUCCESS' || local?.status === 'PAID';
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>支付结果</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f5f5}
.box{background:#fff;padding:40px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.1);text-align:center;max-width:400px}
h1{margin:0 0 16px;font-size:24px}
.ok{color:#16a34a}.fail{color:#dc2626}
p{color:#666;margin:8px 0}
a{color:#3b82f6;text-decoration:none}</style></head>
<body><div class="box">
<h1 class="${ok ? 'ok' : 'fail'}">${ok ? '✅ 支付成功！' : '⚠️ 请稍后查单确认'}</h1>
<p>订单号：${outTradeNo || '-'}</p>
<p>金额：${local?.totalAmount || '-'} 元</p>
<p><a href="/">返回打赏页面</a></p>
</div></body></html>`;
  return c.html(html);
});

export const returnRoute = route;
