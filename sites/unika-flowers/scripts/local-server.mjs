import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { Readable } from 'node:stream';
import { openDatabase } from '../server/sqlite.mjs';
import { seed, handleApi, createStaff, randomToken } from '../server/shop.mjs';
const root = resolve('public'), local = resolve('.local');
await mkdir(local, { recursive: true });
const db = await openDatabase(resolve(local, 'shop.sqlite'));
await seed(db);
if (!(await db.prepare('SELECT COUNT(*) AS n FROM staff').first()).n) {
 const password = randomToken();
 await createStaff(db, { username: 'owner', name: 'Владелец магазина', password, role: 'owner' });
 await writeFile(resolve(local, 'access.txt'), `UNICA & FLOWERS — локальная панель управления\nЛогин: owner\nПароль: ${password}\nСмените пароль в панели после входа.\n`, { mode: 0o600 });
 console.log('Данные первого входа сохранены в .local/access.txt');
}
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' };
const server = createServer(async (req, res) => {
 try {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
   const request = new Request(url, { method: req.method, headers: req.headers, ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body: Readable.toWeb(req), duplex: 'half' } : {}) });
   const reply = await handleApi(request, db, { ip: req.socket.remoteAddress });
   const headers = Object.fromEntries(reply.headers); headers['set-cookie'] = reply.headers.getSetCookie();
   res.writeHead(reply.status, headers); res.end(Buffer.from(await reply.arrayBuffer())); return;
  }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
  const pathname = decodeURIComponent(url.pathname);
  const path = resolve(root, pathname === '/' ? 'index.html' : pathname.slice(1));
  if (!path.startsWith(root + sep) || !(await stat(path)).isFile()) { res.writeHead(404).end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  res.end(req.method === 'HEAD' ? undefined : await readFile(path));
 } catch { res.writeHead(404).end('Not found'); }
});
const port = Number(process.env.PORT) || 4180;
server.listen(port, '127.0.0.1', () => console.log(`UNICA & FLOWERS: http://127.0.0.1:${port}/`));
for (const event of ['SIGINT', 'SIGTERM']) process.on(event, () => server.close(() => { db.close(); process.exit(0); }));
