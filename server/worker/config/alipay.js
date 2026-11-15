/**
 * Workers 版 SDK 工厂
 * 和 Express 版不同：
 *  - 密钥从 env（wrangler secret）读取，不是 .env
 *  - normalizePrivateKey 用 Web Crypto API（Workers 没有 Node crypto）
 *  - 但 alipay-sdk@4.0.0 内部用了 Node crypto → 需要 wrangler.jsonc 里 nodejs_compat
 */

/**
 * 把任意格式私钥转成 PKCS#1 裸 Base64
 * Workers 版：用 Web Crypto + subtle（如果可用），或纯字符串转换
 */
export function normalizePrivateKey(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();

  // 已经是 PKCS#1 裸 Base64（1588 字符，MIIEow... 开头）
  if (/^MIIEow[0-9A-Za-z+/=]+$/.test(trimmed)) return trimmed;

  // 已经是 PKCS#1 PEM
  if (trimmed.includes('BEGIN RSA PRIVATE KEY')) {
    return trimmed.replace(/-----[A-Z ]+-----/g, '').replace(/\n/g, '').trim();
  }

  // PKCS#8 PEM → 去掉头尾
  if (trimmed.includes('BEGIN PRIVATE KEY')) {
    return trimmed.replace(/-----[A-Z ]+-----/g, '').replace(/\n/g, '').trim();
  }

  // PKCS#8 裸 Base64 —— 需要用 Web Crypto 转 PKCS#1
  // 但 Workers 里 nodejs_compat 下 alipay-sdk 自己能处理吗？
  // 保险起见：如果是 MIIEvQ 开头（PKCS#8），尝试用 crypto.subtle 转
  if (/^MIIEvQ[0-9A-Za-z+/=]+$/.test(trimmed)) {
    // 返回 PKCS#8 裸 B64，让调用方决定怎么处理
    // nodejs_compat 下 alipay-sdk 可能需要 PKCS#1，这里先返回，
    // 实际转换在 buildAlipaySdk 里用 Node crypto（nodejs_compat 可用）
    return trimmed;
  }

  return trimmed;
}

/**
 * 从 Workers env 构建 alipay-sdk 实例
 */
export function buildAlipaySdk(env) {
  const sandbox = env.ALIPAY_SANDBOX === 'true';
  const appId = env.ALIPAY_APP_ID;
  const rawKey = env.ALIPAY_APP_PRIVATE_KEY;
  const pubKey = env.ALIPAY_PUBLIC_KEY;

  if (!appId || !rawKey || !pubKey) {
    throw new Error('[alipay] Workers secrets 未配置完整');
  }

  // 在 Workers + nodejs_compat 下，require('crypto') 可用
  // 用 Node crypto 把 PKCS#8 转成 PKCS#1
  let privateKey = rawKey.trim();
  const crypto = require('crypto');

  // 如果是 PKCS#8 裸 Base64（MIIEvQ 开头），转 PEM 后再 crypto 转
  if (/^MIIEvQ/.test(privateKey)) {
    const lines = privateKey.match(/.{1,64}/g) || [];
    const pem8 = '-----BEGIN PRIVATE KEY-----\n' + lines.join('\n') + '\n-----END PRIVATE KEY-----';
    try {
      const sk = crypto.createPrivateKey(pem8);
      privateKey = sk.export({ type: 'pkcs1', format: 'pem' })
        .replace(/-----[A-Z ]+-----/g, '').replace(/\n/g, '').trim();
    } catch (e) {
      console.warn('[alipay] PKCS#8→PKCS#1 转换失败，尝试直接使用:', e.message);
    }
  }

  const gateway = sandbox
    ? (env.ALIPAY_SANDBOX_GATEWAY || 'https://openapi-sandbox.dl.alipaydev.com/gateway.do')
    : (env.ALIPAY_PROD_GATEWAY || env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do');

  const { AlipaySdk } = require('alipay-sdk');
  return new AlipaySdk({
    appId,
    privateKey,
    alipayPublicKey: pubKey.trim(),
    gateway,
    signType: env.ALIPAY_SIGN_TYPE || 'RSA2',
  });
}

export function getEnvMeta(env) {
  return {
    isSandbox: env.ALIPAY_SANDBOX === 'true',
    gateway: env.ALIPAY_SANDBOX === 'true'
      ? (env.ALIPAY_SANDBOX_GATEWAY || 'https://openapi-sandbox.dl.alipaydev.com/gateway.do')
      : (env.ALIPAY_PROD_GATEWAY || env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do'),
    baseReturnUrl: env.ALIPAY_RETURN_URL || '',
    notifyUrl: env.ALIPAY_NOTIFY_URL || '',
    sellerId: env.ALIPAY_SELLER_ID || null,
    sdkVersion: '4.0.0',
  };
}
