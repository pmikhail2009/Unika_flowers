import { api, db } from 'sdk';
import { eq, and, gt } from 'sdk/db';
import { customers, products, orders } from '../schema.js';
import { orderKeyboard } from '../lib/shop.js';
import { mainKeyboard } from '../lib/navigation.js';
import { relayAdminReply, relayCustomerMessage, showInbox, startReply } from '../lib/conversation.js';
import { retryNotifications } from '../lib/notifications.js';
import { replyTarget } from '../lib/message-links.js';
import { isAdmin, logAction } from '../lib/access.js';
import { APP_URL } from '../lib/config.js';
import { getSettings } from '../lib/settings.js';
import { showMyOrders } from '../lib/customer-menu.js';
import { createOrder } from '../lib/orders.js';
import { parseHeight } from '../lib/catalog.js';
import { setAdminState, showAdminMenu, showDraft, showOrderList } from '../lib/admin.js';
import { showSharedOrders, sharedReply } from '../lib/shared-shop.js';

async function handleAdminInput(message, customer) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const step = customer.adminStep;
  const draft = customer.draft || {};
  const editing = step.startsWith('edit:');
  const field = editing ? step.slice(5) : step;
  const text = message.text?.trim() || '';

  if (step.startsWith('price:')) {
    const price = Number(text);
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(price) || price > 100_000_000) {
      await api.sendMessage({ chat_id: chatId, text: 'Отправьте цену целым числом в рублях или 0, чтобы убрать её.' });
      return;
    }
    const [, idText, versionText] = step.split(':');
    const id = Number(idText), version = Number(versionText);
    const rows = await db.update(products).set({ price: price || null, version: version + 1 }).where(and(eq(products.id, id), eq(products.version, version))).returning().run();
    await setAdminState(userId, null);
    if (!rows.length) {
      await api.sendMessage({ chat_id: chatId, text: 'Товар уже изменён. Откройте изменение цены снова.' });
      await showAdminMenu(chatId);
      return;
    }
    await logAction(userId, 'product:price', id);
    await api.sendMessage({ chat_id: chatId, text: price ? `💰 Цена сохранена: ${price} ₽.` : '💰 Цена убрана.' });
    await showAdminMenu(chatId);
    return;
  }

  if (field === 'photo') {
    const photo = [...(message.photo || [])].reverse().find((item) => !item.file_size || item.file_size <= 750_000);
    if (!photo?.file_id) {
      await api.sendMessage({ chat_id: chatId, text: '📷 Отправьте фото размером до 750 КБ.' });
      return;
    }
    draft.photoFileId = photo.file_id;
    await setAdminState(userId, editing ? 'preview' : 'name', draft);
    if (editing) await showDraft(chatId, draft);
    else await api.sendMessage({ chat_id: chatId, text: '🏷️ Название: отправьте название товара отдельным сообщением.' });
    return;
  }
  if (field === 'name') {
    if (!text || text.length > 100) {
      await api.sendMessage({ chat_id: chatId, text: '🏷️ Отправьте название длиной до 100 символов.' });
      return;
    }
    draft.name = text;
    await setAdminState(userId, editing ? 'preview' : 'height', draft);
    if (editing) await showDraft(chatId, draft);
    else await api.sendMessage({ chat_id: chatId, text: '📏 Высота: отправьте диапазон, например «80–120 см» или «0,8–1,2 м».' });
    return;
  }
  if (field === 'height') {
    const height = parseHeight(text);
    if (!height) {
      await api.sendMessage({ chat_id: chatId, text: '📏 Укажите высоту числом или диапазоном: «80–120 см».' });
      return;
    }
    [draft.heightMin, draft.heightMax] = height;
    await setAdminState(userId, editing ? 'preview' : 'tag', draft);
    if (editing) await showDraft(chatId, draft);
    else await api.sendMessage({ chat_id: chatId, text: '📝 Доп. надпись: отправьте короткое описание товара отдельным сообщением.' });
    return;
  }
  if (field === 'tag') {
    if (!text || text.length > 300) {
      await api.sendMessage({ chat_id: chatId, text: '📝 Отправьте надпись длиной до 300 символов.' });
      return;
    }
    draft.shortDescription = text;
    await setAdminState(userId, 'preview', draft);
    await showDraft(chatId, draft);
  }
}

