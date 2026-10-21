export const $ = (selector, root = document) => root.querySelector(selector);
import { apiCall, telegram } from './transport.js?v=4.2';
export { telegram };
export const authenticated = true;
export const statuses = { new: 'Новый', confirmed: 'Подтверждён', preparing: 'Собирается', ready: 'Готов к получению', done: 'Завершён', cancelled: 'Отменён' };
export const transitions = { new: ['confirmed', 'cancelled'], confirmed: ['done', 'preparing', 'cancelled'], preparing: ['done', 'ready', 'cancelled'], ready: ['done', 'cancelled'], done: [], cancelled: ['confirmed'] };
export const orderActionLabels = { confirmed: 'Принять заказ', done: 'Завершить заказ', cancelled: 'Отменить заказ', preparing: 'Начать сборку', ready: 'Готов к выдаче' };
export const availability = { available: 'В наличии', preorder: 'Предзаказ', soldout: 'Нет в наличии' };
export const money = amount => `${Number(amount || 0).toLocaleString('ru-RU')} ₽`;
export const date = seconds => new Date(seconds * 1000).toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export function el(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
export function button(text, handler, className = 'button secondary') {
  const node = el('button', className, text); node.type = 'button'; node.onclick = handler; return node;
}
export function read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
export function write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
let toastTimer;
export function tell(message) {
  $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4000);
}
export async function call(name, input = {}) {
  return apiCall(name, input);
}
export function showModal(dialog) {
  if (dialog.open) return;
  dialog.returnFocus = document.activeElement; dialog.showModal();
  dialog.querySelector('[data-close]')?.focus(); syncBack();
}
export function wireDialogs() {
  const confirm = el('dialog'); confirm.id = 'confirm-dialog'; confirm.setAttribute('aria-labelledby', 'confirm-title');
  const box = el('div', 'confirm-box'), title = el('h3', '', 'Подтвердить действие?'); title.id = 'confirm-title';
  const message = el('p'); message.id = 'confirm-message'; const actions = el('div', 'order-actions');
  actions.append(button('Отмена', () => confirm.close('no'), 'button secondary'), button('Подтвердить', () => confirm.close('yes'), 'button'));
  box.append(title, message, actions); confirm.append(box); document.body.append(confirm);
  document.querySelectorAll('[data-close]').forEach(node => { if (node.closest('dialog').id !== 'editor-dialog') node.onclick = () => node.closest('dialog').close(); });
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog(dialog);
    });
    dialog.addEventListener('close', () => { if (dialog.returnFocus?.isConnected) dialog.returnFocus.focus({ preventScroll: true }); syncBack(); });
  });
  telegram?.BackButton?.onClick(() => { const dialog = [...document.querySelectorAll('dialog[open]')].at(-1); if (dialog) closeDialog(dialog); });
}
function closeDialog(dialog) { if (dialog.id === 'editor-dialog') dialog.querySelector('[data-close]').click(); else dialog.close(); }
export function confirmAction(message) {
  const dialog = $('#confirm-dialog'); $('#confirm-message').textContent = message; dialog.returnValue = '';
  return new Promise(resolve => { dialog.addEventListener('close', () => resolve(dialog.returnValue === 'yes'), { once: true }); showModal(dialog); });
}
function syncBack() { if (document.querySelector('dialog[open]')) telegram?.BackButton?.show(); else telegram?.BackButton?.hide(); }
export async function busy(node, work) {
  if (node.disabled) return;
  node.disabled = true; node.setAttribute('aria-busy', 'true');
  try { return await work(); } catch (error) { tell(error.message || 'Что-то пошло не так. Повторите действие.'); throw error; }
  finally { node.disabled = false; node.removeAttribute('aria-busy'); }
}
export function image(src, alt, className = '') {
  const node = el('img', className); node.src = src || '/assets/logo.png'; node.alt = alt;
  node.onerror = () => { node.onerror = null; node.src = '/assets/logo.png'; }; return node;
}
export function orderCard(order) {
  const card = el('article', 'order-card');
  const top = el('div', 'order-heading');
  top.append(el('h3', '', `Заказ №${order.id}`), el('span', `status-pill status-${order.status}`, statuses[order.status] || order.status));
  card.append(top, el('p', 'muted', date(order.createdAt)));
  for (const item of order.items || []) card.append(el('p', 'order-line', `${item.name} × ${item.quantity} · ${item.price == null ? 'цена уточняется' : money(item.price * item.quantity)}`));
  if (order.items?.length) {
    const total = order.items.reduce((sum, item) => sum + (item.price || 0) * item.quantity, 0);
    card.append(el('p', 'order-total', order.items.every(item => item.price == null) ? 'Стоимость уточнит продавец' : `${order.items.every(item => item.price != null) ? 'Сумма' : 'Известная часть суммы'}: ${money(total)}`));
  }
  if (order.note) card.append(el('p', 'order-note', order.note));
  if (order.contact) card.append(el('p', 'order-line', [order.contact.name, order.contact.phone, { agree: 'Получение согласовать', pickup: 'Самовывоз', delivery: 'Доставка' }[order.contact.delivery], order.contact.address].filter(Boolean).join(' · ')));
  if (order.history?.length) {
    const details = el('details', 'order-timeline'); details.append(el('summary', '', 'История статусов'));
    for (const event of order.history) details.append(el('p', 'muted', `${date(event.at)} · ${statuses[event.status] || event.status}`));
    card.append(details);
  }
  return card;
}
