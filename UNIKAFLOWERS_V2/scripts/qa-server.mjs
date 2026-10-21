// Isolated UI QA: real handlers and SQLite, in-memory Bot API, no cloud writes.
// This script and its fixture routes are never included in web/ or deployed.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { runtime } from './test-runtime.mjs';

const app = await runtime(), root = resolve('web');
await app.endpoint('getCatalog', {}, 100);
app.sqlite.exec("UPDATE products SET price = 750 WHERE id = 1; UPDATE products SET price = 1200 WHERE id = 3; UPDATE products SET availability = 'preorder' WHERE id = 2; UPDATE products SET availability = 'soldout' WHERE id = 4");
const roles = { owner: 5211227935, admin: 1154273072, buyer: 100 };
const shim = `const role=new URLSearchParams(location.search).get('role')||'buyer';window.Telegram={WebApp:{initData:'local-test-only',initDataUnsafe:{user:{first_name:'Тестовый покупатель'}},ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},Serverless:{call(name,input,callback){fetch('/__qa/api/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role,input})}).then(r=>r.json()).then(data=>callback(data.error,data.result)).catch(error=>callback({message:error.message}));}}}};`;
const mime = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png' };
createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    res.setHeader('Cache-Control', 'no-store');
    if (path === '/__qa/telegram.js') { res.setHeader('Content-Type', mime['.js']); res.end(shim); return; }
    if (path.startsWith('/__qa/api/') && req.method === 'POST') {
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 1_500_000) throw new Error('Too large'); }
      const { input, role } = JSON.parse(body); const name = path.split('/').at(-1);
      if (!['getCatalog', 'placeOrder', 'getMyOrders', 'cancelOrder', 'getAdmin', 'mutateAdmin'].includes(name)) throw new Error('Unknown endpoint');
      res.setHeader('Content-Type', mime['.json']);
      try { res.end(JSON.stringify({ result: await app.endpoint(name, input, roles[role] || 100) })); }
      catch (error) { res.end(JSON.stringify({ error: { message: error.message, parameters: error.parameters } })); }
      return;
    }
    const file = resolve(root, path === '/' ? 'index.html' : path.slice(1));
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    let bytes = await readFile(file); if (extname(file) === '.html') bytes = bytes.toString().replace('https://telegram.org/js/telegram-web-app.js', '/__qa/telegram.js');
    res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream'); res.end(bytes);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(4175, '127.0.0.1', () => console.log('Isolated QA: http://127.0.0.1:4175/?role=owner'));
