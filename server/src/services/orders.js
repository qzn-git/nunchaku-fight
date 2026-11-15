/**
 * 订单仓储（本地 JSON 持久化 + 内存缓存）
 *
 * 生产环境应替换为数据库（MySQL/PostgreSQL/D1），本实现仅用于沙箱联调和轻量生产。
 * 数据文件路径：DATA_DIR/orders.json，按 out_trade_no 唯一索引。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const NOTIFY_FILE = path.join(DATA_DIR, 'notify-events.json');

const ORDER_STATUS = Object.freeze({
  PENDING_PAYMENT: 'PENDING_PAYMENT', // 已创建待支付
  PAID: 'PAID',                       // 已支付（幂等写入）
  CLOSED: 'CLOSED',                   // 已关闭
  REFUNDING: 'REFUNDING',             // 退款中
  REFUNDED: 'REFUNDED',               // 已全额退款
});

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJSONSafe(file, fallback) {
  ensureDir();
  if (!fs.existsSync(file)) return fallback();
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return fallback();
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[orders] 文件读取损坏，使用空仓库恢复：', file, err.message);
    return fallback();
  }
}

function writeJSONSafe(file, data) {
  ensureDir();
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function loadOrders() {
  return readJSONSafe(ORDERS_FILE, () => ({}));
}
function saveOrders(map) {
  writeJSONSafe(ORDERS_FILE, map);
}
function loadNotifies() {
  return readJSONSafe(NOTIFY_FILE, () => ({}));
}
function saveNotifies(map) {
  writeJSONSafe(NOTIFY_FILE, map);
}

/**
 * 金额文本规范化：去掉前后空格、补两位小数
 * 返回 null 代表非法值；避免用浮点数直接比较金额。
 */
function normalizeAmountText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  const match = text.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  return `${BigInt(match[1]).toString()}.${(match[2] || '').padEnd(2, '0')}`;
}

function amountEquals(expected, actual) {
  return normalizeAmountText(expected) !== null
    && normalizeAmountText(expected) === normalizeAmountText(actual);
}

/**
 * 创建订单。同一 out_trade_no 只允许创建一次，否则返回 null。
 */
function createOrder({ outTradeNo, totalAmount, subject, userId, attach }) {
  const orders = loadOrders();
  if (orders[outTradeNo]) return null;

  const now = new Date().toISOString();
  const order = {
    outTradeNo,
    totalAmount,           // 原始字符串，不做浮点处理
    subject,
    userId: userId || '',
    attach: attach || '',  // 订单附属信息（选填），同步回跳可用
    status: ORDER_STATUS.PENDING_PAYMENT,
    tradeNo: '',           // 支付宝交易号，支付成功后回填
    paidAt: '',            // ISO 时间戳，支付成功时写入
    createdAt: now,
    updatedAt: now,
    refundedAmount: '0.00',
    refundHistory: [],
  };
  orders[outTradeNo] = order;
  saveOrders(orders);
  return order;
}

function findByOutTradeNo(outTradeNo) {
  const orders = loadOrders();
  return orders[outTradeNo] || null;
}

function updateOrder(outTradeNo, patch) {
  const orders = loadOrders();
  if (!orders[outTradeNo]) return null;
  orders[outTradeNo] = {
    ...orders[outTradeNo],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  saveOrders(orders);
  return orders[outTradeNo];
}

/**
 * 幂等标记已支付。仅当前状态为 PENDING_PAYMENT 时才写入 tradeNo 和 paidAt。
 * 如果已是 PAID/REFUNDED 等状态，直接返回现有订单（幂等）。
 */
function markPaidIdempotently(outTradeNo, tradeNo, params) {
  const orders = loadOrders();
  const current = orders[outTradeNo];
  if (!current) return null;
  if (current.status === ORDER_STATUS.PAID) {
    // 已经标记过，直接返回现有订单（幂等）
    return current;
  }
  if (current.status !== ORDER_STATUS.PENDING_PAYMENT) {
    // 非待支付状态（已关闭/已退款等），不再变更
    return current;
  }
  orders[outTradeNo] = {
    ...current,
    status: ORDER_STATUS.PAID,
    tradeNo: tradeNo || current.tradeNo,
    paidAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveOrders(orders);
  return orders[outTradeNo];
}

function markClosed(outTradeNo) {
  return updateOrder(outTradeNo, { status: ORDER_STATUS.CLOSED });
}

/**
 * 通知事件幂等插入。返回 true 代表首次插入（需处理业务），false 代表已处理过。
 * 唯一键：notifyId + outTradeNo。
 */
function insertNotifyOnce({ notifyId, outTradeNo, tradeStatus, rawParams }) {
  if (!notifyId || !outTradeNo) return false;
  const notifies = loadNotifies();
  const key = `${outTradeNo}::${notifyId}`;
  if (notifies[key]) return false;
  notifies[key] = {
    outTradeNo,
    notifyId,
    tradeStatus,
    tradeNo: (rawParams && rawParams.trade_no) || '',
    receivedAt: new Date().toISOString(),
  };
  saveNotifies(notifies);
  return true;
}

module.exports = {
  ORDER_STATUS,
  normalizeAmountText,
  amountEquals,
  createOrder,
  findByOutTradeNo,
  updateOrder,
  markPaidIdempotently,
  markClosed,
  insertNotifyOnce,
};
