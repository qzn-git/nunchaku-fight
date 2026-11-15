/**
 * 交互式切换生产环境
 * 安全：所有值由用户粘贴，脚本不落盘额外敏感数据
 * 用法：node scripts/set-prod.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ENV_PATH = path.join(__dirname, '..', '.env');

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

function updateEnv(key, value) {
  let content = fs.readFileSync(ENV_PATH, 'utf8');
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(content)) {
    content = content.replace(re, `${key}=${value}`);
  } else {
    content += `\n${key}=${value}\n`;
  }
  fs.writeFileSync(ENV_PATH, content, 'utf8');
}

async function main() {
  console.log('========================================');
  console.log('  切换生产环境（交互式）');
  console.log('========================================');
  console.log();

  const appId = await ask('[1/4] 生产 APPID: ');
  if (!appId) { console.log('❌ APPID 不能为空'); process.exit(1); }

  const privateKey = await ask('[2/4] 生产应用私钥 (PKCS#8, 整行粘贴): ');
  if (!privateKey) { console.log('❌ 私钥不能为空'); process.exit(1); }

  const alipayPublicKey = await ask('[3/4] 生产支付宝公钥 (整行粘贴): ');
  if (!alipayPublicKey) { console.log('❌ 支付宝公钥不能为空'); process.exit(1); }

  const confirm = await ask('[4/4] 确认写入 .env 并切换到生产? (yes/no): ');
  if (confirm.toLowerCase() !== 'yes') { console.log('已取消'); process.exit(0); }

  // 写入
  console.log('\n📝 写入 .env...');
  updateEnv('ALIPAY_SANDBOX', 'false');
  updateEnv('ALIPAY_APP_ID', appId);
  updateEnv('ALIPAY_APP_PRIVATE_KEY_PKCS1', privateKey);
  updateEnv('ALIPAY_PUBLIC_KEY', alipayPublicKey);
  updateEnv('ALIPAY_GATEWAY', 'https://openapi.alipay.com/gateway.do');
  console.log('✅ .env 已更新');

  // SDK 签名自检（本地，不发网络请求）
  console.log('\n🔍 SDK 签名自检...');
  try {
    // 自动把 PKCS#8 转成 PKCS#1（和 config/alipay.js 里的 normalizePrivateKey 一样）
    const crypto = require('crypto');
    function normalize(raw) {
      const trimmed = raw.trim();
      if (/^MIIEow[0-9A-Za-z+/=]+$/.test(trimmed)) return trimmed; // 已经是 PKCS#1 裸 B64
      if (trimmed.includes('BEGIN RSA PRIVATE KEY')) {
        return trimmed.replace(/-----[A-Z ]+-----/g, '').replace(/\n/g, '').trim();
      }
      let pem;
      if (trimmed.includes('BEGIN PRIVATE KEY')) {
        pem = trimmed;
      } else {
        const lines = trimmed.match(/.{1,64}/g) || [];
        pem = `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`;
      }
      const sk = crypto.createPrivateKey(pem);
      const pkcs1 = sk.export({ type: 'pkcs1', format: 'pem' });
      return pkcs1.replace(/-----[A-Z ]+-----/g, '').replace(/\n/g, '').trim();
    }
    const pkcs1Key = normalize(privateKey);
    console.log(`   私钥转换后长度: ${pkcs1Key.length} 字符 (PKCS#1)`);

    const { AlipaySdk } = require('alipay-sdk');
    const sdk = new AlipaySdk({
      appId,
      privateKey: pkcs1Key,
      alipayPublicKey,
      gateway: 'https://openapi.alipay.com/gateway.do',
      signType: 'RSA2',
    });
    const htmlForm = sdk.pageExec('alipay.trade.page.pay', 'POST', {
      returnUrl: 'https://example.com/return',
      notifyUrl: '',
      bizContent: {
        out_trade_no: 'SELFTEST_' + Date.now(),
        total_amount: '0.01',
        subject: 'SDK 签名自检',
        product_code: 'FAST_INSTANT_TRADE_PAY',
      },
    });
    // SDK@4.0.0 把 sign 放在 action URL query 参数里
    const hasSign = htmlForm.indexOf('sign=') !== -1;
    if (hasSign) {
      const m = htmlForm.match(/sign=([^&" ]+)/);
      const sigLen = m ? decodeURIComponent(m[1]).length : '?';
      console.log(`✅ 签名生成成功，长度 ${sigLen} 字符`);
      console.log('🎉 密钥格式正确，生产配置就绪！');
      console.log('\n⚠️  下一步：');
      console.log('  1. 更新 ALIPAY_RETURN_URL / ALIPAY_NOTIFY_URL 为 HTTPS 公网地址');
      console.log('  2. 确认 PID (ALIPAY_SELLER_ID) = 2088912842720751');
      console.log('  3. 重启服务即可走正式生产网关');
    } else {
      console.log('❌ 签名未找到，SDK 返回异常');
      console.log('   form 前200字符:', htmlForm.substring(0, 200));
      process.exit(2);
    }
  } catch (err) {
    console.log('❌ SDK 初始化/签名失败:', err.message);
    console.log('   常见原因：私钥格式不对（支付宝官方密钥工具 → PKCS#8 自动转 PKCS#1）');
    process.exit(2);
  }
}

main().catch((e) => { console.error(e); process.exit(3); });
