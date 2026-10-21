import { api, db, fetch } from 'sdk';
import { eq } from 'sdk/db';
import { settings } from '../schema.js';
import { isAdmin, isOwner } from './access.js';

export async function sharedCall(user, input) {
  const config = (await db.select().from(settings).where(eq(settings.key, 'site-bridge')).get())?.value;
  if (!config?.secret || config.origin !== 'https://unika-flowers-garden.brainy-chick-3547.chatgpt.site') return null;
  const response = await fetch(`${config.origin}/api/telegramBridge`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Unica-Bridge': config.secret },
    body: JSON.stringify({ action: 'bot', input, telegram: { id: user.id, name: user.first_name || user.username || '', isAdmin: await isAdmin(user.id), isOwner: isOwner(user.id) } }) });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error?.message || 'Магазин временно недоступен. Повторите позже.');
  return data.result;
}
export async function showSharedOrders(chatId, user, offset = 0, scope) {
  try {
    const data = await sharedCall(user, { action: 'list', offset, scope });
    if (!data) return;
    await api.sendMessage({ chat_id: chatId, text: data.orders.length ? '🌸 Заказы с сайта и Mini App:' : '🌸 Заказов с сайта и Mini App пока нет.',
      reply_markup: { inline_keyboard: [[{ text: scope === 'archive' ? 'Активные заказы сайта' : 'Архив заказов сайта', callback_data: `web:list:0:${scope === 'archive' ? 'active' : 'archive'}` }]] } });
    for (const order of data.orders) {
      const sent = await api.sendMessage({ chat_id: chatId, text: order.text, reply_markup: order.keyboard });
      // Reply works on cards opened from /orders as well as on notifications.
      const id = order.id;
      if (id) await sharedCall(user, { action: 'link', id, messageId: sent.message_id });
    }
    if (data.hasMore) await api.sendMessage({ chat_id: chatId, text: 'Следующая страница:', reply_markup: { inline_keyboard: [[{ text: 'Ещё заказы сайта', callback_data: `web:list:${offset + 5}:${scope || 'active'}` }]] } });
  } catch (error) { await api.sendMessage({ chat_id: chatId, text: `Заказы сайта: ${error.message}` }); }
}
export async function sharedReply(message) {
  if (!message.reply_to_message?.message_id) return false;
  try {
    const data = await sharedCall(message.from, { action: 'reply', replyTo: message.reply_to_message.message_id, messageId: message.message_id, text: message.text || '' });
    if (!data?.handled) return false;
    await api.sendMessage({ chat_id: message.chat.id, text: data.text });
    return true;
  } catch (error) {
    await api.sendMessage({ chat_id: message.chat.id, text: `Ответ не отправлен. ${error.message}` });
    return true;
  }
}
export async function sharedCallback(query) {
  const chatId = query.message.chat.id, [, action, idText, versionText, status] = query.data.split(':');
  const id = Number(idText);
  try {
    if (action === 'list') { await showSharedOrders(chatId, query.from, id, versionText); return; }
    if (!Number.isSafeInteger(id) || id <= 0) return;
    if (action === 'status') {
      const data = await sharedCall(query.from, { action: 'status', id, version: Number(versionText), status });
      if (data) await api.sendMessage({ chat_id: chatId, text: data.text, reply_markup: data.keyboard });
    } else if (action === 'reply') {
      const data = await sharedCall(query.from, { action: 'prompt', id });
      if (!data) return;
      const prompt = await api.sendMessage({ chat_id: chatId, text: data.text, reply_markup: { force_reply: true, selective: true } });
      await sharedCall(query.from, { action: 'link', id, messageId: prompt.message_id });
    }
  } catch (error) { await api.sendMessage({ chat_id: chatId, text: error.message }); }
}
