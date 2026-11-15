/**
 * Workers KV 订单仓储
 * KV 绑定名：NUNCHAKU_ORDERS
 *
 * Key 设计：
 *   order:{outTradeNo}    → 订单完整 JSON
 *   notify:{notifyId}:{outTradeNo} → 通知幂等
 */

export const ORDER_STATUS = {
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  PAID: 'PAID',
  REFUNDING: 'REFUNDING',
  REFUNDED: 'REFUNDED',
  CLOSED: 'CLOSED',
};

async function readOrder(kv, outTradeNo) {
  const raw = await kv.get('order:' + outTradeNo);
  return raw ? JSON.parse(raw) : null;
}

async function writeOrder(kv, outTradeNo, order) {
  await kv.put('order:' + outTradeNo, JSON.stringify(order));
}

export async function createOrder(kv, data) {
  const existing = await readOrder(kv, data.outTradeNo);
  if (existing) return null; // 重复
  const order = {
    outTradeNo: data.outTradeNo,
    totalAmount: data.totalAmount,
    subject: data.subject,
    userId: data.userId || '',
    attach: data.attach || '',
    status: ORDER_STATUS.PENDING_PAYMENT,
    tradeNo: null,
    buyerId: null,
    paidAt: null,
    refundedAmount: '0.00',
    refundHistory: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writeOrder(kv, data.outTradeNo, order);
  return order;
}

export async function getOrder(kv, outTradeNo) {
  return readOrder(kv, outTradeNo);
}

/** 幂等标记为已支付 */
export async function markPaidIdempotently(kv, outTradeNo, tradeNo, extra = {}) {
  const order = await readOrder(kv, outTradeNo);
  if (!order) return null;
  if (order.status === ORDER_STATUS.PAID) return order; // 已是 PAID，直接返回
  if (order.status !== ORDER_STATUS.PENDING_PAYMENT) return order; // 已终态，不覆盖

  order.status = ORDER_STATUS.PAID;
  order.tradeNo = tradeNo;
  order.buyerId = extra.buyerId || order.buyerId;
  order.paidAt = extra.paidAt || new Date().toISOString();
  order.updatedAt = new Date().toISOString();
  await writeOrder(kv, outTradeNo, order);
  return order;
}

/** 标记为已退款 */
export async function markRefunded(kv, outTradeNo, refundAmount, refundInfo = {}) {
  const order = await readOrder(kv, outTradeNo);
  if (!order) return null;

  // 分累加（字符串 → 分 → 加 → 字符串）
  const curFen = Math.round(parseFloat(order.refundedAmount || '0') * 100);
  const addFen = Math.round(parseFloat(refundAmount) * 100);
  const newFen = curFen + addFen;

  order.refundedAmount = (newFen / 100).toFixed(2);
  order.refundHistory.push({
    outRequestNo: refundInfo.outRequestNo,
    refundAmount,
    reason: refundInfo.reason || '',
    status: refundInfo.status || 'SUCCESS',
    createdAt: new Date().toISOString(),
  });
  // 全额退款 → REFUNDED，部分退款 → 保持 PAID
  const totalFen = Math.round(parseFloat(order.totalAmount) * 100);
  order.status = newFen >= totalFen ? ORDER_STATUS.REFUNDED : ORDER_STATUS.PAID;
  order.updatedAt = new Date().toISOString();
  await writeOrder(kv, outTradeNo, order);
  return order;
}

export async function listOrderRefunds(kv, outTradeNo) {
  const order = await readOrder(kv, outTradeNo);
  return order ? order.refundHistory : [];
}

/** 异步通知幂等：true=首次，false=已处理 */
export async function insertNotifyOnce(kv, notifyId, outTradeNo) {
  const key = 'notify:' + notifyId + ':' + outTradeNo;
  const existing = await kv.get(key);
  if (existing) return false;
  await kv.put(key, '1', { expirationTtl: 86400 * 7 }); // 7 天
  return true;
}
