import { $, el, button, call, tell, read, write, showModal, date, money, availability, confirmAction } from './lib.js?v=4.2';
import { SHOP_ORIGIN, inTelegram } from './transport.js?v=4.2';

let refresh, openOrders, profile = {}, currentOrder, messagePage = 0, messageGeneration = 0;
let compared = new Set(read('unica-compare', []).filter?.(Number.isInteger) || []), products = [];
function dialog(id, title) {
  const node = el('dialog'); node.id = id; node.setAttribute('aria-labelledby', `${id}-title`);
  const close = button('×', () => node.close(), 'close'); close.setAttribute('aria-label', 'Закрыть');
  const box = el('div', 'selection-content'), heading = el('h2', '', title); heading.id = `${id}-title`; box.append(heading); node.append(close, box); document.body.append(node);
  node.addEventListener('click', event => { if (event.target !== node) return; const r = node.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) node.close(); });
  node.addEventListener('close', () => { if (node.returnFocus?.isConnected) node.returnFocus.focus({ preventScroll: true }); });
  return { node, box };
}
function inputField(form, name, title, type = 'text', required = true) {
  const label = el('label', '', title), input = el('input'); input.name = name; input.type = type; input.required = required;
  input.maxLength = type === 'password' ? 128 : 100; if (type === 'password') { input.minLength = 12; input.autocomplete = 'new-password'; }
  label.append(input); form.append(label); return input;
}
function errorLine(form) { const line = el('p', 'error-message'); line.setAttribute('role', 'alert'); form.append(line); return line; }
function submitButton(form, text) { const node = button(text, () => {}); node.type = 'submit'; form.append(node); return node; }
let authDialog, messageDialog, compareDialog;
export function setupStandalone(onRefresh, onOrders) {
  refresh = onRefresh; openOrders = onOrders;
  document.addEventListener('shop-session-expired', async () => { $('#admin-dialog').close(); $('#editor-dialog').close(); await refresh(); tell('Сеанс завершён. Войдите в управление заново.'); });
  authDialog = dialog('login-dialog', 'Вход для команды.');
  $('#open-login').onclick = () => showLogin();
  $('#staff-logout').onclick = async () => {
    try { await call('logout'); $('#admin-dialog').close(); await refresh(); tell('Вы вышли из управления.'); } catch (e) { tell(e.message); }
  };
  $('#staff-password').onclick = showPasswordChange;
  const browserAccount = button('Настроить вход из браузера', () => showLogin(true), 'text-link'); browserAccount.id = 'setup-browser-account';
  $('#staff-logout').after(browserAccount);
  if (inTelegram) {
    const legacy = el('a', 'text-link', 'Прежние заказы и каталог ↗');
    legacy.href = `/legacy/index.html${location.search}${location.hash}`; legacy.id = 'legacy-shop';
    $('#staff-logout').after(legacy);
    const oldOrders = el('a', 'text-link', 'Мои прежние заказы в Telegram ↗'); oldOrders.href = legacy.href;
    $('#orders-dialog .selection-content').append(oldOrders);
  }
  $('#recover-form').onsubmit = async event => {
    event.preventDefault(); const form = event.target, submit = form.querySelector('button'); submit.disabled = true; $('#recover-error').textContent = '';
    try { await call('recoverOrder', { code: form.elements.code.value.trim() }); form.reset(); await openOrders(); tell('Заказ добавлен в вашу историю.'); }
    catch (error) { $('#recover-error').textContent = error.message; } finally { submit.disabled = false; }
  };
  $('#orders-help').onclick = event => { event.preventDefault(); tell('Откройте «Переписка с магазином» под нужным заказом.'); };
  messageDialog = dialog('messages-dialog', 'Переписка по заказу.');
  messageDialog.box.append(el('p', 'muted', 'Ваши сообщения поступают магазину в Telegram-бота. Ответ продавца появится здесь; переписка обновляется автоматически.'));
  const tools = el('div', 'order-actions');
  tools.append(button('Обновить ↻', () => loadMessages(), 'text-link'), button('Ранние сообщения', () => loadMessages(messagePage + 30), 'text-link'), button('Последние сообщения', () => loadMessages(0), 'text-link'));
  tools.children[1].id = 'messages-older'; tools.children[2].id = 'messages-latest';
  const list = el('div', 'messages-list'); list.id = 'messages-list'; list.setAttribute('aria-live', 'polite');
  const form = el('form', 'message-form'), label = el('label', '', 'Ваше сообщение'), text = el('textarea'); text.name = 'text'; text.rows = 3; text.maxLength = 2000; text.required = true; label.append(text); form.append(label);
  const error = errorLine(form), submit = submitButton(form, 'Отправить сообщение');
  form.onsubmit = async event => {
    event.preventDefault(); const message = text.value.trim(); if (!message) { error.textContent = 'Введите сообщение.'; return; }
    submit.disabled = true; error.textContent = ''; const order = currentOrder;
    if (form.dataset.text !== message) { form.dataset.requestId = crypto.randomUUID(); form.dataset.text = message; }
    try { await call('sendMessage', { id: order.id, text: message, requestId: form.dataset.requestId }); if (currentOrder.id === order.id) { form.reset(); delete form.dataset.text; await loadMessages(0); } }
    catch (e) { error.textContent = e.message; } finally { submit.disabled = false; }
  };
  messageDialog.box.append(tools, list, form);
  messageDialog.node.addEventListener('close', () => { ++messageGeneration; });
  setInterval(() => { if (!document.hidden && messageDialog.node.open && !form.querySelector('button').disabled) loadMessages(messagePage, true); }, 15000);
  compareDialog = dialog('compare-dialog', 'Всё познаётся в сравнении.');
  $('#compare-toggle').onclick = () => { drawComparison(); showModal(compareDialog.node); };
  window.addEventListener('online', () => tell('Связь восстановлена. Можно обновить каталог и заказы.'));
  window.addEventListener('offline', () => tell('Нет интернета. Ваш выбор сохранён на этом устройстве.'));
}
export function applyProfile(value) {
  profile = value; $('#open-login').hidden = profile.isAdmin;
  $('#staff-password').hidden = profile.authMethod === 'telegram';
  $('#staff-logout').hidden = profile.authMethod === 'telegram';
  $('#setup-browser-account').hidden = !(profile.canSetup && profile.needsSetup);
  if (profile.needsSetup) $('#open-login').textContent = 'Настроить магазин'; else $('#open-login').textContent = 'Вход для команды';
  const code = new URLSearchParams(location.hash.slice(1)).get('order');
  if (code) {
    const remainingHash = new URLSearchParams(location.hash.slice(1)); remainingHash.delete('order');
    history.replaceState(null, '', location.pathname + location.search + (remainingHash.size ? '#' + remainingHash.toString() : ''));
    call('recoverOrder', { code }).then(() => openOrders()).catch(error => tell(error.message));
  }
}
function showLogin(setup = false) {
  const { box, node } = authDialog; box.replaceChildren(); const title = el('h2', '', setup ? 'Настроим ваш магазин.' : 'Вход для команды.'); title.id = 'login-dialog-title'; box.append(title);
  if (profile.needsSetup && !profile.canSetup) {
    box.append(el('p', '', 'Первую учётную запись создаёт владелец сайта. Войдите в аккаунт владельца и вернитесь к настройке.'));
    const signIn = el('a', 'button', 'Войти как владелец'); signIn.href = `${SHOP_ORIGIN}/signin-with-chatgpt?return_to=%2Findex.html%3Fsetup`; signIn.target = '_top'; box.append(signIn); showModal(node); return;
  }
  setup ||= !!profile.needsSetup;
  const form = el('form', 'settings-form'); if (setup) inputField(form, 'name', 'Ваше имя');
  const username = inputField(form, 'username', 'Логин'); username.autocomplete = 'username'; username.pattern = '[A-Za-z0-9_.-]{3,60}'; username.maxLength = 60;
  const password = inputField(form, 'password', 'Пароль · минимум 12 символов', 'password'); password.autocomplete = setup ? 'new-password' : 'current-password';
  const error = errorLine(form), submit = submitButton(form, setup ? 'Создать аккаунт владельца' : 'Войти');
  form.onsubmit = async event => {
    event.preventDefault(); submit.disabled = true; error.textContent = '';
    try { const payload = { username: username.value.trim(), password: password.value, ...(setup ? { name: form.elements.name.value.trim() } : {}) };
      if (setup) await call('setupOwner', payload);
      await call('login', payload); password.value = ''; node.close(); await refresh(); $('#open-admin').click();
    } catch (e) { error.textContent = e.message; } finally { submit.disabled = false; }
  };
  box.append(form, el('p', 'muted', 'Для покупок вход не нужен. Доступ к управлению выдаёт владелец магазина.')); showModal(node);
}
function showPasswordChange() {
  const { box, node } = authDialog; box.replaceChildren(); const title = el('h2', '', 'Новый пароль.'); title.id = 'login-dialog-title'; box.append(title);
  const form = el('form', 'settings-form'); inputField(form, 'currentPassword', 'Текущий пароль', 'password').autocomplete = 'current-password'; inputField(form, 'password', 'Новый пароль · минимум 12 символов', 'password');
  const error = errorLine(form), submit = submitButton(form, 'Сохранить и выйти');
  form.onsubmit = async event => { event.preventDefault(); submit.disabled = true; try { await call('changePassword', { currentPassword: form.elements.currentPassword.value, password: form.elements.password.value }); form.reset(); node.close(); $('#admin-dialog').close(); await refresh(); tell('Пароль изменён. Войдите заново.'); } catch (e) { error.textContent = e.message; } finally { submit.disabled = false; } };
  box.append(form); showModal(node);
}
export async function showMessages(order) {
  currentOrder = order; messagePage = 0; messageDialog.box.querySelector('h2').textContent = `Переписка · заказ №${order.id}`;
  const form = messageDialog.box.querySelector('form'); form.reset(); form.querySelector('.error-message').textContent = ''; delete form.dataset.text;
  showModal(messageDialog.node); await loadMessages();
}
async function loadMessages(offset = messagePage, quiet = false) {
  if (!currentOrder) return; const generation = ++messageGeneration, id = currentOrder.id;
  if (!quiet) $('#messages-list').textContent = 'Загружаем сообщения…';
  try { const data = await call('getMessages', { id, offset }); if (generation !== messageGeneration) return; messagePage = offset;
    $('#messages-list').replaceChildren(...data.messages.map(m => { const card = el('article', `message message-${m.sender}`); card.append(el('strong', '', m.sender === 'shop' ? 'UNICA & FLOWERS' : 'Покупатель'), el('p', '', m.text), el('small', 'muted', date(m.createdAt))); return card; }));
    if (!data.messages.length) $('#messages-list').append(el('p', 'muted', 'Здесь можно уточнить наличие, получение и другие детали заявки.'));
    $('#messages-older').hidden = !data.hasMore; $('#messages-latest').hidden = !offset;
  } catch (e) { if (!quiet && generation === messageGeneration) $('#messages-list').textContent = e.message; }
}
export function showReceipt(result) {
  const area = $('#receipt-area'); area.replaceChildren();
  if (!result.recoveryCode) { area.append(el('p', 'muted', 'Заявка сохранена в «Моих заказах» на этом устройстве.')); return; }
  const code = result.recoveryCode, link = `${location.origin}/index.html#order=${encodeURIComponent(code)}`;
  const saved = read('unica-receipts', []); write('unica-receipts', [...(Array.isArray(saved) ? saved : []).filter(x => x.orderId !== result.orderId), { orderId: result.orderId, code }].slice(-30));
  area.append(el('h3', '', 'Ваш личный код заказа'), el('p', 'muted', 'Сохраните его для входа с другого устройства. Не передавайте код посторонним — он открывает заказ и переписку.'));
  const field = el('input'); field.value = code; field.readOnly = true; field.setAttribute('aria-label', 'Личный код заказа'); field.onclick = () => field.select(); area.append(field);
  area.append(button('Скопировать ссылку на заказ', async () => { try { await navigator.clipboard.writeText(link); tell('Личная ссылка скопирована.'); } catch { field.value = link; field.select(); tell('Скопируйте выделенную ссылку.'); } }, 'text-link'), button('Сохранить памятку ↓', () => download(`unica-order-${result.orderId}.txt`, `UNICA & FLOWERS\nЗаявка №${result.orderId}\n${result.summary}\n\nЛичный код: ${code}\nСсылка: ${link}\n\nНаличие, итоговую стоимость и получение подтвердит продавец.\nСохраните код и никому его не передавайте.\n`), 'text-link'));
}
function download(name, text) { const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })), a = el('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export function renderStaffTeam(container, team, reload) {
  container.append(el('p', 'muted', 'Администраторы работают с товарами, заказами и настройками. Владелец управляет доступом. После отзыва доступа все сеансы сотрудника завершаются.'));
  for (const member of team) {
    const row = el('div', 'team-member'); row.append(el('strong', '', `${member.name} · ${member.username}`), el('span', 'muted', member.owner ? 'Владелец' : member.active ? 'Администратор' : 'Доступ закрыт'));
    if (!member.owner) {
      row.append(button(member.active ? 'Закрыть доступ' : 'Вернуть доступ', async () => { if (!await confirmAction(`Изменить доступ для ${member.name}?`)) return; try { await call('mutateAdmin', { action: 'team', id: member.id, grant: !member.active }); await reload(); } catch (e) { tell(e.message); } }, 'text-link'));
      row.append(button('Сменить пароль', () => {
        const { node, box } = authDialog; box.replaceChildren(); const h = el('h2', '', `Пароль · ${member.name}`); h.id = 'login-dialog-title'; box.append(h);
        const f = el('form', 'settings-form'); inputField(f, 'password', 'Новый пароль · минимум 12 символов', 'password'); const error = errorLine(f), submit = submitButton(f, 'Сменить пароль');
        f.onsubmit = async e => { e.preventDefault(); submit.disabled = true; try { await call('mutateAdmin', { action: 'team', operation: 'password', id: member.id, password: f.elements.password.value }); f.reset(); node.close(); tell('Пароль изменён. Старые сеансы завершены.'); } catch (e) { error.textContent = e.message; } finally { submit.disabled = false; } }; box.append(f); showModal(node);
      }, 'text-link'));
    }
    container.append(row);
  }
  const form = el('form', 'settings-form'); form.append(el('h3', '', 'Добавить сотрудника'));
  inputField(form, 'name', 'Имя'); const username = inputField(form, 'username', 'Логин · латинские буквы и цифры'); username.autocomplete = 'off'; username.pattern = '[A-Za-z0-9_.-]{3,60}';
  inputField(form, 'password', 'Пароль · минимум 12 символов', 'password'); const error = errorLine(form), submit = submitButton(form, 'Добавить администратора');
  form.onsubmit = async event => { event.preventDefault(); submit.disabled = true; try { await call('mutateAdmin', { action: 'team', operation: 'create', name: form.elements.name.value, username: form.elements.username.value, password: form.elements.password.value }); form.reset(); await reload(); tell('Сотрудник добавлен.'); } catch (e) { error.textContent = e.message; submit.disabled = false; } };
  container.append(form);
}
export function setupComparison(list) { products = list; compared = new Set([...compared].filter(id => list.some(p => p.id === id)).slice(0, 3)); syncCompare(); }
export function compareButton(p) {
  const b = button(compared.has(p.id) ? '✓ В сравнении' : '+ Сравнить', () => {
    if (compared.has(p.id)) compared.delete(p.id); else if (compared.size < 3) compared.add(p.id); else { tell('Можно сравнить до трёх сортов. Уберите один из выбранных.'); return; }
    write('unica-compare', [...compared]); syncCompare();
  }, 'compare-add'); b.dataset.compare = p.id; b.setAttribute('aria-pressed', String(compared.has(p.id))); return b;
}
function syncCompare() {
  $('#compare-toggle').hidden = !compared.size; $('#compare-count').textContent = compared.size;
  document.querySelectorAll('[data-compare]').forEach(b => { const active = compared.has(Number(b.dataset.compare)); b.textContent = active ? '✓ В сравнении' : '+ Сравнить'; b.setAttribute('aria-pressed', String(active)); });
}
function drawComparison() {
  const box = compareDialog.box; while (box.children.length > 1) box.lastChild.remove();
  const list = products.filter(p => compared.has(p.id));
  if (!list.length) { box.append(el('p', '', 'Добавьте сорта в сравнение из каталога.')); return; }
  const wrapper = el('div', 'comparison-scroll'), table = el('table', 'comparison-table'), head = el('tr'); head.append(el('th', '', 'Характеристики'));
  for (const p of list) { const cell = el('th'); const img = el('img'); img.src = p.image; img.alt = p.name; cell.append(img, el('span', '', p.name), button('Убрать', () => { compared.delete(p.id); write('unica-compare', [...compared]); syncCompare(); drawComparison(); }, 'text-link')); head.append(cell); }
  const thead = el('thead'); thead.append(head); table.append(thead); const tbody = el('tbody');
  for (const [label, value] of [['Высота', p => `${p.heightCm.map(n => (n / 100).toLocaleString('ru')).join('–')} м`], ['Соцветия', p => p.bloomCm[1] ? `${p.bloomCm.join('–')} см` : 'Уточняется'], ['Стоимость', p => p.price == null ? 'По запросу' : money(p.price)], ['Наличие', p => availability[p.availability]], ['Описание', p => p.shortDescription]]) {
    const row = el('tr'); const th = el('th', '', label); th.scope = 'row'; row.append(th); for (const p of list) row.append(el('td', '', value(p))); tbody.append(row);
  }
  table.append(tbody); wrapper.append(table); box.append(wrapper);
}
