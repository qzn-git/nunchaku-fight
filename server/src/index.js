/**
 * Express 主入口：挂载全部支付路由 + 打赏前端页面 + 健康检查
 */
'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { getRuntimeConfig } = require('./config/alipay');

const createPay = require('./routes/create-pay');
const notify = require('./routes/notify');
const ret = require('./routes/return');
const query = require('./routes/query');
const refund = require('./routes/refund');
const refundQuery = require('./routes/refundQuery');
const close = require('./routes/close');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false }));

// 健康检查
app.get('/health', (req, res) => {
  const cfg = getRuntimeConfig();
  res.json({
    ok: true,
    env: cfg.isSandbox ? 'sandbox' : 'prod',
    gateway: cfg.gateway,
    appIdSet: !!cfg.appId,
    missing: cfg.missing,
    uptime: process.uptime(),
  });
});

// 支付路由
app.use('/api/pay', createPay);          // POST /api/pay/create —— 下单
app.use('/api/pay/notify', notify);       // POST /api/pay/notify —— 异步通知（urlencoded）
app.use('/api/pay/return', ret);          // GET  /api/pay/return  —— 同步回跳
app.use('/api/pay/query', query);         // GET  /api/pay/query   —— 主动查单兜底
app.use('/api/pay/refund', refund);       // POST /api/pay/refund —— 退款
app.use('/api/pay/refund-query', refundQuery); // GET /api/pay/refund-query —— 退款查询
app.use('/api/pay/close', close);         // POST /api/pay/close   —— 关单

