import { $, el, button, tell, call, money, statuses, transitions, orderActionLabels, availability, image, showModal, orderCard, date, confirmAction } from './lib.js?v=4.2';
import { showMessages, renderStaffTeam } from './standalone.js?v=4.2';

let profile = {}, refreshCatalog, tab = 'dashboard', page = 0, orderStatus = '', orderSearch = '', productSearch = '', generation = 0;
let editing = null, newPhoto = null, photoTask = null, editorDirty = false;
const content = () => $('#admin-content');
const errorText = error => error?.message || 'Не удалось загрузить данные.';
function guarded(fn) { return async (...args) => { try { await fn(...args); } catch (error) { $('#admin-error').textContent = errorText(error); } }; }
async function mutate(input) { return call('mutateAdmin', input); }
async function allPages(action) {
  const rows = []; let offset = 0;
  for (;;) {
    const result = await call('getAdmin', { action, offset, ...(action === 'orders' ? { scope: tab === 'archive' ? 'archive' : 'active', status: orderStatus, search: orderSearch } : {}) });
    const batch = result[action] || []; rows.push(...batch);
    if (!result.hasMore || !batch.length) return rows;
    offset += batch.length;
  }
}
export function setupAdmin(currentProfile, onRefresh) {
  profile = currentProfile; refreshCatalog = onRefresh; $('#open-admin').hidden = !profile.isAdmin;
  $('[data-admin-tab="team"]').hidden = !profile.isOwner;
  $('#open-admin').onclick = () => { showModal($('#admin-dialog')); load(); };
}
export function openAdminOrders() {
  if (!profile.isAdmin) return;
  tab = 'orders'; page = 0; orderStatus = ''; orderSearch = '';
  showModal($('#admin-dialog')); load();
}
document.querySelectorAll('[data-admin-tab]').forEach(node => node.onclick = () => { tab = node.dataset.adminTab; page = 0; orderStatus = ''; load(); });
$('#admin-refresh').onclick = () => load();
async function load() {
  if (!profile.isAdmin) return;
  const run = ++generation; $('#admin-error').textContent = ''; content().textContent = 'Загружаем…';
  document.querySelectorAll('[data-admin-tab]').forEach(node => { const active = node.dataset.adminTab === tab; node.classList.toggle('active', active); if (active) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current'); });
  $('#admin-refresh').disabled = true;
  try {
    const result = await call('getAdmin', { action: tab === 'archive' ? 'orders' : tab, scope: tab === 'archive' ? 'archive' : 'active', offset: page * (tab === 'audit' ? 30 : 20), status: orderStatus, search: orderSearch });
    if (run !== generation) return;
    if (['orders', 'archive'].includes(tab) && page && !result.orders.length && result.total) { page = Math.ceil(result.total / 20) - 1; await load(); return; }
    content().replaceChildren();
    if (tab === 'dashboard') dashboard(result);
    if (tab === 'orders' || tab === 'archive') renderOrders(result);
    if (tab === 'products') await renderProducts(result, run);
    if (tab === 'settings') renderSettings(result.settings);
    if (tab === 'audit') renderAudit(result.events);
    if (tab === 'team') renderTeam(result.team);
  } catch (error) { if (run === generation) { content().replaceChildren(); $('#admin-error').textContent = errorText(error); } }
  finally { if (run === generation) $('#admin-refresh').disabled = false; }
}
function dashboard(data) {
  const stats = el('div', 'admin-stats');
  const active = ['new', 'confirmed', 'preparing', 'ready'].reduce((sum, status) => sum + data.counts[status], 0);
  for (const [label, count, target] of [['Новые заявки', data.counts.new, 'orders'], ['В работе', active, 'orders'], ['Сортов в каталоге', data.products, 'products'], ['Покупателей', data.customers, 'orders']]) {
    const node = button('', () => { tab = target; orderStatus = label === 'Новые заявки' ? 'new' : ''; page = 0; load(); }, 'stat-card'); node.append(el('strong', '', count), el('span', '', label)); stats.append(node);
  }
  content().append(stats, el('p', 'muted', `Непрочитанных заявок: ${data.unread}. Статусы обновляются после подтверждения администратора.`));
  const workflow = el('div', 'workflow');
  for (const status of ['new', 'confirmed', 'preparing', 'ready', 'done', 'cancelled']) workflow.append(button(`${statuses[status]} · ${data.counts[status]}`, () => { tab = ['done', 'cancelled'].includes(status) ? 'archive' : 'orders'; orderStatus = status; page = 0; load(); }, 'workflow-step'));
  const tips = el('div', 'admin-help'); tips.append(el('h3', '', 'Всё под рукой'), el('p', '', 'В «Товарах» меняйте фотографии, характеристики, цену и наличие. Скрытый сорт остаётся в базе, его можно вернуть.'), el('p', '', 'В «Заказах» подтверждайте заявки и меняйте статусы. Покупатель видит новый статус в «Моих заказах». Отменённые и завершённые заявки остаются в архиве.'), el('p', '', 'В «Настройках» можно приостановить приём заявок и обновить условия получения. «Журнал» хранит изменения команды.'));
  content().append(workflow, tips);
}
function pagination(hasMore, back = page > 0, size = 1) {
  const nav = el('div', 'pager');
  if (back) nav.append(button('← Назад', () => { page = Math.max(0, page - size); load(); }, 'text-link'));
  nav.append(el('span', 'muted', `Страница ${page + 1}`));
  if (hasMore) nav.append(button('Далее →', () => { page += size; load(); }, 'text-link'));
  content().append(nav);
}
function renderOrders(data) {
  const tools = el('form', 'admin-tools'), select = el('select'), query = el('input');
  const archive = tab === 'archive';
  select.setAttribute('aria-label', 'Статус заказов'); select.append(new Option(archive ? 'Все в архиве' : 'Все активные', ''));
  for (const [value, name] of Object.entries(statuses)) if (['done', 'cancelled'].includes(value) === archive) select.append(new Option(name, value)); select.value = orderStatus;
  query.type = 'search'; query.value = orderSearch; query.placeholder = '№ заказа, имя, телефон'; query.setAttribute('aria-label', 'Поиск заказов'); query.maxLength = 100;
  const submit = button('Найти', () => {}, 'button secondary'); submit.type = 'submit';
  tools.onsubmit = event => { event.preventDefault(); orderStatus = select.value; orderSearch = query.value; page = 0; load(); };
  select.onchange = () => { orderStatus = select.value; orderSearch = query.value; page = 0; load(); };
  const exportButton = button('Экспорт CSV ↓', async () => {
    exportButton.disabled = true;
    try { const rows = await allPages('orders'); downloadCsv('orders', [['Номер', 'Дата', 'Статус', 'Покупатель', 'Аккаунт', 'Телефон', 'Получение', 'Адрес', 'Позиции', 'Известная сумма', 'Все цены известны', 'Пожелания'], ...rows.map(order => [order.id, date(order.createdAt), statuses[order.status], order.contact?.name || order.customerName, '', order.contact?.phone || '', order.contact?.delivery || '', order.contact?.address || '', order.items.map(item => `${item.name} × ${item.quantity}`).join('; '), order.items.reduce((sum, item) => sum + (item.price || 0) * item.quantity, 0), order.items.length ? (order.items.every(item => item.price != null) ? 'Да' : 'Нет') : 'Нет', order.note])]); tell(`Выгружено заявок: ${rows.length}`); }
    catch (error) { tell(errorText(error)); } finally { exportButton.disabled = false; }
  }, 'text-link'); tools.append(select, query, submit, exportButton); content().append(tools, el('p', 'muted', `Найдено заявок: ${data.total}. Поиск по номеру, имени, телефону, адресу и пожеланиям.`));
  if (!data.orders.length) content().append(el('p', 'empty', 'Здесь пока нет заявок.'));
  for (const order of data.orders) {
    const card = orderCard(order), actions = el('div', 'order-actions');
    card.append(el('p', 'muted', `${order.customerName} · Заявка с сайта`));
    actions.append(button('Переписка с покупателем ↗', () => showMessages(order), 'text-link'));
    if (order.unread) actions.append(button('Прочитано', guarded(async () => { await mutate({ action: 'read', id: order.id }); await load(); }), 'text-link'));
    for (const status of transitions[order.status] || []) {
      const label = order.status === 'cancelled' && status === 'confirmed' ? 'Принять заново' : orderActionLabels[status];
      const action = button(label, async () => {
        if (!(await confirmAction(`Заказ №${order.id}: ${statuses[status]}? Статус обновится в истории покупателя.`))) return;
        action.disabled = true;
        try { await mutate({ action: 'order', id: order.id, version: order.version, status }); tell(`Заказ №${order.id}: ${statuses[status]}`); await refreshCatalog(); await load(); }
        catch (error) { tell(errorText(error)); action.disabled = false; }
      }, status === 'cancelled' ? 'button secondary danger' : 'button'); actions.append(action);
    }
    card.append(actions); content().append(card);
  }
  pagination(data.hasMore);
}
async function renderProducts(data, run) {
  // Product lists use a separate page size; retrieve the complete collection for local search.
  let rows = data.products;
  if (data.hasMore || page) rows = await allPages('products');
  if (run !== generation) return;
  const tools = el('div', 'admin-tools'), query = el('input'); query.type = 'search'; query.placeholder = 'Найти сорт'; query.value = productSearch; query.setAttribute('aria-label', 'Поиск товаров');
  const hidden = el('label', 'check-label'), hiddenCheck = el('input'); hiddenCheck.type = 'checkbox'; hidden.append(hiddenCheck, document.createTextNode('Только скрытые'));
  const list = el('div', 'admin-products');
  tools.append(query, hidden, button('Добавить сорт +', () => openEditor()), button('Экспорт CSV ↓', () => downloadCsv('products', [['ID', 'Название', 'Описание', 'Цена', 'Доступность', 'В каталоге'], ...rows.map(p => [p.id, p.name, p.description, p.price ?? '', availability[p.availability], p.active ? 'Да' : 'Нет'])]), 'text-link'));
  function draw() {
    productSearch = query.value;
    const visible = rows.filter(p => p.name.toLocaleLowerCase('ru').includes(productSearch.toLocaleLowerCase('ru')) && (!hiddenCheck.checked || !p.active));
    list.replaceChildren(...visible.map(p => {
      const row = el('article', 'admin-product'), copy = el('div'); copy.append(el('h3', '', p.name), el('p', 'muted', `${p.price == null ? 'Цена по запросу' : money(p.price)} · ${availability[p.availability]} · ${p.active ? 'В каталоге' : 'Скрыт'}`));
      row.append(image(p.photoData || p.image, p.name), copy, button('Изменить', () => openEditor(p), 'button secondary')); return row;
    }));
    if (!visible.length) list.append(el('p', 'empty', 'Подходящих сортов нет.'));
  }
  query.oninput = draw; hiddenCheck.onchange = draw; draw(); content().append(tools, el('p', 'muted', 'Наличие «Нет в наличии» оставляет карточку видимой, но отключает заказ. Снятие галочки «Показывать в каталоге» скрывает сорт.'), list);
}
function openEditor(product = null) {
  $('#product-form').dataset.requestId = crypto.randomUUID();
  editing = product; newPhoto = null; photoTask = null; editorDirty = false;
  $('#product-save').disabled = false;
  const form = $('#product-form'); form.reset(); $('#editor-error').textContent = '';
  $('#editor-title').textContent = product ? 'Изменить сорт.' : 'Новый сорт.';
  const values = product || { name: '', shortDescription: '', description: '', heightMin: 80, heightMax: 120, bloomMin: 0, bloomMax: 0, price: '', availability: 'available', active: true };
  for (const name of ['name', 'shortDescription', 'description', 'heightMin', 'heightMax', 'bloomMin', 'bloomMax', 'price', 'availability']) form.elements[name].value = values[name] ?? '';
  form.elements.active.checked = values.active;
  const preview = $('#product-preview'); preview.hidden = !product; if (product) preview.src = product.photoData || product.image || '/assets/logo.png';
  showModal($('#editor-dialog'));
}
$('#product-form').oninput = () => { editorDirty = true; };
$('#editor-dialog').addEventListener('cancel', async event => { if (!editorDirty) return; event.preventDefault(); if (await confirmAction('Закрыть без сохранения изменений?')) $('#editor-dialog').close(); });
$('#editor-dialog [data-close]').onclick = async () => { if (!editorDirty || await confirmAction('Закрыть без сохранения изменений?')) $('#editor-dialog').close(); };
async function resizePhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 15_000_000) throw new Error('Выберите JPG, PNG или WebP до 15 МБ.');
  const bitmap = await createImageBitmap(file);
  try {
    const factor = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * factor)); canvas.height = Math.max(1, Math.round(bitmap.height * factor));
    const context = canvas.getContext('2d'); context.fillStyle = '#f8f6ef'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let data = canvas.toDataURL('image/jpeg', .82); if (data.length > 1_000_000) data = canvas.toDataURL('image/jpeg', .55);
    if (data.length > 1_000_000) throw new Error('Фото слишком большое. Выберите изображение меньшего размера.');
    return data;
  } finally { bitmap.close(); }
}
$('#product-form').elements.photo.onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  $('#product-save').disabled = true; $('#editor-error').textContent = 'Подготавливаем фото…';
  const task = resizePhoto(file); photoTask = task;
  try { const data = await task; if (photoTask !== task) return; newPhoto = data; $('#product-preview').src = data; $('#product-preview').hidden = false; $('#editor-error').textContent = ''; }
  catch (error) { if (photoTask === task) { newPhoto = null; $('#editor-error').textContent = errorText(error); event.target.value = ''; } }
  finally { if (photoTask === task) { photoTask = null; $('#product-save').disabled = false; } }
};
$('#product-form').onsubmit = async event => {
  event.preventDefault(); if (photoTask) return;
  const form = event.target, submit = $('#product-save'); submit.disabled = true; $('#editor-error').textContent = '';
  const product = { ...(editing ? { id: editing.id, version: editing.version } : {}), active: form.elements.active.checked };
  for (const name of ['name', 'shortDescription', 'description', 'availability']) product[name] = form.elements[name].value.trim();
  for (const name of ['heightMin', 'heightMax', 'bloomMin', 'bloomMax']) product[name] = Number(form.elements[name].value);
  product.price = form.elements.price.value === '' ? null : Number(form.elements.price.value); if (newPhoto) product.photoData = newPhoto;
  try { await mutate({ action: 'product', product, requestId: form.dataset.requestId }); editorDirty = false; $('#editor-dialog').close(); tell('Сорт сохранён.'); await refreshCatalog(); await load(); }
  catch (error) { $('#editor-error').textContent = errorText(error); }
  finally { submit.disabled = false; }
};
function renderSettings(settings) {
  const form = el('form', 'settings-form'), openLabel = el('label', 'check-label'), open = el('input'); open.type = 'checkbox'; open.checked = settings.orderingOpen; openLabel.append(open, document.createTextNode('Принимать новые заявки'));
  form.append(openLabel); const fields = {};
  for (const [key, label, max] of [['announcement', 'Объявление над каталогом', 200], ['delivery', 'Получение и доставка', 1000], ['payment', 'Условия оплаты', 1000]]) {
    const field = el('textarea'); field.rows = key === 'announcement' ? 2 : 4; field.maxLength = max; field.value = settings[key]; field.required = key !== 'announcement'; fields[key] = field;
    const wrapper = el('label', '', label); wrapper.append(field); form.append(wrapper);
  }
  const submit = button('Сохранить настройки', () => {}); submit.type = 'submit'; form.append(el('p', 'muted', 'Условия отображаются в магазине. Приостановка приёма не меняет существующие заказы.'), submit);
  form.onsubmit = async event => {
    event.preventDefault(); if (settings.orderingOpen && !open.checked && !(await confirmAction('Приостановить приём новых заявок в магазине?'))) return;
    submit.disabled = true;
    try { await mutate({ action: 'settings', settings: { version: settings.version, orderingOpen: open.checked, ...Object.fromEntries(Object.entries(fields).map(([key, node]) => [key, node.value.trim()])) } }); tell('Настройки сохранены.'); await refreshCatalog(); await load(); }
    catch (error) { $('#admin-error').textContent = errorText(error); submit.disabled = false; }
  }; content().append(form);
}
const actionNames = { 'product:create': 'Добавлен сорт', 'product:update': 'Изменён сорт', 'product:price': 'Изменена цена', 'product:hide': 'Скрыт сорт', 'product:restore': 'Восстановлен сорт', 'settings:update': 'Обновлены настройки', 'team:grant': 'Выдан доступ', 'team:revoke': 'Отозван доступ' };
function renderAudit(events) {
  const list = el('div', 'audit-list');
  for (const event of events) {
    const row = el('article', 'audit-event'); row.append(el('strong', '', `${actionNames[event.action] || (event.action.startsWith('order:') ? `Заказ: ${statuses[event.action.slice(6)] || event.action}` : event.action)} · ${event.target}`), el('p', 'muted', `${date(event.createdAt)} · Аккаунт ${event.actorName || event.actorId}`)); list.append(row);
  }
  if (!events.length) list.append(el('p', 'empty', 'Изменения команды появятся здесь.'));
  content().append(list); pagination(events.length === 30);
}
function renderTeam(team) {
  renderStaffTeam(content(), team, load); return;
}
function downloadCsv(name, rows) {
  const safe = value => { let text = String(value ?? ''); if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`; return `"${text.replaceAll('"', '""')}"`; };
  const csv = '\uFEFF' + rows.map(row => row.map(safe).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), link = el('a'); link.href = url; link.download = `unica-${name}-${new Date().toISOString().slice(0, 10)}.csv`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