export default async function handleMessage(message) {
  if (message?.chat?.type !== 'private' || !message.from?.id) return;
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text?.trim() || '';
  const stored = await db.select().from(customers).where(eq(customers.telegramId, userId)).get();
  const customer = { ...stored, isAdmin: await isAdmin(userId) };

  const command = text.split(/\s+/)[0]?.split('@')[0];
  if (!text.startsWith('/') && message.reply_to_message && await sharedReply(message)) return;
  if (command === '/start' && /^reply_\d+$/.test(text.split(/\s+/)[1] || '')) {
    if (!customer.isAdmin) { await api.sendMessage({ chat_id: chatId, text: 'Доступно только администратору.' }); return; }
    const order = await db.select().from(orders).where(eq(orders.id, Number(text.split('_').at(-1)))).get();
    if (order) await startReply(chatId, order.customerId, order.id);
    else await api.sendMessage({ chat_id: chatId, text: 'Заказ не найден.' });
    return;
  }
  if (command === '/id') {
    await api.sendMessage({ chat_id: chatId, text: `Ваш Telegram ID: ${userId}` });
    return;
  }
  if (command === '/cancel') {
    await db.update(customers).set({ awaitingOrder: false, adminStep: null, draft: null, menu: 'home' }).where(eq(customers.telegramId, userId)).run();
    await api.sendMessage({ chat_id: chatId, text: 'Текущий ввод отменён. Сохранённые заказы остались в истории.', reply_markup: await mainKeyboard(userId, customer.isAdmin) });
    return;
  }
  if (command === '/catalog') {
    await api.sendMessage({ chat_id: chatId, text: '🌸 Коллекция гортензий', reply_markup: { inline_keyboard: [[{ text: 'Открыть магазин', web_app: { url: APP_URL } }]] } });
    return;
  }
  if (command === '/orders' || text === '📦 Мои заказы' || /^📦 Заказы(?: \(\d+\))?$/.test(text)) {
    await db.update(customers).set({ awaitingOrder: false, adminStep: null, draft: null }).where(eq(customers.telegramId, userId)).run();
    await showSharedOrders(chatId, message.from);
    if (customer.isAdmin) await showOrderList(chatId, false);
    else await showMyOrders(chatId, userId);
    return;
  }
  if (customer.isAdmin && /^🔔 Уведомления(?: \(\d+\))?$/.test(text)) {
    await showOrderList(chatId, true);
    return;
  }
  if (customer.isAdmin && (command === '/inbox' || /^💬 Диалоги(?: \(\d+\))?$/.test(text))) {
    await showInbox(chatId);
    return;
  }
  if (command === '/support' || text === '✉️ Написать магазину' || (command === '/start' && text.split(/\s+/)[1] === 'support')) {
    await db.insert(customers).values({ telegramId: userId, menu: 'support' }).onConflictDoUpdate({ target: customers.telegramId, set: { awaitingOrder: false, adminStep: null, draft: null, menu: 'support' } }).run();
    await api.sendMessage({ chat_id: chatId, text: 'Напишите сообщение магазину здесь. Можно отправить текст, фото, файл или голосовое. Ответ придёт от бота в этот чат. /cancel — выйти.' });
    return;
  }
  if (command === '/start') {
    await db.insert(customers).values({ telegramId: userId })
      .onConflictDoUpdate({ target: customers.telegramId, set: { awaitingOrder: false, adminStep: null, draft: null, menu: 'home' } }).run();
    const name = message.from.first_name?.trim() || 'друг';
    await api.sendMessage({ chat_id: chatId, text: customer.isAdmin ? `Здравствуйте, ${name}!\n\n«Заказы» — активные заявки покупателей (завершённые и отменённые доступны в архиве), «Уведомления» — ваши непрочитанные заказы, «Диалоги» — переписка через бота. Чтобы ответить покупателю, нажмите кнопку в карточке или используйте «Ответить» на его сообщение.` : `Здравствуйте, ${name}! Добро пожаловать в Unica & Flowers. Нажмите «🛒 Заказ», чтобы выбрать гортензии. Любой вопрос можно написать здесь — ответ магазина придёт через бота.`, reply_markup: await mainKeyboard(userId, customer.isAdmin) });
    if (customer.isAdmin) await retryNotifications(userId);
    return;
  }
  if (command === '/help' || text === '❓ /help') {
    await api.sendMessage({ chat_id: chatId, text: customer.isAdmin
      ? '📦 /orders — активные заказы покупателей; архив — по кнопке под списком\n💬 /inbox — диалоги с покупателями\n🛠 /admin — управление магазином\n🌸 /catalog — сайт магазина\n↩️ /cancel — отменить текущий ввод\n\nНажмите «Ответить через бота» в заказе или ответьте функцией Telegram «Ответить» на сообщение покупателя. Покупатель получит сообщение от бота магазина. Текст без выбранного адресата не пересылается.'
      : '🌸 /catalog — магазин и корзина\n📦 /orders — мои заказы и статусы\n📝 /order — заявка текстом\n✉️ /support — написать магазину\n↩️ /cancel — отменить текущий ввод\n🆔 /id — ваш Telegram ID\n\nВ магазине выберите сорта, количество и получение. Продавец подтвердит наличие и итоговую стоимость. До подтверждения заявку можно отменить в истории.\n\nДля помощи напишите сообщение прямо здесь: ответ магазина придёт в чат бота.' });
    return;
  }
  if (text === '🛒 Заказ' || text.toLocaleLowerCase('ru-RU') === 'заказ' || command === '/order') {
    await db.insert(customers).values({ telegramId: userId, menu: 'order' })
      .onConflictDoUpdate({ target: customers.telegramId, set: { awaitingOrder: false, adminStep: null, draft: null, menu: 'order' } }).run();
    await api.sendMessage({ chat_id: chatId, text: '🛒 Меню заказа', reply_markup: { remove_keyboard: true } });
    await api.sendMessage({ chat_id: chatId, text: 'Как помочь с заказом?', reply_markup: orderKeyboard() });
    return;
  }
  if (customer.isAdmin && (text === '🛠 Изменить магазин' || command === '/admin')) {
    await db.insert(customers).values({ telegramId: userId, menu: 'admin' }).onConflictDoUpdate({ target: customers.telegramId, set: { menu: 'admin', awaitingOrder: false, adminStep: null, draft: null } }).run();
    await api.sendMessage({ chat_id: chatId, text: '🛠 Панель магазина', reply_markup: await mainKeyboard(userId, true) });
    await showAdminMenu(chatId);
    return;
  }

  // Explicit Telegram replies take precedence over product editing state.
  // Only an authenticated admin may resolve another customer's message target.
  if (customer.isAdmin && message.reply_to_message && await relayAdminReply(message)) return;
  if (!customer.isAdmin && message.reply_to_message) {
    const target = await replyTarget(chatId, message.reply_to_message.message_id);
    if (target?.customerId === userId && await relayCustomerMessage(message)) return;
  }
  if (customer.menu === 'support') {
    if (await relayCustomerMessage(message)) return;
  }
  if (customer?.isAdmin && customer.adminStep && customer.adminStep !== 'preview') {
    await handleAdminInput(message, customer);
    return;
  }
  if (customer?.awaitingOrder) {
    if (!(await getSettings()).orderingOpen) {
      await api.sendMessage({ chat_id: chatId, text: 'Приём заявок временно приостановлен. Напишите @unika_flowers.' });
      return;
    }
    if (!text || text.startsWith('/')) {
      await api.sendMessage({ chat_id: chatId, text: '📝 Напишите одним сообщением сорта и количество растений.' });
      return;
    }
    if (text.length > 2000) {
      await api.sendMessage({ chat_id: chatId, text: 'Сообщение слишком длинное. Сократите заявку до 2000 символов.' });
      return;
    }
    if (await db.$count(orders, and(eq(orders.customerId, userId), gt(orders.createdAt, Math.floor(Date.now() / 1000) - 60))) >= 3) {
      await api.sendMessage({ chat_id: chatId, text: 'Вы уже отправили несколько заявок. Подождите минуту или проверьте /orders.' });
      return;
    }
    const order = await createOrder({ userId, customerName: message.from.first_name || 'Покупатель', items: [], note: text, source: 'chat', requestKey: `chat:${message.message_id}` });
    await db.insert(customers).values({ telegramId: userId, orderText: text })
      .onConflictDoUpdate({ target: customers.telegramId, set: { orderText: text, awaitingOrder: false } }).run();
    await api.sendMessage({ chat_id: chatId, text: `✅ Заявка №${order.id} сохранена. Она доступна в «Мой заказ».`, reply_markup: orderKeyboard() });
    return;
  }

  if (!customer.isAdmin && !text.startsWith('/') && await relayCustomerMessage(message)) return;
  if (customer?.menu === 'order') {
    await api.sendMessage({ chat_id: chatId, text: 'Используйте кнопки меню заказа.', reply_markup: orderKeyboard() });
  } else if (customer?.menu === 'admin') {
    await showAdminMenu(chatId);
  } else {
    await api.sendMessage({ chat_id: chatId, text: customer.isAdmin ? 'Откройте «Заказы» или «Диалоги», чтобы выбрать покупателя. Ответьте на его сообщение или нажмите «Ответить через бота».' : 'Нажмите «🛒 Заказ» или напишите вопрос магазину здесь.', reply_markup: await mainKeyboard(userId, customer.isAdmin) });
  }
}
