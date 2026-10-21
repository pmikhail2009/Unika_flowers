import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openDatabase } from '../server/sqlite.mjs';
const directory = resolve('.local/backups'); await mkdir(directory, { recursive: true });
const file = resolve(directory, `unica-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
const db = await openDatabase(resolve('.local/shop.sqlite'));
try { db.sqlite.prepare('VACUUM INTO ?').run(file); console.log(file); } finally { db.close(); }
