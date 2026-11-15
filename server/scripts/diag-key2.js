/**
 * 密钥格式快速诊断
 * 用法: node scripts/diag-key2.js <priv> <pub> <appId>
 */
'use strict';
const { AlipaySdk } = require('alipay-sdk');
const [, , priv, pub, appId] = process.argv;

if (!priv || !pub || !appId) {
  console.log('用法: node diag-key2.js <privKey> <alipayPubKey> <appId>');
  process.exit(1);
}

function pem(base64, type) {
  const lines = base64.match(/.{1,64}/g) || [];
  return '-----BEGIN ' + type + '-----\n' + lines.join('\n') + '\n-----END ' + type + '-----';
}

function test(label, keyStr) {
  try {
    const sdk = new AlipaySdk({
      appId, privateKey: keyStr, alipayPublicKey: pub,
      gateway: 'https://openapi.alipay.com/gateway.do', signType: 'RSA2',
    });
    const f = sdk.pageExec('alipay.trade.page.pay', 'POST', {
      returnUrl: 'https://x.com', notifyUrl: '',
      bizContent: { out_trade_no: 'T' + Date.now(), total_amount: '0.01', subject: 't', product_code: 'FAST_INSTANT_TRADE_PAY' },
    });
    const hasSign = f.indexOf('name="sign"') !== -1;
    console.log(label + ': OK  hasSign=' + hasSign + '  formLen=' + f.length);
    if (!hasSign) console.log('  前200字符:', f.substring(0, 200));
  } catch (e) {
    console.log(label + ': FAIL  ' + e.message.substring(0, 100));
  }
}

console.log('=== 密钥格式诊断 ===\n');
test('[1] Bare 裸Base64', priv);
test('[2] PKCS#8 PEM', pem(priv, 'PRIVATE KEY'));
test('[3] PKCS#1 PEM', pem(priv, 'RSA PRIVATE KEY'));