// 打赏前端页面（原生 HTML，自动提交 form 的模板在前端实现）
app.get('/', (req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>双龙棍格斗 · 打赏支持</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;background:radial-gradient(ellipse at top,#1e293b,#0f172a);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#e2e8f0;display:flex;align-items:center;justify-content:center;padding:24px}
.card{background:rgba(30,41,59,.6);backdrop-filter:blur(12px);border:1px solid rgba(148,163,184,.2);border-radius:16px;padding:32px;max-width:420px;width:100%;box-shadow:0 12px 40px rgba(0,0,0,.4)}
h1{font-size:20px;font-weight:700;margin-bottom:6px;color:#f8fafc}
.sub{font-size:13px;color:#94a3b8;margin-bottom:24px}
.presets{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px}
.preset{background:rgba(148,163,184,.1);border:1px solid rgba(148,163,184,.2);border-radius:10px;padding:14px 10px;text-align:center;cursor:pointer;transition:all .15s}
.preset:hover{background:rgba(59,130,246,.15);border-color:rgba(59,130,246,.5)}
.preset.active{background:rgba(59,130,246,.25);border-color:#3b82f6}
.preset .amount{font-size:20px;font-weight:700;color:#f8fafc}
.preset .label{font-size:11px;color:#94a3b8;margin-top:3px}
.custom{margin-bottom:18px}
.custom label{font-size:12px;color:#94a3b8;display:block;margin-bottom:6px}
.custom input{width:100%;background:rgba(148,163,184,.1);border:1px solid rgba(148,163,184,.2);border-radius:10px;padding:12px 14px;color:#f8fafc;font-size:16px;outline:none;transition:border-color .15s}
.custom input:focus{border-color:#3b82f6}
.custom input::placeholder{color:#64748b}
button.pay{width:100%;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;border:none;border-radius:12px;padding:14px;font-size:16px;font-weight:600;cursor:pointer;transition:transform .1s,box-shadow .15s}
button.pay:hover{transform:translateY(-1px);box-shadow:0 8px 24px rgba(59,130,246,.4)}
button.pay:disabled{opacity:.6;cursor:not-allowed;transform:none;box-shadow:none}
.status{margin-top:16px;padding:10px 14px;border-radius:8px;font-size:13px;color:#fbbf24;background:rgba(251,191,36,.1);display:none}
.status.show{display:block}
.status.ok{color:#4ade80;background:rgba(74,222,128,.1)}
.status.err{color:#f87171;background:rgba(248,113,113,.1)}
</style></head><body>
<div class="card">
  <h1>🐉 双龙棍格斗 · 打赏支持</h1>
  <p class="sub">您的打赏是我持续更新的最大动力，感谢支持！</p>

  <div class="presets" id="presets">
    <div class="preset" data-amount="6.66" data-label="打个气" onclick="window.__selectPreset(this)"><div class="amount">¥6.66</div><div class="label">打个气</div></div>
    <div class="preset" data-amount="18.88" data-label="请喝茶" onclick="window.__selectPreset(this)"><div class="amount">¥18.88</div><div class="label">请喝茶</div></div>
    <div class="preset" data-amount="66.66" data-label="支持开发" onclick="window.__selectPreset(this)"><div class="amount">¥66.66</div><div class="label">支持开发</div></div>
  </div>

  <div class="custom">
    <label for="amount">或自定义金额（元）</label>
    <input id="amount" type="text" inputmode="decimal" pattern="[0-9]*\.?[0-9]{0,2}" placeholder="请输入金额，例如 12.00" oninput="window.__onAmountInput()">
  </div>

  <button class="pay" id="payBtn" disabled onclick="window.__doPay()">立即打赏</button>
  <div class="status" id="status"></div>
</div>

<script>
window.__currentAmount = null;

window.__selectPreset = function(el) {
  // 清除所有 active
  document.querySelectorAll('.preset').forEach(function(x){ x.classList.remove('active'); });
  el.classList.add('active');
  document.getElementById('amount').value = '';
  window.__currentAmount = el.getAttribute('data-amount');
  document.getElementById('payBtn').disabled = false;
};

window.__onAmountInput = function() {
  window.__currentAmount = null;
  document.querySelectorAll('.preset').forEach(function(x){ x.classList.remove('active'); });
  var v = document.getElementById('amount').value.trim();
  // 宽容验证：只要能 parseFloat 成 > 0 的数字就启用按钮
  var num = parseFloat(v);
  document.getElementById('payBtn').disabled = !(v && !isNaN(num) && num > 0 && num <= 100000);
};

window.__doPay = async function() {
  var inputVal = document.getElementById('amount').value.trim();
  var amount;
  var num = parseFloat(inputVal);
  if (inputVal && !isNaN(num) && num > 0 && num <= 100000) {
    amount = num.toFixed(2);
  } else if (window.__currentAmount) {
    amount = window.__currentAmount;
  } else {
    return;
  }
  var btn = document.getElementById('payBtn');
  var status = document.getElementById('status');
  btn.disabled = true;
  status.className = 'status show';
  status.textContent = '正在创建订单...';
  try {
    var resp = await fetch('/api/pay/create', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ amount: amount, subject: '双龙棍格斗 · 打赏' })
    });
    var data = await resp.json();
    if (!resp.ok || !data.paymentHtml) {
      status.className = 'status show err';
      status.textContent = '创建订单失败：' + (data.msg || data.code || 'unknown');
      btn.disabled = false; return;
    }
    status.className = 'status show ok';
    status.textContent = '即将跳转支付宝...';
    var container = document.createElement('div');
    container.innerHTML = data.paymentHtml;
    container.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;background:white';
    document.body.appendChild(container);
    var form = container.querySelector('form');
    if (form) { form.submit(); }
    else {
      status.className = 'status show err';
      status.textContent = '支付表单渲染失败';
      btn.disabled = false;
    }
  } catch (err) {
    status.className = 'status show err';
    status.textContent = '网络错误：' + err.message;
    btn.disabled = false;
  }
};
</script></body></html>`);
});

// 统一错误处理
app.use((err, req, res, next) => {
  console.error('[Unhandled]', err && err.stack);
  res.status(500).json({ ok: false, msg: err && err.message || 'internal' });
});

app.listen(PORT, () => {
  const cfg = getRuntimeConfig();
  console.log(`\n🐉 双龙棍格斗 · 支付宝支付服务启动`);
  console.log(`   http://localhost:${PORT}/`);
  console.log(`   环境：${cfg.isSandbox ? '🛠️  沙箱' : '🚀 生产'}`);
  console.log(`   网关：${cfg.gateway}`);
  if (cfg.missing.length) {
    console.warn(`   ⚠️  配置缺失（支付功能暂不可用）：${cfg.missing.join(', ')}`);
    console.warn(`   📄 请复制 .env.example 为 .env 并填入沙箱/生产配置`);
  } else {
    console.log(`   ✅ 支付配置就绪`);
  }
});
