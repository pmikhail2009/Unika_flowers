import { $, el, button, read, write, tell, call, telegram, authenticated, money, availability, image, showModal, wireDialogs, orderCard, confirmAction } from './lib.js?v=4.2';
import { setupAdmin, openAdminOrders } from './admin.js?v=4.2';
import { setupIcons } from './icons.js?v=4.2';
import { setupStandalone, applyProfile, showMessages, showReceipt, setupComparison, compareButton } from './standalone.js?v=4.2';
import { createCatalogEntrance } from './motion.js?v=4.3';

telegram?.ready(); telegram?.expand();
telegram?.setHeaderColor?.('#53384d'); telegram?.setBackgroundColor?.('#f8f6ef');
wireDialogs();
setupIcons();
setupStandalone(() => loadCatalog(), () => openOrders());
const grid = $('#grid');
const revealCatalog = createCatalogEntrance(grid);
let products = [], filter = 'all', settings = {}, submitting = false, loaded = false;
let adminProfile = false, counterLoading = false;
async function refreshAdminCounter() {
  if (!adminProfile || counterLoading) return;
  counterLoading = true;
  try { const counts = await call('getAdmin', { action: 'counts' }); $('#open-orders').textContent = `Заказы (${counts.total})`; } catch {} finally { counterLoading = false; }
}
setInterval(() => { if (!document.hidden) refreshAdminCounter(); }, 30000);
const savedSelection = read('unica-selection', []), savedQuantities = read('unica-quantities', []);
let selected = new Set(Array.isArray(savedSelection) ? savedSelection.filter(Number.isInteger) : []);
const quantities = new Map(Array.isArray(savedQuantities) ? savedQuantities.filter(entry => Array.isArray(entry) && entry.length === 2 && Number.isInteger(entry[0]) && Number.isInteger(entry[1]) && entry[1] >= 1 && entry[1] <= 100) : []);
const height = p => p.heightCm.map(n => (n / 100).toLocaleString('ru-RU')).join('–') + ' м';
const bloom = p => p.bloomCm?.[1] ? p.bloomCm.join('–') + ' см' : '';
const priceText = p => p.price == null ? 'Цена по запросу' : money(p.price);
const picked = () => products.filter(p => selected.has(p.id));
const canOrder = p => p.availability !== 'soldout';
function save() {
  write('unica-selection', [...selected]); write('unica-quantities', [...quantities]);
  const count = picked().reduce((sum, p) => sum + (quantities.get(p.id) || 1), 0);
  $('#selection-count').textContent = count;
  $('#mobile-cart-count').textContent = count;
  $('#mobile-cart').hidden = !count || !!document.querySelector('dialog[open]');
  telegram?.HapticFeedback?.selectionChanged?.();
}
function toggle(id) {
  if (submitting) return;
  if (selected.has(id)) { selected.delete(id); quantities.delete(id); tell('Сорт убран из корзины'); }
  else { const product = products.find(p => p.id === id); if (!product || !canOrder(product)) return; selected.add(id); quantities.set(id, 1); tell('Добавлено в «Мой выбор»'); }
  save(); render(); renderSelection();
  const detail = $('#detail-save'); if (detail) updateDetailSave(detail, Number(detail.dataset.id));
}
function card(p) {
  const article = el('article', 'card'), open = button('', () => showProduct(p), 'card-open');
  open.setAttribute('aria-label', `Подробнее: ${p.name}`);
  const wrap = el('div', 'card-image'), photo = image(p.image, `Гортензия ${p.name}`); photo.loading = 'lazy'; photo.width = 800; photo.height = 1000;
  wrap.append(photo, el('span', 'card-tag', availability[p.availability] || 'Наличие уточняется'));
  const meta = el('div', 'card-meta'); meta.append(el('span', '', 'ГОРТЕНЗИЯ'), el('span', '', height(p)));
  const bottom = el('div', 'card-bottom'); bottom.append(el('span', '', priceText(p)), el('span', '', 'Подробнее ↗'));
  open.append(wrap, meta, el('h3', '', p.name.replace(' = Candy Love', '').replace('=Framboisine', '')), el('p', 'card-russian', p.shortDescription), bottom);
  const heart = button(selected.has(p.id) ? '♥' : '♡', () => {
    toggle(p.id); [...grid.children].find(node => node.dataset.id === String(p.id))?.querySelector('.card-heart')?.focus({ preventScroll: true });
  }, 'card-heart');
  heart.setAttribute('aria-label', `${selected.has(p.id) ? 'Убрать' : 'Добавить'} ${p.name} ${selected.has(p.id) ? 'из выбора' : 'в мой выбор'}`);
  heart.setAttribute('aria-pressed', String(selected.has(p.id))); heart.disabled = !canOrder(p) && !selected.has(p.id);
  article.dataset.id = p.id; article.append(open, heart, compareButton(p)); return article;
}
function render() {
  const q = $('#search').value.trim().toLocaleLowerCase('ru-RU');
  const visible = products.filter(p => `${p.name} ${p.shortDescription}`.toLocaleLowerCase('ru-RU').includes(q)
    && (filter === 'all' || filter === 'compact' && p.heightCm[1] <= 130 || filter === 'medium' && p.heightCm[1] <= 150 || filter === 'tall' && p.heightCm[0] >= 180)
    && (!$('#available-only').checked || p.availability === 'available'));
  const sort = $('#sort').value;
  if (sort === 'height') visible.sort((a, b) => a.heightCm[1] - b.heightCm[1]);
  if (sort === 'bloom') visible.sort((a, b) => b.bloomCm[1] - a.bloomCm[1]);
  if (sort === 'name') visible.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  if (sort === 'price') visible.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  grid.replaceChildren(...visible.map(card));
  revealCatalog([...grid.children]);
  $('#catalog-status').textContent = `Показано ${visible.length} из ${products.length} сортов`;
  $('#empty').hidden = visible.length !== 0;
  $('.filters [data-filter="all"] span').textContent = products.length;
}
function setFilter(value) {
  filter = value;
  document.querySelectorAll('[data-filter]').forEach(node => { const active = node.dataset.filter === value; node.classList.toggle('active', active); node.setAttribute('aria-pressed', String(active)); }); render();
}
function updateDetailSave(node, id) {
  const product = products.find(p => p.id === id);
  node.textContent = selected.has(id) ? '♥ В моём выборе · убрать' : product && !canOrder(product) ? 'Нет в наличии' : '♡ Добавить в мой выбор';
  node.setAttribute('aria-pressed', String(selected.has(id))); node.disabled = !selected.has(id) && product && !canOrder(product);
}
function showProduct(p) {
  const detail = el('div', 'product-detail'), photo = image(p.image, `Гортензия ${p.name}`), copy = el('div', 'detail-copy'), title = el('h2', '', p.name);
  title.id = 'product-title'; copy.append(el('p', 'eyebrow', 'ИЗ КОЛЛЕКЦИИ UNICA & FLOWERS'), title, el('p', '', p.description || p.shortDescription));
  const specs = el('dl');
  for (const [label, value] of [['Высота куста', height(p)], ['Размер соцветия', bloom(p)], ['Стоимость', priceText(p)], ['Доступность', availability[p.availability] || 'Уточняется']]) {
    if (!value) continue; const row = el('div'); row.append(el('dt', '', label), el('dd', '', value)); specs.append(row);
  }
  const add = button('', () => toggle(p.id)); add.id = 'detail-save'; add.dataset.id = p.id; updateDetailSave(add, p.id);
  const contact = button('Задать вопрос при оформлении ↗', () => { if (!selected.has(p.id)) toggle(p.id); $('#product-dialog').close(); openSelection(); checkout.elements.note.focus(); }, 'text-link');
  copy.append(specs, el('p', '', 'Наличие и итоговую стоимость подтвердит продавец.'), add, contact); detail.append(photo, copy);
  $('#product-content').replaceChildren(detail); showModal($('#product-dialog'));
}
function orderMessage() {
  const items = picked().map((p, i) => `${i + 1}. ${p.name} × ${quantities.get(p.id) || 1} · ${priceText(p)}`).join('\n');
  const form = $('#checkout');
  return `Здравствуйте! Хочу заказать гортензии:\n\n${items}\n\n${[form.elements.name.value, form.elements.phone.value, form.elements.address.value, form.elements.note.value].filter(Boolean).join('\n')}\nНаличие, стоимость и получение прошу подтвердить.`;
}
function renderTotals() {
  const items = picked(), total = items.reduce((sum, p) => sum + (p.price || 0) * (quantities.get(p.id) || 1), 0);
  $('#cart-total').textContent = items.every(p => p.price == null) ? 'Стоимость уточнит продавец' : `${items.every(p => p.price != null) ? 'Сумма' : 'Известная часть суммы'}: ${money(total)}`;
  $('#cart-unknown').hidden = items.every(p => p.price != null);
}
function renderSelection() {
  const list = $('#selection-list'), items = picked(); list.replaceChildren();
  $('#request-area').hidden = !items.length; $('#cart-success').hidden = true;
  if (!items.length) {
    const empty = el('div', 'empty'); empty.append(el('h3', '', 'Здесь расцветёт ваш выбор'), el('p', '', 'Нажмите ♡ у понравившегося сорта в каталоге.'), button('Перейти к коллекции ↗', () => { $('#selection-dialog').close(); $('#catalog').scrollIntoView(); })); list.append(empty); return;
  }
  for (const p of items) {
    const row = el('div', 'selected-item'), info = el('div'); info.append(el('h3', '', p.name), el('p', '', `${height(p)} · ${priceText(p)}${!canOrder(p) ? ' · недоступен, уберите из заказа' : p.availability === 'preorder' ? ' · предзаказ' : ''}`));
    const quantity = el('input', 'quantity'); quantity.type = 'number'; quantity.min = '1'; quantity.max = '100'; quantity.step = '1'; quantity.value = quantities.get(p.id) || 1; quantity.setAttribute('aria-label', `Количество ${p.name}`);
    const updateQuantity = () => { const count = Math.max(1, Math.min(100, Math.floor(Number(quantity.value) || 1))); quantity.value = count; quantities.set(p.id, count); save(); renderTotals(); };
    quantity.onchange = updateQuantity; quantity.onblur = updateQuantity;
    const remove = button('×', () => { toggle(p.id); $('#selection-dialog [data-close]').focus(); }, 'remove'); remove.setAttribute('aria-label', `Убрать ${p.name}`);
    row.append(image(p.image, p.name), info, quantity, remove); list.append(row);
  }
  renderTotals();
  $('#telegram-request').textContent = authenticated ? 'Отправить заявку ↗' : 'Открыть магазин в Telegram ↗';
  $('#telegram-request').disabled = authenticated && (settings.orderingOpen === false || items.some(p => !canOrder(p)));
  $('#order-status').textContent = settings.orderingOpen === false ? 'Приём заявок временно приостановлен. Напишите продавцу.' : items.some(p => !canOrder(p)) ? 'Уберите недоступные сорта перед отправкой.' : '';
}
function openSelection() { renderSelection(); showModal($('#selection-dialog')); }
$('#open-selection').onclick = openSelection; $('#catalog-selection').onclick = openSelection; $('#mobile-cart').onclick = openSelection;
for (const node of document.querySelectorAll('[data-filter]')) node.onclick = () => setFilter(node.dataset.filter);
for (const node of document.querySelectorAll('[data-preset]')) node.onclick = () => { $('#search').value = ''; setFilter(node.dataset.preset); $('#catalog').scrollIntoView(); };
$('#search').oninput = render; $('#sort').onchange = render; $('#available-only').onchange = render;
$('#reset').onclick = () => { $('#search').value = ''; $('#sort').value = 'default'; $('#available-only').checked = false; setFilter('all'); $('#search').focus(); };
$('#copy-request').onclick = async () => {
  try { await navigator.clipboard.writeText(orderMessage()); tell('Текст заявки скопирован.'); }
  catch { $('#copy-fallback').hidden = false; $('#copy-fallback').value = orderMessage(); $('#copy-fallback').select(); tell('Выделенный текст можно скопировать вручную.'); }
};
const checkout = $('#checkout'), remembered = read('unica-contact', {});
checkout.elements.name.required = authenticated;
for (const name of ['name', 'phone', 'delivery', 'address']) if (typeof remembered?.[name] === 'string') checkout.elements[name].value = remembered[name];
if (!checkout.elements.name.value) checkout.elements.name.value = telegram?.initDataUnsafe?.user?.first_name || '';
checkout.elements.remember.checked = !!remembered?.name;
const savedNote = read('unica-note', '');
checkout.elements.note.value = typeof savedNote === 'string' ? savedNote.slice(0, 1000) : '';
checkout.elements.note.oninput = () => write('unica-note', checkout.elements.note.value);
checkout.elements.delivery.onchange = () => { checkout.elements.address.required = authenticated && checkout.elements.delivery.value === 'delivery'; $('#address-label').hidden = checkout.elements.delivery.value !== 'delivery'; };
checkout.elements.delivery.onchange();
checkout.onsubmit = async event => {
  event.preventDefault();
  if (submitting || !loaded || !picked().length) return;
  if (!authenticated) { window.open('https://t.me/Unika_Flowers_bot?startapp', '_blank', 'noopener'); return; }
  if (!checkout.reportValidity()) return;
  const payload = { items: picked().map(p => ({ id: p.id, quantity: quantities.get(p.id) || 1, price: p.price ?? null })), note: checkout.elements.note.value.trim(), contact: Object.fromEntries(['name', 'phone', 'delivery', 'address'].map(name => [name, checkout.elements[name].value.trim()])) };
  const fingerprint = JSON.stringify(payload), pending = read('unica-pending-order', {});
  const requestId = pending?.fingerprint === fingerprint ? pending.requestId : crypto.randomUUID();
  write('unica-pending-order', { fingerprint, requestId });
  submitting = true; $('#telegram-request').disabled = true; $('#order-status').textContent = 'Сохраняем заявку…';
  checkout.querySelectorAll('input, select, textarea').forEach(node => node.disabled = true);
  try {
    const result = await call('placeOrder', { ...payload, requestId });
    await refreshAdminCounter();
    write('unica-pending-order', {});
    write('unica-contact', checkout.elements.remember.checked ? payload.contact : {});
    selected.clear(); quantities.clear(); save(); render();
    checkout.elements.note.value = ''; write('unica-note', '');
    $('#selection-list').replaceChildren(); $('#request-area').hidden = true;
    $('#cart-success').hidden = false; $('#success-title').textContent = `Заявка №${result.orderId} принята`;
    $('#success-summary').textContent = result.summary;
    showReceipt(result);
    tell('Заявка сохранена. Продавец подтвердит детали.');
  } catch (error) {
    $('#order-status').textContent = error.message;
    if (['PRICE_CHANGED', 'PRODUCT_UNAVAILABLE', 'SHOP_CLOSED'].includes(error.code)) { $('#refresh-cart').hidden = false; }
  } finally { submitting = false; checkout.querySelectorAll('input, select, textarea').forEach(node => node.disabled = false); $('#telegram-request').disabled = settings.orderingOpen === false || picked().some(p => !canOrder(p)); }
};
$('#refresh-cart').onclick = async () => { await loadCatalog(); renderSelection(); $('#refresh-cart').hidden = true; };
$('#continue-shopping').onclick = () => $('#selection-dialog').close();
$('#success-orders').onclick = () => { $('#selection-dialog').close(); openOrders(); };
let orderOffset = 0;
async function openOrders(offset = 0) {
  if (!authenticated) { tell('История доступна в магазине через Telegram.'); return; }
  showModal($('#orders-dialog')); $('#orders-list').textContent = 'Загружаем заказы…'; $('#orders-error').textContent = ''; $('#orders-more').hidden = true;
  try {
    const result = await call('getMyOrders', { offset }); orderOffset = offset;
    const cards = result.orders.map(order => {
      const card = orderCard(order);
      card.append(button('Переписка с магазином ↗', () => showMessages(order), 'text-link'));
      card.append(button('Личная ссылка на заказ', async () => {
        const receipt = read('unica-receipts', []).find?.(r => r.orderId === order.id);
        let code = receipt?.code;
        if (!code) {
          if (!await confirmAction('Создать новый личный код? Предыдущая ссылка перестанет открывать заказ на новых устройствах.')) return;
          try { code = (await call('renewOrderAccess', { id: order.id })).recoveryCode; } catch (e) { tell(e.message); return; }
        }
        showReceipt({ orderId: order.id, summary: order.items.map(p => `${p.name} × ${p.quantity}`).join('\n'), recoveryCode: code });
        $('#orders-dialog').close(); $('#selection-list').replaceChildren(); $('#request-area').hidden = true; $('#cart-success').hidden = false;
        $('#success-title').textContent = `Заказ №${order.id}`; $('#success-summary').textContent = ''; showModal($('#selection-dialog'));
      }, 'text-link'));
      if (order.status === 'new') {
        const cancel = button('Отменить заявку', async () => {
          if (!(await confirmAction(`Отменить заявку №${order.id}?`))) return;
          cancel.disabled = true;
          try { await call('cancelOrder', { id: order.id, version: order.version }); tell('Заявка отменена.'); await openOrders(orderOffset); }
          catch (error) { tell(error.message); cancel.disabled = false; }
        }, 'text-link danger'); card.append(cancel);
      }
      const repeat = button('Повторить выбор', () => {
        let skipped = 0;
        for (const item of order.items || []) { const product = products.find(p => p.id === item.id && canOrder(p)); if (product) { selected.add(product.id); quantities.set(product.id, item.quantity); } else skipped++; }
        if (!order.items?.length) { tell('Это текстовая заявка. Напишите продавцу, чтобы повторить её.'); return; }
        save(); render(); $('#orders-dialog').close(); openSelection(); if (skipped) tell('Недоступные сорта пропущены. Проверьте актуальные цены.');
      }, 'text-link'); card.append(repeat); return card;
    });
    $('#orders-list').replaceChildren(...cards); if (!cards.length) $('#orders-list').append(el('p', 'empty', 'Пока нет заявок. Ваша первая гортензия ждёт в каталоге.'));
    $('#orders-more').hidden = !result.hasMore; $('#orders-prev').hidden = !offset;
  } catch (error) { $('#orders-list').replaceChildren(); $('#orders-error').textContent = error.message; }
}
$('#open-orders').onclick = () => openOrders(); $('#orders-refresh').onclick = () => openOrders(orderOffset);
$('#orders-more').onclick = () => openOrders(orderOffset + 10); $('#orders-prev').onclick = () => openOrders(Math.max(0, orderOffset - 10));
export async function loadCatalog() {
  $('#refresh-catalog').disabled = true;
  try {
    let data;
    if (authenticated) data = await call('getCatalog');
    else { const response = await fetch('/data/products.json', { cache: 'no-store' }); if (!response.ok) throw new Error('Каталог временно недоступен.'); data = await response.json(); }
    if (!Array.isArray(data.products)) throw new Error('Не удалось прочитать каталог.');
    products = data.products.map(p => ({ ...p, price: p.price ?? null, availability: p.availability || (authenticated ? 'available' : 'unknown') })); settings = data.settings || {};
    const removed = [...selected].filter(id => !products.some(p => p.id === id));
    selected = new Set([...selected].filter(id => products.some(p => p.id === id))); if (removed.length) tell('Скрытые сорта убраны из корзины.');
    loaded = true; save(); render(); $('#catalog-error').hidden = true;
    $('.facts b').textContent = products.length; $('.photo-top span').textContent = `01 — ${String(products.length).padStart(2, '0')}`;
    const first = products[0], featured = products[2] || first;
    if (first) { $('.hero-photo > img').src = first.image; $('.hero-photo > img').alt = first.name; $('.photo-caption strong').textContent = first.name; }
    if (featured) { $('.choice-image img').src = featured.image; $('.choice-image img').alt = featured.name; $('.choice-image > span').textContent = `${featured.name} / из нашей коллекции`; }
    $('#shop-notice').textContent = settings.orderingOpen === false ? 'Приём заявок временно приостановлен. Напишите нам в Telegram.' : settings.announcement || '';
    $('#shop-notice').hidden = !$('#shop-notice').textContent;
    if (settings.delivery) $('#delivery-info').textContent = settings.delivery;
    if (settings.payment) $('#payment-info').textContent = settings.payment;
    $('#preview-notice').hidden = authenticated;
    $('#open-orders').hidden = !authenticated;
    setupAdmin(data.profile || {}, loadCatalog);
    applyProfile(data.profile || {});
    setupComparison(products);
    adminProfile = !!data.profile?.isAdmin;
    $('#open-orders').textContent = data.profile?.isAdmin ? `Заказы (${data.profile.orderCount || 0})` : 'Мои заказы';
    $('#open-orders').onclick = data.profile?.isAdmin ? openAdminOrders : () => openOrders();
    if (new URLSearchParams(location.search).has('admin') && data.profile?.isAdmin && !window.adminOpened) { window.adminOpened = true; $('#open-admin').click(); }
  } catch (error) { $('#catalog-status').textContent = loaded ? 'Не удалось обновить. Показан ранее загруженный каталог.' : 'Каталог не загрузился.'; $('#catalog-error').textContent = `${error.message} Нажмите «Обновить» или напишите @unika_flowers.`; $('#catalog-error').hidden = false; }
  finally { $('#refresh-catalog').disabled = false; }
}
$('#refresh-catalog').onclick = loadCatalog;
document.querySelectorAll('dialog').forEach(dialog => { dialog.addEventListener('close', save); dialog.addEventListener('toggle', save); });
$('#year').textContent = new Date().getFullYear();
await loadCatalog();
