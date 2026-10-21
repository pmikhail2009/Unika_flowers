import { api, db } from 'sdk';
import { eq, desc } from 'sdk/db';
import { conversations, supportMessages, orders } from '../schema.js';
import { adminIds } from './access.js';
import { rememberMessage, replyTarget } from './message-links.js';
import { latestOrder } from './orders.js';

const now = () => Math.floor(Date.now() / 1000);
const supported = message => ['text', 'photo', 'video', 'document', 'audio', 'voice', 'sticker', 'animation', 'video_note', 'location', 'contact'].some(key => message[key]);
const errorText = error => `${error.code || ''} ${error.description || error.message || 'Не удалось доставить'}`.trim().slice(0, 500);
export const answerKeyboard = (customerId, orderId) => ({ inline_keyboard: [[{ text: '✉️ Ответить через бота', callback_data: orderId ? `chat:order:${orderId}` : `chat:user:${customerId}` }], [{ text: '💬 История переписки', callback_data: `chat:open:${customerId}` }]] });

async function saveMessage(message, customerId, orderId, direction) {
  const key = `${message.chat.id}:${message.message_id}`;
  await db.insert(supportMessages).values({ key, customerId, orderId, direction, sourceChatId: message.chat.id, sourceMessageId: message.message_id, createdAt: now() }).onConflictDoNothing({ target: supportMessages.key }).run();
  return db.select().from(supportMessages).where(eq(supportMessages.key, key)).get();
}
async function deliveryResult(record, recipient, error = null) {
  const errors = { ...(record.errors || {}) };
  if (error) errors[recipient] = errorText(error); else delete errors[recipient];
  const deliveredTo = error ? record.deliveredTo : [...new Set([...record.deliveredTo, recipient])];
  await db.update(supportMessages).set({ deliveredTo, errors }).where(eq(supportMessages.key, record.key)).run();
  record.deliveredTo = deliveredTo; record.errors = errors;
}
export async function startReply(chatId, customerId, orderId = null) {
  const prompt = await api.sendMessage({ chat_id: chatId, text: `✉️ Ответ покупателю ${customerId}${orderId ? ` по заказу №${orderId}` : ''}.\n\nОтветьте на это сообщение текстом, фото, файлом или голосовым. Покупатель получит сообщение от бота магазина. /cancel — выйти.`, reply_markup: { force_reply: true, input_field_placeholder: 'Ответ покупателю', selective: true } });
  await rememberMessage(chatId, prompt.message_id, customerId, orderId);
}
export async function handleChatCallback(query, customer) {
  if (!customer.isAdmin) { await api.sendMessage({ chat_id: query.message.chat.id, text: 'Доступно только администратору.' }); return; }
  const chatId = query.message.chat.id;
  const [, action, idText] = query.data.split(':'), id = Number(idText);
  if (!Number.isSafeInteger(id) || id <= 0) return;
  if (action === 'order') {
    const order = await db.select().from(orders).where(eq(orders.id, id)).get();
    if (order) await startReply(chatId, order.customerId, order.id);
  } else if (action === 'user' || action === 'open') {
    const conversation = await db.select().from(conversations).where(eq(conversations.customerId, id)).get();
    if (!conversation) { await api.sendMessage({ chat_id: chatId, text: 'Диалог не найден.' }); return; }
    if (action === 'user') await startReply(chatId, id);
    else await showConversation(chatId, id);
  }
}
export async function relayAdminReply(message) {
  const target = await replyTarget(message.chat.id, message.reply_to_message?.message_id);
  if (!target) return false;
  if (!supported(message)) { await api.sendMessage({ chat_id: message.chat.id, text: 'Отправьте текст, фото, файл или голосовое сообщение.' }); return true; }
  const record = await saveMessage(message, target.customerId, target.orderId, 'out');
  if (record.deliveredTo.includes(target.customerId)) return true;
  try {
    const sent = await api.copyMessage({ chat_id: target.customerId, from_chat_id: message.chat.id, message_id: message.message_id, reply_markup: { inline_keyboard: [[{ text: '✉️ Ответить магазину', callback_data: 'support:write' }]] } });
    await rememberMessage(target.customerId, sent.message_id, target.customerId, target.orderId);
    await deliveryResult(record, target.customerId);
    await db.update(conversations).set({ unread: false, updatedAt: now() }).where(eq(conversations.customerId, target.customerId)).run();
    await api.sendMessage({ chat_id: message.chat.id, text: `✅ Ответ доставлен покупателю ${target.customerId}${target.orderId ? ` · заказ №${target.orderId}` : ''}.`, reply_markup: answerKeyboard(target.customerId, target.orderId) });
  } catch (error) {
    await deliveryResult(record, target.customerId, error);
    await api.sendMessage({ chat_id: message.chat.id, text: `Не удалось доставить ответ покупателю. ${errorText(error)}\nОтправьте ответ ещё раз после устранения причины.` });
  }
  return true;
}
export async function relayCustomerMessage(message) {
  if (!supported(message)) return false;
  const customerId = message.from.id;
  const linked = await replyTarget(message.chat.id, message.reply_to_message?.message_id);
  const latest = await latestOrder(customerId);
  const orderId = linked?.customerId === customerId ? linked.orderId : latest?.id || null;
  const record = await saveMessage(message, customerId, orderId, 'in');
  const name = (message.from.first_name || 'Покупатель').slice(0, 100);
  const preview = (message.text || message.caption || (message.voice ? 'Голосовое сообщение' : message.photo ? 'Фото' : 'Вложение')).slice(0, 300);
  await db.insert(conversations).values({ customerId, customerName: name, unread: true, updatedAt: now(), preview }).onConflictDoUpdate({ target: conversations.customerId, set: { customerName: name, unread: true, updatedAt: now(), preview } }).run();
  const recipients = await adminIds();
  for (const adminId of recipients) {
    if (record.deliveredTo.includes(adminId)) continue;
    try {
      const header = await api.sendMessage({ chat_id: adminId, text: `💬 ${name} (ID ${customerId})${orderId ? ` · заказ №${orderId}` : ''}\nОтветьте на это сообщение или на сообщение ниже — ответ получит покупатель через бота.`, reply_markup: answerKeyboard(customerId, orderId) });
      await rememberMessage(adminId, header.message_id, customerId, orderId);
      const copy = await api.copyMessage({ chat_id: adminId, from_chat_id: message.chat.id, message_id: message.message_id, reply_markup: answerKeyboard(customerId, orderId) });
      await rememberMessage(adminId, copy.message_id, customerId, orderId);
      await deliveryResult(record, adminId);
    } catch (error) { await deliveryResult(record, adminId, error); console.warn('Customer message delivery failed', adminId, errorText(error)); }
  }
  const delivered = recipients.some(id => record.deliveredTo.includes(id));
  await api.sendMessage({ chat_id: message.chat.id, text: delivered ? '✅ Сообщение передано магазину. Ответ придёт сюда, в чат бота.' : 'Сообщение сохранено в обращениях, но доставить уведомление сейчас не удалось. Магазин увидит его в «Диалогах».', reply_markup: { inline_keyboard: [[{ text: '🛒 Меню заказа', callback_data: 'order:menu' }]] } });
  return true;
}
export async function showInbox(chatId, offset = 0) {
  const rows = await db.select().from(conversations).orderBy(desc(conversations.updatedAt)).limit(10).offset(offset).all();
  const keyboard = rows.map(row => [{ text: `${row.unread ? '🔴' : '💬'} ${row.customerName} · ${row.preview.slice(0, 30)}`, callback_data: `chat:open:${row.customerId}` }]);
  const navigation = [];
  if (offset) navigation.push({ text: '← Новее', callback_data: `inbox:${Math.max(0, offset - 10)}` });
  if (rows.length === 10) navigation.push({ text: 'Раньше →', callback_data: `inbox:${offset + 10}` });
  if (navigation.length) keyboard.push(navigation);
  keyboard.push([{ text: '⬅️ Меню магазина', callback_data: 'admin:menu' }]);
  await api.sendMessage({ chat_id: chatId, text: rows.length ? '💬 Диалоги с покупателями. Выберите обращение.' : 'Диалогов пока нет. Сообщения покупателей появятся здесь.', reply_markup: { inline_keyboard: keyboard } });
}
export async function showConversation(chatId, customerId) {
  const rows = await db.select().from(supportMessages).where(eq(supportMessages.customerId, customerId)).orderBy(desc(supportMessages.createdAt)).limit(10).all();
  await db.update(conversations).set({ unread: false }).where(eq(conversations.customerId, customerId)).run();
  await api.sendMessage({ chat_id: chatId, text: `💬 Последние сообщения покупателя ${customerId} и магазина:`, reply_markup: answerKeyboard(customerId, null) });
  for (const row of rows.reverse()) {
    try {
      const label = await api.sendMessage({ chat_id: chatId, text: row.direction === 'in' ? 'Покупатель:' : 'Магазин:' });
      await rememberMessage(chatId, label.message_id, customerId, row.orderId);
      const copy = await api.copyMessage({ chat_id: chatId, from_chat_id: row.sourceChatId, message_id: row.sourceMessageId, reply_markup: answerKeyboard(customerId, row.orderId) });
      await rememberMessage(chatId, copy.message_id, customerId, row.orderId);
    } catch { await api.sendMessage({ chat_id: chatId, text: 'Это сообщение больше недоступно в Telegram.' }); }
  }
}
