import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { resolveToken } from '../node_modules/@tgcloud/cli/src/core/credentials.js';
import { runFunction } from '../node_modules/@tgcloud/cli/src/api/endpoints.js';

const destination = process.argv[2];
if (!destination) throw new Error('Usage: node scripts/backup-cloud.mjs <backup-directory>');
const source = `import { db, api } from 'sdk';
export default async function () {
  const names = await db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
  const tables = {};
  for (const { name } of names) {
    if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error('Unexpected table name');
    tables[name] = await db.all('SELECT * FROM "' + name + '"');
  }
  const schema = await db.all("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name");
  return { bot: await api.getMe(), tables, schema };
}`;
const token = await resolveToken();
const result = await runFunction(token, 'endpoints/maintenance', { 'endpoints/maintenance': source }, {}, {});
await mkdir(resolve(destination), { recursive: true });
const file = resolve(destination, 'cloud-data.json');
await writeFile(file, JSON.stringify({ createdAt: new Date().toISOString(), ...result.result }, null, 2));
console.log(JSON.stringify({ file, bot: result.result.bot.username, tables: Object.fromEntries(Object.entries(result.result.tables).map(([name, rows]) => [name, rows.length])) }));
