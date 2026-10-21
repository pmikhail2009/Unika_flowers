export const SHOP_ORIGIN = 'https://unika-flowers-garden.brainy-chick-3547.chatgpt.site';
export const telegram = window.Telegram?.WebApp;
export const inTelegram = !!(telegram?.initData && location.hostname === 'app8754275738.tgcloud.ai');
const apiOrigin = location.hostname === 'app8754275738.tgcloud.ai' ? SHOP_ORIGIN : location.origin;
let memoryGuest = '', memoryStaff = '', bootstrap;
function guestToken() { try { return memoryGuest || JSON.parse(localStorage.getItem('unica-browser-token') || 'null') || ''; } catch { return memoryGuest; } }
function staffToken() { try { return memoryStaff || sessionStorage.getItem('unica-staff-session') || ''; } catch { return memoryStaff; } }
function remember(auth) {
  if (typeof auth?.guestToken === 'string' && /^[a-f0-9]{48}$/.test(auth.guestToken)) {
    memoryGuest = auth.guestToken; try { localStorage.setItem('unica-browser-token', JSON.stringify(memoryGuest)); } catch {}
  }
  if (auth?.staffToken !== undefined) { memoryStaff = auth.staffToken; try { if (memoryStaff) sessionStorage.setItem('unica-staff-session', memoryStaff); else sessionStorage.removeItem('unica-staff-session'); } catch {} }
}
function sdkCall(action, input) {
  return new Promise((resolve, reject) => {
    if (!telegram?.Serverless?.call) { reject(new Error('Telegram не подключил магазин. Закройте Mini App и откройте его заново.')); return; }
    let finished = false;
    const timer = setTimeout(() => { if (!finished) { finished = true; reject(new Error('Ответ задерживается. Проверьте «Мои заказы» или повторите ту же заявку.')); } }, 25000);
    try { telegram.Serverless.call('siteBridge', { action, input, guestToken: guestToken(), staffToken: staffToken() }, (error, result) => {
      if (finished) return; finished = true; clearTimeout(timer);
      if (error) reject(Object.assign(new Error(error.message || 'Не удалось выполнить действие.'), { code: error.parameters?.code })); else resolve(result);
    }); } catch (e) { clearTimeout(timer); finished = true; reject(e); }
  });
}
async function send(name, input) {
  let body;
  if (inTelegram) body = await sdkCall(name, input);
  else {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 25000);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (guestToken()) headers.Authorization = `Bearer ${guestToken()}`;
      if (staffToken()) headers['X-Unica-Session'] = staffToken();
      const response = await fetch(`${apiOrigin}/api/${name}`, { method: 'POST', credentials: apiOrigin === location.origin ? 'same-origin' : 'omit', headers, body: JSON.stringify(input), signal: controller.signal });
      try { body = await response.json(); } catch { throw new Error('Магазин временно недоступен. Повторите чуть позже.'); }
      if (!response.ok && !body.error) throw new Error('Не удалось выполнить действие.');
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Ответ задерживается. Проверьте «Мои заказы» или повторите ту же заявку.');
      if (e instanceof TypeError) throw new Error('Нет связи с магазином. Проверьте интернет и повторите.');
      throw e;
    } finally { clearTimeout(timer); }
  }
  if (!body || body.error) throw Object.assign(new Error(body?.error?.message || 'Не удалось выполнить действие.'), { code: body?.error?.code });
  remember(body.auth); return body.result;
}
export async function apiCall(name, input = {}) {
  try {
    if (!guestToken()) {
      const data = await (bootstrap ??= send('getCatalog', {}).finally(() => { bootstrap = undefined; }));
      if (name === 'getCatalog') return data;
    }
    return await send(name, input);
  } catch (error) {
    if (error.code === 'AUTH_REQUIRED' && !['login', 'changePassword'].includes(name)) document.dispatchEvent(new Event('shop-session-expired'));
    throw error;
  }
}
