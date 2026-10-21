import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

const root = resolve('web');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};
const extension = (path) => path.slice(path.lastIndexOf('.'));

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const path = resolve(join(root, pathname === '/' ? 'index.html' : pathname.slice(1)));
    if (path !== root && !path.startsWith(root + sep)) {
      response.writeHead(403).end();
      return;
    }
    if (!(await stat(path)).isFile()) throw new Error('not a file');
    response.setHeader('Content-Type', mime[extension(path)] || 'application/octet-stream');
    response.end(await readFile(path));
  } catch {
    response.writeHead(404).end('Not found');
  }
}).listen(Number(process.env.PORT) || 4173, '127.0.0.1', () => {
  console.log(`Mini App: http://127.0.0.1:${Number(process.env.PORT) || 4173}/`);
});
