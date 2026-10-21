import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
export async function openDatabase(path = ':memory:') {
 const sqlite = new DatabaseSync(path);
 sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS __local_migrations (name TEXT PRIMARY KEY)');
 for (const file of (await readdir(resolve('drizzle'))).filter(f => f.endsWith('.sql')).sort()) {
  if (sqlite.prepare('SELECT name FROM __local_migrations WHERE name=?').get(file)) continue;
  sqlite.exec('BEGIN IMMEDIATE');
  try { sqlite.exec(await readFile(resolve('drizzle', file), 'utf8')); sqlite.prepare('INSERT INTO __local_migrations VALUES (?)').run(file); sqlite.exec('COMMIT'); }
  catch (e) { sqlite.exec('ROLLBACK'); throw e; }
 }
 const prepare = sql => ({
  bind(...args) { return { sql, args, async first() { return sqlite.prepare(sql).get(...args) || null; }, async all() { return { results: sqlite.prepare(sql).all(...args) }; }, async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) }, results: [] }; } }; },
  async first() { return this.bind().first(); }, async all() { return this.bind().all(); }, async run() { return this.bind().run(); },
 });
 return { prepare, sqlite, async batch(statements) {
  sqlite.exec('BEGIN IMMEDIATE');
  try {
   const result = statements.map(s => {
    if (/RETURNING\s/i.test(s.sql) || /^SELECT\s/i.test(s.sql.trim())) return { results: sqlite.prepare(s.sql).all(...s.args) };
    const r = sqlite.prepare(s.sql).run(...s.args); return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
   }); sqlite.exec('COMMIT'); return result;
  } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
 }, close() { sqlite.close(); } };
}
