import { APP_URL } from './config.js';

export const SELLER_URL = 'https://t.me/unika_flowers';

export function homeKeyboard(isAdmin = false, orderCount = 0, unread = 0, messages = 0) {
  if (isAdmin) return { keyboard: [
    [{ text: `📦 Заказы (${orderCount})` }, { text: `🔔 Уведомления (${unread})` }],
    [{ text: `💬 Диалоги (${messages})` }, { text: '🛠 Изменить магазин' }],
    [{ text: '🌸 Каталог', web_app: { url: APP_URL } }, { text: '❓ /help' }],
  ], resize_keyboard: true, is_persistent: true };
  const keyboard = [[{ text: '🛒 Заказ' }, { text: '❓ /help' }]];
  keyboard.push([{ text: '📦 Мои заказы' }, { text: '✉️ Написать магазину' }]);
  return { keyboard, resize_keyboard: true, is_persistent: true };
}

export function orderKeyboard() {
  const rows = [];
  if (APP_URL) rows.push([{ text: '🌸 Открыть каталог', web_app: { url: APP_URL } }]);
  rows.push([{ text: '📝 Оформить заказ', callback_data: 'order:new' }]);
  rows.push([{ text: '📦 Мой заказ', callback_data: 'order:mine' }, { text: '📞 Вызов продавца', callback_data: 'order:seller' }]);
  rows.push([{ text: '⬅️ Назад', callback_data: 'order:back' }]);
  rows.splice(rows.length - 1, 0, [{ text: '✉️ Написать магазину', callback_data: 'support:write' }]);
  return { inline_keyboard: rows };
}

export function orderSummary(orderText) {
  return orderText ? `Ваша заявка:\n\n${orderText}\n\nНаличие, стоимость и условия получения уточняются у продавца.` : 'У вас пока нет заказа. Нажмите «Оформить заказ» и напишите, какие сорта и в каком количестве вам нужны.';
}

export function adminKeyboard(unread, current) {
  return { inline_keyboard: [
    [{ text: '🌐 Панель магазина', web_app: { url: APP_URL + '?admin=1' } }],
    [{ text: '➖ Убрать из ассортимента', callback_data: 'admin:remove' }],
    [{ text: '➕ Добавить в ассортимент', callback_data: 'admin:add' }],
    [{ text: '💰 Добавить/изменить цены', callback_data: 'admin:prices' }],
    [{ text: `🔔 Уведомления (${unread})`, callback_data: 'admin:notifications' }],
    [{ text: `📦 Текущие заказы (${current})`, callback_data: 'admin:orders' }],
    [{ text: '🗂 Архив заказов', callback_data: 'admin:archive:0' }],
    [{ text: '♻️ Вернуть скрытый сорт', callback_data: 'admin:restore' }],
    [{ text: '⬅️ Назад', callback_data: 'admin:back' }],
  ] };
}

export function draftKeyboard() {
  return { inline_keyboard: [
    [{ text: '✅ Готово', callback_data: 'admin:draft:save' }, { text: '✏️ Изменить', callback_data: 'admin:draft:edit' }],
    [{ text: '🗑️ Удалить', callback_data: 'admin:draft:delete' }],
  ] };
}
