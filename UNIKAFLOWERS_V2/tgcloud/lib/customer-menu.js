import { api } from 'sdk';
import { myOrders, formatOrder } from './orders.js';
import { orderKeyboard } from './shop.js';

export async function showMyOrders(chatId, userId, offset = 0) {
  const rows = await myOrders(userId, offset);
  if (!rows.length) {
    await api.sendMessage({ chat_id: chatId, text: offset ? 'Других заказов пока нет.' : 'У вас пока нет заказов. Выберите сорта в каталоге или отправьте заявку текстом.', reply_markup: orderKeyboard() });
    return;
  }
  for (const order of rows) {
    const keyboard = order.status === 'new' ? [[{ text: 'Отменить заявку', callback_data: `order:cancel:${order.id}:${order.version}` }]] : [];
    keyboard.push([{ text: '✉️ Написать магазину', callback_data: 'support:write' }]);
    await api.sendMessage({ chat_id: chatId, text: formatOrder(order).slice(0, 4000), reply_markup: { inline_keyboard: keyboard } });
  }
  const navigation = [];
  if (offset) navigation.push({ text: '← Новее', callback_data: `order:history:${Math.max(0, offset - 10)}` });
  if (rows.length === 10) navigation.push({ text: 'Раньше →', callback_data: `order:history:${offset + 10}` });
  await api.sendMessage({ chat_id: chatId, text: 'Все заявки сохраняются в истории. Изменения подтверждённых заказов обсудите с продавцом.', reply_markup: { inline_keyboard: [...(navigation.length ? [navigation] : []), [{ text: '🛒 Меню заказа', callback_data: 'order:menu' }]] } });
}
