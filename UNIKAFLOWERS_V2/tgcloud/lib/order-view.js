import { STATUSES, TRANSITIONS, ORDER_ACTION_LABELS, totals } from './validation.js';
export function formatOrder(order) {
  const lines = order.items?.length
    ? order.items.map((item, index) => `${index + 1}. ${item.name} × ${item.quantity}${item.price != null ? ` — ${item.price * item.quantity} ₽` : ' — цена уточняется'}`).join('\n') : order.note;
  const total = totals(order.items || []);
  const sum = order.items?.length ? `\n${total.complete ? 'Сумма' : 'Известная часть суммы'}: ${total.amount} ₽${total.complete ? '' : ' + товары без цены'}` : '';
  const note = order.items?.length && order.note ? `\nПожелания: ${order.note}` : '';
  const contact = order.contact;
  return `Заказ №${order.id}\n${lines}${sum}${note}${contact ? `\nПолучатель: ${contact.name}${contact.phone ? `\nТелефон: ${contact.phone}` : ''}\nПолучение: ${{ agree: 'согласовать', pickup: 'самовывоз', delivery: 'доставка' }[contact.delivery]}${contact.address ? `\nГород / адрес: ${contact.address}` : ''}` : ''}\nСтатус: ${STATUSES[order.status] || order.status}`;
}
export function orderActions(order, { open = true, read = false } = {}) {
  const keyboard = (TRANSITIONS[order.status] || []).map(status => [{
    text: order.status === 'cancelled' && status === 'confirmed' ? '↩️ Принять заново' : ORDER_ACTION_LABELS[status],
    callback_data: `admin:status:${order.id}:${order.version}:${status}`,
  }]);
  if (open) keyboard.push([{ text: '📦 Открыть заказ', callback_data: `admin:view:${order.id}` }]);
  if (read) keyboard.push([{ text: '👀 Прочитано', callback_data: `admin:read:${order.id}` }]);
  keyboard.push([{ text: '✉️ Ответить через бота', callback_data: `chat:order:${order.id}` }]);
  return { inline_keyboard: keyboard };
}
