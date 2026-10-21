import { api, db } from 'sdk';
import { eq, and } from 'sdk/db';
import { customers, orders, products } from '../schema.js';
import { photoData, productById } from './catalog.js';
import { mainKeyboard } from './navigation.js';
import { markNotificationRead, retryNotifications } from './notifications.js';
import { setAdminState, showAdminMenu, showDraft, showOrderList, showProductList, showAdminOrder } from './admin.js';
import { changeOrderStatus } from './orders.js';
import { logAction } from './access.js';
import { STATUSES, ARCHIVED_ORDER_STATUSES } from './validation.js';
import { showSharedOrders } from './shared-shop.js';

export async function handleAdminCallback(query, customer) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  if (!customer?.isAdmin) {
    await api.sendMessage({ chat_id: chatId, text: 'Доступно только администратору.' });
    return;
  }
  const data = query.data;
  if (data !== 'admin:back') await db.update(customers).set({ menu: 'admin' }).where(eq(customers.telegramId, userId)).run();
  if (data === 'admin:menu') {
    await setAdminState(userId, null);
    await db.update(customers).set({ menu: 'admin' }).where(eq(customers.telegramId, userId)).run();
    await showAdminMenu(chatId);
  } else if (data === 'admin:back') {
    await setAdminState(userId, null);
    await db.update(customers).set({ menu: 'home' }).where(eq(customers.telegramId, userId)).run();
    await api.sendMessage({ chat_id: chatId, text: 'Главное меню', reply_markup: await mainKeyboard(userId, true) });
  } else if (data === 'admin:add') {
    await setAdminState(userId, 'photo', {});
    await api.sendMessage({ chat_id: chatId, text: '📷 Фото: отправьте фотографию товара отдельным сообщением.' });
  } else if (data === 'admin:remove' || data === 'admin:prices' || data === 'admin:restore') {
    await showProductList(chatId, data === 'admin:prices' ? 'price' : data === 'admin:restore' ? 'restore' : 'remove');
  } else if (data.startsWith('admin:remove:')) {
    const id = Number(data.split(':')[2]);
    const product = await productById(id);
    if (!product?.active) return;
    await api.sendMessage({ chat_id: chatId, text: `Скрыть «${product.name}» из каталога?`, reply_markup: { inline_keyboard: [[{ text: 'Да, скрыть', callback_data: `admin:hide:${id}:${product.version}` }, { text: 'Назад', callback_data: 'admin:menu' }]] } });
  } else if (data.startsWith('admin:hide:') || data.startsWith('admin:restore:')) {
    const [, action, idText, versionText] = data.split(':');
    const id = Number(idText);
    const product = await productById(id);
    if (!product || (action === 'hide' && product.version !== Number(versionText))) {
      await api.sendMessage({ chat_id: chatId, text: 'Товар уже изменён. Обновите список.' });
      return;
    }
    const changed = await db.update(products).set({ active: action === 'restore', version: product.version + 1 }).where(and(eq(products.id, id), eq(products.version, product.version))).returning().run();
    if (!changed.length) { await api.sendMessage({ chat_id: chatId, text: 'Товар уже изменён. Обновите список.' }); return; }
    await logAction(userId, `product:${action}`, id);
    await api.sendMessage({ chat_id: chatId, text: `${product.name}: ${action === 'restore' ? 'возвращён в каталог' : 'скрыт'}.` });
    await showAdminMenu(chatId);
  } else if (data.startsWith('admin:price:')) {
    const id = Number(data.split(':')[2]);
    const product = await productById(id);
    if (!product?.active) return;
    await setAdminState(userId, `price:${id}:${product.version}`);
    await api.sendMessage({ chat_id: chatId, text: `💰 Цена для «${product.name}»: отправьте сумму в рублях одним сообщением. Отправьте 0, чтобы убрать цену.` });
  } else if (data === 'admin:draft:edit') {
    await api.sendMessage({ chat_id: chatId, text: 'Что изменить?', reply_markup: { inline_keyboard: [
      [{ text: '📷 Фото', callback_data: 'admin:draft:field:photo' }, { text: '🏷️ Название', callback_data: 'admin:draft:field:name' }],
      [{ text: '📏 Высота', callback_data: 'admin:draft:field:height' }, { text: '📝 Доп. надпись', callback_data: 'admin:draft:field:tag' }],
      [{ text: '⬅️ Назад', callback_data: 'admin:draft:preview' }],
    ] } });
  } else if (data.startsWith('admin:draft:field:')) {
    const field = data.split(':')[3];
    if (!['photo', 'name', 'height', 'tag'].includes(field) || !customer.draft) return;
    await setAdminState(userId, `edit:${field}`, customer.draft);
    const labels = { photo: '📷 Фото:', name: '🏷️ Название:', height: '📏 Высота:', tag: '📝 Доп. надпись:' };
    await api.sendMessage({ chat_id: chatId, text: `${labels[field]} отправьте новое значение отдельным сообщением.` });
  } else if (data === 'admin:draft:preview') {
    if (customer.draft?.photoFileId) await showDraft(chatId, customer.draft);
  } else if (data === 'admin:draft:delete') {
    await setAdminState(userId, null);
    await api.sendMessage({ chat_id: chatId, text: '🗑️ Товар не добавлен.' });
    await showAdminMenu(chatId);
  } else if (data === 'admin:draft:save') {
    const draft = customer.draft;
    if (!draft?.photoFileId || !draft?.name || !draft?.heightMin || !draft?.shortDescription) return;
    try {
      const image = await photoData(draft.photoFileId);
      const [created] = await db.insert(products).values({
        name: draft.name,
        shortDescription: draft.shortDescription,
        description: draft.shortDescription,
        heightMin: draft.heightMin,
        heightMax: draft.heightMax,
        photoFileId: draft.photoFileId,
        photoData: image,
      }).returning().run();
      await logAction(userId, 'product:create', created.id);
      await setAdminState(userId, null);
      await api.sendMessage({ chat_id: chatId, text: `✅ «${draft.name}» добавлен в ассортимент и появится на сайте.` });
      await showAdminMenu(chatId);
    } catch (error) {
      console.error('Could not save product', error);
      await api.sendMessage({ chat_id: chatId, text: 'Не удалось сохранить фото. Отправьте фото меньшего размера через «Изменить» → «Фото».' });
    }
  } else if (data === 'admin:notifications' || data === 'admin:orders') {
    await showSharedOrders(chatId, query.from);
    await showOrderList(chatId, data === 'admin:notifications');
  } else if (data.startsWith('admin:read:')) {
    const id = Number(data.split(':')[2]);
    await markNotificationRead(userId, id);
    await api.sendMessage({ chat_id: chatId, text: `👀 Уведомление по заказу №${id} отмечено прочитанным.`, reply_markup: await mainKeyboard(userId, true) });
    await showAdminMenu(chatId);
  } else if (data === 'admin:retry') {
    await retryNotifications(userId);
    await api.sendMessage({ chat_id: chatId, text: 'Недоставленные уведомления проверены. Повторная попытка для одного заказа возможна через 30 секунд.', reply_markup: await mainKeyboard(userId, true) });
  } else if (data.startsWith('admin:page:') || data.startsWith('admin:archive:') || data.startsWith('admin:notices:') || data.startsWith('admin:all:')) {
    if (data === 'admin:archive:0') await showSharedOrders(chatId, query.from, 0, 'archive');
    const [, mode, offset] = data.split(':');
    if (Number.isInteger(Number(offset)) && Number(offset) >= 0) await showOrderList(chatId, mode === 'notices', Number(offset), mode === 'archive');
  } else if (data.startsWith('admin:view:') || data.startsWith('admin:done:')) {
    const id = Number(data.split(':')[2]);
    const order = await db.select().from(orders).where(eq(orders.id, id)).get();
    if (order) await showAdminOrder(chatId, order);
  } else if (data.startsWith('admin:status:')) {
    const [, , id, version, status] = data.split(':');
    await api.sendMessage({ chat_id: chatId, text: `Заказ №${Number(id)} → ${STATUSES[status] || '?'}. Подтвердить?`, reply_markup: { inline_keyboard: [[{ text: 'Подтвердить', callback_data: `admin:apply:${id}:${version}:${status}` }, { text: 'Назад', callback_data: `admin:view:${id}` }]] } });
  } else if (data.startsWith('admin:apply:')) {
    const [, , id, version, status] = data.split(':');
    try {
      const order = await changeOrderStatus({ id: Number(id), version: Number(version), status, actorId: userId });
      await markNotificationRead(userId, Number(id));
      await logAction(userId, `order:${status}`, id);
      if (ARCHIVED_ORDER_STATUSES.includes(order.status)) await showOrderList(chatId, false);
      else await showAdminOrder(chatId, order);
    } catch (error) {
      await api.sendMessage({ chat_id: chatId, text: error.message || 'Не удалось изменить заказ.' });
      const current = await db.select().from(orders).where(eq(orders.id, Number(id))).get();
      if (current) await showAdminOrder(chatId, current);
    }
  }
}
