import { api, db } from 'sdk';
import { and, eq, desc, inArray } from 'sdk/db';
import { orders, orderNotifications, conversations } from '../schema.js';
import { adminIds } from './access.js';
import { formatOrder, orderActions } from './order-view.js';
import { homeKeyboard } from './shop.js';
import { rememberMessage } from './message-links.js';
import { ACTIVE_ORDER_STATUSES, STATUSES } from './validation.js';

async function adminOrderKeyboard(adminId) {
  return homeKeyboard(true, await db.$count(orders, inArray(orders.status, ACTIVE_ORDER_STATUSES)), await unreadNotifications(adminId), await db.$count(conversations, eq(conversations.unread, true)));
}

export async function notifyOrderScopeChange(order) {
  for (const adminId of await adminIds()) {
    try {
      await api.sendMessage({ chat_id: adminId, text: `📦 Заказ №${order.id}: ${STATUSES[order.status]}. ${ACTIVE_ORDER_STATUSES.includes(order.status) ? 'Возвращён в активные заказы.' : 'Перемещён в архив.'}`, reply_markup: await adminOrderKeyboard(adminId) });
    } catch { console.warn('Order archive notification was not delivered', adminId, order.id); }
  }
}

export async function queueNotification(order, adminId) {
  await db.insert(orderNotifications).values({ key: `${order.id}:${adminId}`, adminId, orderId: order.id, createdAt: order.createdAt }).onConflictDoNothing({ target: orderNotifications.key }).run();
}
export async function ensureNotifications(adminId) {
  // Recover notifications for pre-upgrade orders too, including the archive.
  // INSERT OR IGNORE never resets another administrator's read/delivery state.
  await db.run('INSERT OR IGNORE INTO order_notifications ("key", admin_id, order_id, created_at) SELECT CAST(id AS TEXT) || :suffix, :admin, id, created_at FROM orders', { ':suffix': `:${adminId}`, ':admin': adminId });
}
export async function unreadNotifications(adminId) {
  await ensureNotifications(adminId);
  return db.$count(orderNotifications, and(eq(orderNotifications.adminId, adminId), eq(orderNotifications.read, false)));
}
export async function markNotificationRead(adminId, orderId) {
  await ensureNotifications(adminId);
  await db.update(orderNotifications).set({ read: true }).where(and(eq(orderNotifications.adminId, adminId), eq(orderNotifications.orderId, orderId))).run();
}
export async function deliverNotification(notification) {
  if (notification.delivered) return true;
  const now = Math.floor(Date.now() / 1000);
  if (now - notification.lastAttemptAt < 30) return false;
  const claimed = await db.update(orderNotifications).set({ attempts: notification.attempts + 1, lastAttemptAt: now }).where(and(eq(orderNotifications.key, notification.key), eq(orderNotifications.attempts, notification.attempts), eq(orderNotifications.delivered, false))).returning().run();
  if (!claimed.length) return false;
  try {
    const order = await db.select().from(orders).where(eq(orders.id, notification.orderId)).get();
    if (!order) throw new Error('Заказ не найден');
    const keyboard = await adminOrderKeyboard(notification.adminId);
    const menu = await api.sendMessage({ chat_id: notification.adminId, text: `🔔 Заказ №${order.id}. Кнопки управления — в карточке ниже.`, reply_markup: keyboard });
    await rememberMessage(notification.adminId, menu.message_id, order.customerId, order.id);
    const sent = await api.sendMessage({ chat_id: notification.adminId, text: `🔔 Заказ от ${order.customerName} (ID ${order.customerId})\n\n${formatOrder(order)}\n\nОтветьте на это сообщение функцией Telegram «Ответить» — покупатель получит ответ от бота.`.slice(0, 4000), reply_markup: orderActions(order, { read: true }) });
    await rememberMessage(notification.adminId, sent.message_id, order.customerId, order.id);
    await db.update(orderNotifications).set({ delivered: true, error: '' }).where(eq(orderNotifications.key, notification.key)).run();
    return true;
  } catch (error) {
    const description = `${error.code || ''} ${error.description || error.message || 'Не удалось доставить уведомление'}`.trim().slice(0, 500);
    await db.update(orderNotifications).set({ error: description }).where(eq(orderNotifications.key, notification.key)).run();
    console.warn('Order notification delivery failed', notification.adminId, notification.orderId, description);
    return false;
  }
}
export async function retryNotifications(adminId) {
  await ensureNotifications(adminId);
  const pending = await db.select().from(orderNotifications).where(and(eq(orderNotifications.adminId, adminId), eq(orderNotifications.delivered, false))).orderBy(desc(orderNotifications.orderId)).limit(5).all();
  for (const notification of pending) await deliverNotification(notification);
}
export async function notifyAdmins(order) {
  for (const adminId of await adminIds()) {
    try {
      await queueNotification(order, adminId);
      const row = await db.select().from(orderNotifications).where(eq(orderNotifications.key, `${order.id}:${adminId}`)).get();
      await deliverNotification(row);
    } catch (error) { console.error('Could not queue order notification', adminId, order.id, error.message); }
  }
}
