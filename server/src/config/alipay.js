/**
 * 支付宝 SDK 工厂 + 运行时配置
 * 沙箱/生产切换由 .env ALIPAY_SANDBOX 控制
 *
 * 密钥格式自动处理：
 *  - PKCS#8 裸 Base64（支付宝官方密钥工具默认输出）→ 自动用 Node crypto 转 PKCS#1
 *  - PKCS#8 PEM / PKCS#1 裸Base64 / PKCS#1 PEM → 直接传给 SDK
 *
 * alipay-sdk@4.0.0 防坑：
 *  - pageExec('POST') 返回的 HTML form 签名在 action URL query 参数里（sign=...）
 *  - exec() 返回驼峰字段：tradeStatus / outTradeNo / tradeNo / buyerPayAmount
 *  - 金额字符串精确比较，不用浮点数
 */
'use strict';

const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');

// 显式加载 .env（跨 cwd 可靠）
dotenv.config({ path: path.join(__dirname, '..', '.env') });

function buildPem(base64, type) {
  const lines = (base64 || '').match(/.{1,64}/g) || [];
  return `-----BEGIN ${type}-----\n${lines.join('\n')}\n-----END ${type}-----`;
}

/**
 * 把任意格式的私钥转换成 alipay-sdk 能吃的 PKCS#1 裸 Base64
 * 支持：PKCS#8 裸Base64 / PKCS#8 PEM / PKCS#1 裸Base64 / PKCS#1 PEM
 */
function normalizePrivateKey(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();

  // 已经是 PKCS#1 裸 Base64（1588 字符，MIIEow... 开头）
  if (/^MIIEow[0-9A-Za-z+/=]+$/.test(trimmed)) return trimmed;

  // 已经是 PKCS#1 PEM
  if (trimmed.includes('BEGIN RSA PRIVATE KEY')) {
    return trimmed.replace(/-----[A-Z ]+-----/g, '').replace(/\n/g, '').trim();
  }

  // PKCS#8 裸 Base64 或 PEM → 统一先转成 PEM 再用 crypto 转 PKCS#1
  let pem;
  if (trimmed.includes('BEGIN PRIVATE KEY')) {
    pem = trimmed;
  } else {
    // 裸 Base64，尝试 PKCS#8 PEM
    pem = buildPem(trimmed, 'PRIVATE KEY');
  }

  try {
    const sk = crypto.createPrivateKey(pem);
    const pkcs1 = sk.export({ type: 'pkcs1', format: 'pem' });
    return pkcs1.replace(/-----[A-Z ]+-----/g, '').replace(/\n/g, '').trim();
  } catch (e) {
    // crypto 也转不了，可能本身就是 PKCS#1 裸 Base64，原样返回让 SDK 试
    return trimmed;
  }
}

function buildAlipaySdk() {
  const sandbox = process.env.ALIPAY_SANDBOX !== 'false';
  const appId = process.env.ALIPAY_APP_ID;
  const rawPrivateKey = process.env.ALIPAY_APP_PRIVATE_KEY_PKCS1;
  const alipayPublicKey = process.env.ALIPAY_PUBLIC_KEY;
  const signType = process.env.ALIPAY_SIGN_TYPE || 'RSA2';

  const privateKey = normalizePrivateKey(rawPrivateKey);

  const gateway = sandbox
    ? (process.env.ALIPAY_SANDBOX_GATEWAY || 'https://openapi-sandbox.dl.alipaydev.com/gateway.do')
    : (process.env.ALIPAY_PROD_GATEWAY || process.env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do');

  if (!appId || !privateKey || !alipayPublicKey) {
    const missing = [];
    if (!appId) missing.push('ALIPAY_APP_ID');
    if (!privateKey) missing.push('ALIPAY_APP_PRIVATE_KEY_PKCS1');
    if (!alipayPublicKey) missing.push('ALIPAY_PUBLIC_KEY');
    throw new Error(`[alipay] 配置不完整，缺失: ${missing.join(', ')}`);
  }

  const { AlipaySdk } = require('alipay-sdk');
  return new AlipaySdk({
    appId,
    privateKey,
    alipayPublicKey,
    gateway,
    signType,
  });
}

/** 只返回配置元信息，不触发 SDK 实例化（供 /health 和启动日志用） */
function getRuntimeConfig() {
  const isSandbox = process.env.ALIPAY_SANDBOX !== 'false';
  const appId = process.env.ALIPAY_APP_ID;
  const privateKey = process.env.ALIPAY_APP_PRIVATE_KEY_PKCS1;
  const publicKey = process.env.ALIPAY_PUBLIC_KEY;

  const missing = [];
  if (!appId) missing.push('ALIPAY_APP_ID');
  if (!privateKey || !privateKey.trim()) missing.push('ALIPAY_APP_PRIVATE_KEY_PKCS1');
  if (!publicKey || !publicKey.trim()) missing.push('ALIPAY_PUBLIC_KEY');

  return {
    isSandbox,
    gateway: isSandbox
      ? (process.env.ALIPAY_SANDBOX_GATEWAY || 'https://openapi-sandbox.dl.alipaydev.com/gateway.do')
      : (process.env.ALIPAY_PROD_GATEWAY || process.env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do'),
    appId: appId || null,
    sellerId: process.env.ALIPAY_SELLER_ID || null,
    missing,
    signType: process.env.ALIPAY_SIGN_TYPE || 'RSA2',
    sdkVersion: '4.0.0',
    // 支付路由用
    baseReturnUrl: process.env.ALIPAY_RETURN_URL || '',
    notifyUrl: process.env.ALIPAY_NOTIFY_URL || '',
  };
}

module.exports = { buildAlipaySdk, getRuntimeConfig, normalizePrivateKey };
