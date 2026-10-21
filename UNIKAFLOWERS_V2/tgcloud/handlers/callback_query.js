import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { customers } from '../schema.js';
import { orderKeyboard } from '../lib/shop.js';
import { mainKeyboard } from '../lib/navigation.js';
import { handleChatCallback, showInbox } from '../lib/conversation.js';
import { handleAdminCallback } from '../lib/admin-callback.js';
import { isAdmin } from '../lib/access.js';
import { showMyOrders } from '../lib/customer-menu.js';
import cancelOrder from '../endpoints/cancelOrder.js';
import { sharedCallback, showSharedOrders } from '../lib/shared-shop.js';

export default async function handleCallback(query) {
  if (!query?.id || query.message?.chat?.type !== 'private' || !query.from?.id) return;
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  await api.answerCallbackQuery({ callback_query_id: query.id });
  const stored = await db.select().from(customers).where(eq(customers.telegramId, userId)).get();
  const customer = { ...stored, isAdmin: await isAdmin(userId) };
  if (query.data?.startsWith('web:')) { await sharedCallback(query); return; }

  if (query.data?.startsWith('chat:')) { await handleChatCallback(query, customer); return; }
  if (query.data?.startsWith('inbox:')) {
    if (customer.isAdmin) { const offset = Number(query.data.split(':')[1]); if (Number.isInteger(offset) && offset >= 0) await showInbox(chatId, offset); }
    return;
  }
  if (query.data === 'support:write' || query.data === 'order:seller') {
    await db.insert(customers).values({ telegramId: userId, menu: 'support' }).onConflictDoUpdate({ target: customers.telegramId, set: { menu: 'support', awaitingOrder: false, adminStep: null, draft: null } }).run();
    await api.sendMessage({ chat_id: chatId, text: 'Напишите сообщение магазину прямо здесь. Можно отправить текст, фото, файл или голосовое. Ответ придёт через бота. /cancel — выйти.' });
    return;
  }

  if (query.data?.startsWith('admin:')) {
    await handleAdminCallback(query, customer);
    return;
  }
  if (query.data?.startsWith('order:history:')) {
    const offset = Number(query.data.split(':')[2]);
    if (Number.isInteger(offset) && offset >= 0) await showMyOrders(chatId, userId, offset);
  } else if (query.data?.startsWith('order:cancel:')) {
    const [, , id, version] = query.data.split(':');
    await api.sendMessage({ chat_id: chatId, text: `Отменить заявку №${Number(id)}?`, reply_markup: { inline_keyboard: [[{ text: 'Да, отменить', callback_data: `order:confirmcancel:${id}:${version}` }, { text: 'Оставить', callback_data: 'order:mine' }]] } });
  } else if (query.data?.startsWith('order:confirmcancel:')) {
    const [, , id, version] = query.data.split(':');
    try {
      await cancelOrder({ id: Number(id), version: Number(version) }, { initData: { user: query.from } });
      await api.sendMessage({ chat_id: chatId, text: `Заявка №${Number(id)} отменена.`, reply_markup: orderKeyboard() });
    } catch (error) { await api.sendMessage({ chat_id: chatId, text: error.message || 'Не удалось отменить заявку. Обновите историю.' }); }
  } else if (query.data === 'order:new') {
    await db.insert(customers).values({ telegramId: userId, awaitingOrder: true, menu: 'order' })
      .onConflictDoUpdate({ target: customers.telegramId, set: { awaitingOrder: true, menu: 'order' } }).run();
    await api.sendMessage({ chat_id: chatId, text: '📝 Напишите одним сообщением названия сортов и количество растений, способ получения и пожелания. Заявка сохранится отдельно в истории. /cancel — отменить ввод.', reply_markup: orderKeyboard() });
  } else if (query.data === 'order:mine') {
    await db.update(customers).set({ awaitingOrder: false }).where(eq(customers.telegramId, userId)).run();
    await showSharedOrders(chatId, query.from);
    await showMyOrders(chatId, userId);
  } else if (query.data === 'order:back') {
    await db.update(customers).set({ awaitingOrder: false, menu: 'home' }).where(eq(customers.telegramId, userId)).run();
    await api.sendMessage({ chat_id: chatId, text: '⬅️ Главное меню', reply_markup: await mainKeyboard(userId, customer.isAdmin) });
  } else if (query.data === 'order:menu') {
    await db.update(customers).set({ awaitingOrder: false }).where(eq(customers.telegramId, userId)).run();
    await api.sendMessage({ chat_id: chatId, text: '🛒 Меню заказа', reply_markup: orderKeyboard() });
  }
}
