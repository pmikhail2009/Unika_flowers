// Isolated dual-mode UI fixture. No production routes, real identities or messages.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { openDatabase } from '../server/sqlite.mjs';
import { seed, handleApi, handleTelegramBridge } from '../server/shop.mjs';
const db = await openDatabase(); await seed(db);
const secret = 'local-test-only-bridge-secret-'.repeat(3), root = resolve('public');
const shim = `window.Telegram={WebApp:{initData:'isolated-qa',initDataUnsafe:{user:{first_name:'Проверка Telegram'}},ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},Serverless:{call(name,input,callback){fetch('/__qa/bridge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}).then(r=>r.json()).then(body=>body.error?callback({message:body.error.message,parameters:{code:body.error.code}}):callback(null,body)).catch(e=>callback({message:e.message}));}}}};`;
const mime = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/') || url.pathname === '/__qa/bridge') {
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 1200000) throw new Error('Too large'); }
      let reply;
      if (url.pathname === '/__qa/bridge') {
        const payload = { ...JSON.parse(body), telegram: { id: 5211227935, name: 'Тестовый владелец Telegram', isAdmin: true, isOwner: true } };
        reply = await handleTelegramBridge(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Unica-Bridge': secret }, body: JSON.stringify(payload) }), db, secret);
      } else reply = await handleApi(new Request(url, { method: req.method, headers: req.headers, ...(req.method !== 'OPTIONS' ? { body } : {}) }), db);
      const headers = Object.fromEntries(reply.headers); headers['set-cookie'] = reply.headers.getSetCookie(); res.writeHead(reply.status, headers); res.end(Buffer.from(await reply.arrayBuffer())); return;
    }
    if (url.pathname === '/__qa/telegram.js') { res.writeHead(200, { 'Content-Type': mime['.js'] }); res.end(shim); return; }
    const file = resolve(root, url.pathname === '/' ? 'index.html' : url.pathname.slice(1)); if (!file.startsWith(root + sep)) throw new Error('Invalid path');
    let bytes = await readFile(file);
    if (extname(file) === '.html' && url.searchParams.has('telegram')) bytes = bytes.toString().replace('https://telegram.org/js/telegram-web-app.js', '/__qa/telegram.js');
    if (url.pathname === '/transport.js') bytes = bytes.toString().replace("location.hostname === 'app8754275738.tgcloud.ai'", 'true');
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(bytes);
  } catch { res.writeHead(404).end('Not found'); }
});
server.listen(4183, '127.0.0.1', () => console.log('Isolated dual QA: http://localhost:4183/ and http://localhost:4183/?telegram'));
for (const event of ['SIGINT', 'SIGTERM']) process.on(event, () => server.close(() => { db.close(); process.exit(0); }));
