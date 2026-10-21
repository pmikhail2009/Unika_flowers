import { api, db, EndpointError } from 'sdk';
import { and, desc, eq } from 'sdk/db';
import { orders } from '../schema.js';
import { STATUSES, TRANSITIONS, ACTIVE_ORDER_STATUSES } from './validation.js';
import { notifyAdmins, notifyOrderScopeChange } from './notifications.js';
export { formatOrder } from './order-view.js';
export { adminIds } from './access.js';
export { notifyAdmins } from './notifications.js';

export async function latestOrder(userId) {
  return db.select().from(orders).where(eq(orders.customerId, userId)).orderBy(desc(orders.id)).limit(1).get();
}
export async function createOrder({ userId, customerName, items, note, source, requestKey, contact = null }) {
  const key = requestKey ? `${userId}:${requestKey}` : null;
  if (key) {
    const existing = await db.select().from(orders).where(eq(orders.requestKey, key)).get();
    if (existing) return { ...existing, replayed: true };
  }
  const now = Math.floor(Date.now() / 1000);
  const [order] = await db.insert(orders).values({ customerId: userId, customerName, items, note, source, requestKey: key, contact, createdAt: now, updatedAt: now, history: [{ status: 'new', at: now, actorId: userId }] })
    .onConflictDoNothing({ target: orders.requestKey }).returning().run();
  if (!order && key) {
    const existing = await db.select().from(orders).where(eq(orders.requestKey, key)).get();
    return { ...existing, replayed: true };
  }
  await notifyAdmins(order);
  return order;
}

export async function changeOrderStatus({ id, status, version, actorId, customerOnly = false }) {
  const order = await db.select().from(orders).where(customerOnly ? and(eq(orders.id, id), eq(orders.customerId, actorId)) : eq(orders.id, id)).get();
  if (!order) throw new EndpointError('Заказ не найден.', { code: 'NOT_FOUND' });
  if (order.version !== version) throw new EndpointError('Заказ уже изменён. Обновите список.', { code: 'CONFLICT' });
  if ((customerOnly && (order.status !== 'new' || status !== 'cancelled')) || !TRANSITIONS[order.status]?.includes(status)) throw new EndpointError('Этот переход статуса недоступен. Для изменений свяжитесь с продавцом.', { code: 'INVALID_STATUS' });
  const now = Math.floor(Date.now() / 1000);
  const rows = await db.update(orders).set({ status, unread: false, updatedAt: now, version: version + 1, history: [...(order.history || []), { status, at: now, actorId }] }).where(and(eq(orders.id, id), eq(orders.version, version))).returning().run();
  if (!rows.length) throw new EndpointError('Заказ уже изменён. Обновите список.', { code: 'CONFLICT' });
  try { await api.sendMessage({ chat_id: order.customerId, text: `📦 Заказ №${id}: ${STATUSES[status]}.` }); } catch { console.warn('Order status notification was not delivered', id); }
  if (ACTIVE_ORDER_STATUSES.includes(order.status) !== ACTIVE_ORDER_STATUSES.includes(status)) await notifyOrderScopeChange(rows[0]);
  return rows[0];
}
export async function myOrders(userId, offset = 0) {
  return db.select().from(orders).where(eq(orders.customerId, userId)).orderBy(desc(orders.id)).limit(10).offset(offset).all();
}
