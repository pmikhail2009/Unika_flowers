import { api, db } from 'sdk';
import { asc, desc, eq, inArray, and } from 'sdk/db';
import { customers, orders, products, orderNotifications } from '../schema.js';
import { adminKeyboard, draftKeyboard } from './shop.js';
import { ensureCatalog } from './catalog.js';
import { formatOrder } from './orders.js';
import { orderActions } from './order-view.js';
import { ensureNotifications, unreadNotifications } from './notifications.js';
import { rememberMessage } from './message-links.js';
import { ACTIVE_ORDER_STATUSES, ARCHIVED_ORDER_STATUSES } from './validation.js';

export async function showAdminMenu(chatId) {
  const unread = await unreadNotifications(chatId);
  const current = await db.$count(orders, inArray(orders.status, ACTIVE_ORDER_STATUSES));
  await api.sendMessage({ chat_id: chatId, text: '🛠 Управление магазином', reply_markup: adminKeyboard(unread, current) });
}

export async function showProductList(chatId, action) {
  await ensureCatalog();
  const rows = await db.select().from(products).where(eq(products.active, action !== 'restore')).orderBy(asc(products.id)).limit(80).all();
  if (!rows.length) {
    await api.sendMessage({ chat_id: chatId, text: 'Ассортимент пока пуст.', reply_markup: { inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'admin:menu' }]] } });
    return;
  }
  const keyboard = rows.map((item) => [{ text: `${action === 'remove' ? '➖' : action === 'restore' ? '♻️' : '💰'} ${item.name}`, callback_data: `admin:${action}:${item.id}` }]);
  keyboard.push([{ text: '⬅️ Назад', callback_data: 'admin:menu' }]);
  await api.sendMessage({ chat_id: chatId, text: action === 'remove' ? 'Выберите сорт, который нужно скрыть:' : action === 'restore' ? 'Выберите сорт для возврата в каталог:' : 'Выберите сорт для изменения цены:', reply_markup: { inline_keyboard: keyboard } });
}

export async function showDraft(chatId, draft) {
  const height = draft.heightMin === draft.heightMax ? `${draft.heightMin} см` : `${draft.heightMin}–${draft.heightMax} см`;
  const caption = `🌸 ${draft.name}\n📏 Высота: ${height}\n📝 ${draft.shortDescription}\n\nСохранить этот товар?`;
  await api.sendPhoto({ chat_id: chatId, photo: draft.photoFileId, caption, reply_markup: draftKeyboard() });
}

export async function showOrderList(chatId, onlyUnread, offset = 0, archive = false) {
  let condition;
  if (onlyUnread) {
    await ensureNotifications(chatId);
    const unread = await db.select().from(orderNotifications).where(and(eq(orderNotifications.adminId, chatId), eq(orderNotifications.read, false))).all();
    condition = inArray(orders.id, unread.length ? unread.map(row => row.orderId) : [-1]);
  } else condition = inArray(orders.status, archive ? ARCHIVED_ORDER_STATUSES : ACTIVE_ORDER_STATUSES);
  const rows = await db.select().from(orders)
    .where(condition)
    .orderBy(desc(orders.id)).limit(5).offset(offset).all();
  if (!rows.length) {
    await api.sendMessage({ chat_id: chatId, text: onlyUnread ? '🔔 Новых уведомлений нет.' : archive ? 'Архив пуст.' : '📦 Текущих заказов нет.', reply_markup: { inline_keyboard: [[{ text: '📦 Активные заказы', callback_data: 'admin:orders' }, { text: '🗂 Архив заказов', callback_data: 'admin:archive:0' }], [{ text: '⬅️ Назад', callback_data: 'admin:menu' }]] } });
    return;
  }
  for (const order of rows) await showAdminOrder(chatId, order, onlyUnread);
  const prefix = archive ? 'archive' : onlyUnread ? 'notices' : 'page';
  const navigation = [];
  if (offset) navigation.push({ text: '← Новее', callback_data: `admin:${prefix}:${Math.max(0, offset - 5)}` });
  if (rows.length === 5) navigation.push({ text: 'Раньше →', callback_data: `admin:${prefix}:${offset + 5}` });
  await api.sendMessage({ chat_id: chatId, text: archive ? '🗂 Архив: завершённые и отменённые заказы.' : onlyUnread ? 'Уведомления о заказах' : '📦 Активные заказы. Завершённые и отменённые доступны в архиве.', reply_markup: { inline_keyboard: [...(navigation.length ? [navigation] : []), [{ text: '📦 Активные заказы', callback_data: 'admin:orders' }, { text: '🗂 Архив заказов', callback_data: 'admin:archive:0' }], [{ text: 'Повторить недоставленные уведомления', callback_data: 'admin:retry' }], [{ text: '⬅️ Меню', callback_data: 'admin:menu' }]] } });
}

export async function showAdminOrder(chatId, order, notification = false) {
  let delivery = '';
  if (notification) {
    const row = await db.select().from(orderNotifications).where(eq(orderNotifications.key, `${order.id}:${chatId}`)).get();
    if (row && !row.delivered) delivery = `\n\nДоставка уведомления: ожидает повтора.${row.error ? ` Причина: ${row.error}` : ''}`;
  }
  const terminal = order.status === 'cancelled' ? '\n\nЗаказ отменён. При необходимости нажмите «Принять заново».' : order.status === 'done' ? '\n\nЗаказ завершён.' : '';
  const sent = await api.sendMessage({ chat_id: chatId, text: `${order.customerName} (ID ${order.customerId})\n${formatOrder(order)}${terminal}${delivery}`.slice(0, 4000), reply_markup: orderActions(order, { open: false, read: true }) });
  await rememberMessage(chatId, sent.message_id, order.customerId, order.id);
}

export async function setAdminState(userId, step, draft = null) {
  await db.update(customers).set({ adminStep: step, draft }).where(eq(customers.telegramId, userId)).run();
}
