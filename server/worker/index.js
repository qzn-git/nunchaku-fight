/**
 * Workers 入口 — Hono 框架 + Cloudflare KV + alipay-sdk（nodejs_compat）
 *
 * 部署前置：
 *  1. wrangler login
 *  2. wrangler kv namespace create NUNCHAKU_ORDERS → 拿到 id
 *  3. wrangler.jsonc 里填入 kv id
 *  4. wrangler secret put ALIPAY_APP_PRIVATE_KEY  （粘贴 PKCS#1 裸B64）
 *  5. wrangler secret put ALIPAY_PUBLIC_KEY      （粘贴支付宝公钥）
 *  6. wrangler deploy
 *
 * 安全：所有密钥走 wrangler secret，永不明文写入 wrangler.jsonc
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { buildAlipaySdk, normalizePrivateKey } from './config/alipay.js';
import { createOrder, getOrder, markPaidIdempotently } from './services/orders.js';
import { createPayRoute } from './routes/create-pay.js';
import { queryRoute } from './routes/query.js';
import { returnRoute } from './routes/return.js';
import { notifyRoute } from './routes/notify.js';
import { refundRoute } from './routes/refund.js';
import { refundQueryRoute } from './routes/refundQuery.js';
import { closeRoute } from './routes/close.js';

const app = new Hono();
app.use('*', cors());

// ===== 健康检查 =====
app.get('/health', (c) => {
  const cfg = c.env;
  const missing = [];
  if (!cfg.ALIPAY_APP_ID) missing.push('ALIPAY_APP_ID');
  if (!cfg.ALIPAY_APP_PRIVATE_KEY) missing.push('ALIPAY_APP_PRIVATE_KEY');
  if (!cfg.ALIPAY_PUBLIC_KEY) missing.push('ALIPAY_PUBLIC_KEY');
  if (!cfg.ALIPAY_SELLER_ID) missing.push('ALIPAY_SELLER_ID');
  return c.json({
    ok: true,
    env: cfg.ALIPAY_SANDBOX === 'true' ? 'sandbox' : 'prod',
    missing,
    hasKv: !!cfg.NUNCHAKU_ORDERS,
    sdk: '4.0.0',
  });
});

// ===== 打赏前端页面（Worker 直接返回 HTML） =====
app.get('/', (c) => {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>🐉 双龙棍格斗 · 打赏</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:linear-gradient(135deg,#1a1a2e,#16213e);min-height:100vh;display:flex;align-items:center;justify-content:center;color:#fff}
.card{background:rgba(255,255,255,0.08);backdrop-filter:blur(10px);border-radius:20px;padding:40px;width:400px;text-align:center;border:1px solid rgba(255,255,255,0.1)}
h1{font-size:28px;margin-bottom:8px;background:linear-gradient(90deg,#ff6b6b,#feca57);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.sub{color:#aaa;margin-bottom:32px;font-size:14px}
.presets{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px}
.preset{background:rgba(255,255,255,0.1);border:2px solid transparent;border-radius:12px;padding:16px;font-size:18px;font-weight:600;cursor:pointer;transition:all .2s;color:#fff}
.preset:hover{background:rgba(255,255,255,0.2)}
.preset.active{border-color:#ff6b6b;background:rgba(255,107,107,0.2)}
.custom{margin-bottom:20px}
.custom input{width:100%;padding:14px;background:rgba(255,255,255,0.1);border:2px solid rgba(255,255,255,0.2);border-radius:12px;color:#fff;font-size:16px;text-align:center;outline:none}
.custom input:focus{border-color:#ff6b6b}
#payBtn{width:100%;padding:16px;background:linear-gradient(90deg,#ff6b6b,#ee5a52);border:none;border-radius:12px;color:#fff;font-size:18px;font-weight:600;cursor:pointer;transition:transform .1s,opacity .2s}
#payBtn:disabled{opacity:.4;cursor:not-allowed}
#payBtn:not(:disabled):hover{transform:translateY(-2px)}
.status{margin-top:16px;font-size:13px;color:#aaa;min-height:20px}
</style>
</head>
<body>
<div class="card">
  <h1>🐉 双龙棍格斗</h1>
  <div class="sub">支持开发者继续创作</div>
  <div class="presets">
    <button class="preset" onclick="selectPreset(this,'6.66')">¥6.66</button>
    <button class="preset" onclick="selectPreset(this,'18.88')">¥18.88</button>
    <button class="preset" onclick="selectPreset(this,'66.66')">¥66.66</button>
  </div>
  <div class="custom">
    <input id="customAmount" type="text" inputmode="decimal" placeholder="或输入自定义金额" oninput="onCustomInput()"/>
  </div>
  <button id="payBtn" disabled onclick="createOrder()">立即打赏</button>
  <div class="status" id="status"></div>
</div>
<script>
let selectedAmount = '';
const btn = document.getElementById('payBtn');
const customInput = document.getElementById('customAmount');
const status = document.getElementById('status');

function selectPreset(btnEl, amount) {
  selectedAmount = amount;
  document.querySelectorAll('.preset').forEach(b => b.classList.remove('active'));
  btnEl.classList.add('active');
  customInput.value = '';
  btn.disabled = false;
}

function onCustomInput() {
  const v = customInput.value.trim();
  const n = parseFloat(v);
  selectedAmount = (!isNaN(n) && n > 0) ? n.toFixed(2) : '';
  document.querySelectorAll('.preset').forEach(b => b.classList.remove('active'));
  btn.disabled = !selectedAmount;
}

async function createOrder() {
  if (!selectedAmount) return;
  btn.disabled = true;
  status.textContent = '创建订单中...';
  try {
    const r = await fetch('/api/pay/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: selectedAmount, subject: '双龙棍格斗 · 打赏' })
    });
    const data = await r.json();
    if (!data.ok && data.code) { status.textContent = data.msg || '下单失败'; btn.disabled = false; return; }
    status.textContent = '跳转支付宝...';
    const div = document.createElement('div');
    div.innerHTML = data.paymentHtml;
    document.body.appendChild(div);
    const form = div.querySelector('form');
    if (form) form.submit();
    else status.textContent = '支付表单解析失败';
  } catch (e) {
    status.textContent = '网络错误: ' + e.message;
    btn.disabled = false;
  }
}
</script>
</body>
</html>`;
  return c.html(html);
});

// ===== API 路由 =====
app.route('/api/pay', createPayRoute);
app.route('/api/pay', queryRoute);
app.route('/api/pay', returnRoute);
app.route('/api/pay', notifyRoute);
app.route('/api/pay', refundRoute);
app.route('/api/pay', refundQueryRoute);
app.route('/api/pay', closeRoute);

// ===== 错误兜底 =====
app.onError((err, c) => {
  console.error('[Worker] error:', err);
  return c.json({ ok: false, msg: err.message || 'internal' }, 500);
});

export default app;
