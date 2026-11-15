/**
 * 密钥格式诊断 + 修复
 * 私钥由用户粘贴，仅在内存中处理
 */
'use strict';

const readline = require('readline');

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

function addPemHeader(base64, type = 'PRIVATE KEY') {
  const lines = base64.match(/.{1,64}/g) || [];
  return `-----BEGIN ${type}-----\n${lines.join('\n')}\n-----END ${type}-----`;
}

async function main() {
  console.log('=== 密钥格式诊断 ===\n');

  const priv = await ask('粘贴生产私钥 (MIIE... 或 MIIB... 开头): ');
  const appId = await ask('粘贴 APPID: ');
  const pub = await ask('粘贴支付宝公钥: ');

  const { AlipaySdk } = require('alipay-sdk');

  // 尝试 1：裸私钥
  console.log('\n[尝试1] 裸 Base64 私钥...');
  try {
    const sdk = new AlipaySdk({ appId, privateKey: priv, alipayPublicKey: pub, gateway: 'https://openapi.alipay.com/gateway.do', signType: 'RSA2' });
    const f = sdk.pageExec('alipay.trade.page.pay', 'POST', { returnUrl: 'https://x.com', notifyUrl: '', bizContent: { out_trade_no: 'T' + Date.now(), total_amount: '0.01', subject: 't', product_code: 'FAST_INSTANT_TRADE_PAY' } });
    const m = f.match(/name="sign"[^>]*value="([^"]+)"/);
    if (m) { console.log('✅ 裸私钥成功！sigLen=' + m[1].length); }
    else { console.log('❌ 裸私钥失败。form 前300字符:'); console.log(f.substring(0, 300)); }
  } catch (e) { console.log('❌ 裸私钥抛错:', e.message); }

  // 尝试 2：PKCS#8 PEM
  console.log('\n[尝试2] PKCS#8 PEM (BEGIN PRIVATE KEY)...');
  try {
    const pem = addPemHeader(priv, 'PRIVATE KEY');
    const sdk = new AlipaySdk({ appId, privateKey: pem, alipayPublicKey: pub, gateway: 'https://openapi.alipay.com/gateway.do', signType: 'RSA2' });
    const f = sdk.pageExec('alipay.trade.page.pay', 'POST', { returnUrl: 'https://x.com', notifyUrl: '', bizContent: { out_trade_no: 'T' + Date.now(), total_amount: '0.01', subject: 't', product_code: 'FAST_INSTANT_TRADE_PAY' } });
    const m = f.match(/name="sign"[^>]*value="([^"]+)"/);
    if (m) { console.log('✅ PKCS#8 PEM 成功！sigLen=' + m[1].length); }
    else { console.log('❌ PKCS#8 PEM 失败。form 前300字符:'); console.log(f.substring(0, 300)); }
  } catch (e) { console.log('❌ PKCS#8 PEM 抛错:', e.message); }

  // 尝试 3：PKCS#1 PEM
  console.log('\n[尝试3] PKCS#1 PEM (BEGIN RSA PRIVATE KEY)...');
  try {
    const pem = addPemHeader(priv, 'RSA PRIVATE KEY');
    const sdk = new AlipaySdk({ appId, privateKey: pem, alipayPublicKey: pub, gateway: 'https://openapi.alipay.com/gateway.do', signType: 'RSA2' });
    const f = sdk.pageExec('alipay.trade.page.pay', 'POST', { returnUrl: 'https://x.com', notifyUrl: '', bizContent: { out_trade_no: 'T' + Date.now(), total_amount: '0.01', subject: 't', product_code: 'FAST_INSTANT_TRADE_PAY' } });
    const m = f.match(/name="sign"[^>]*value="([^"]+)"/);
    if (m) { console.log('✅ PKCS#1 PEM 成功！sigLen=' + m[1].length); }
    else { console.log('❌ PKCS#1 PEM 失败。form 前300字符:'); console.log(f.substring(0, 300)); }
  } catch (e) { console.log('❌ PKCS#1 PEM 抛错:', e.message); }
}
main();
