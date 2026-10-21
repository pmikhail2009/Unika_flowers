// Execute the real server modules against SQLite; Telegram calls stay in memory.
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

export async function runtime(options = {}) {
  const sqlite = new DatabaseSync(':memory:'), messages = [], tables = new Map();
  const quote = name => `"${name.replaceAll('"', '""')}"`;
  const encode = (column, value) => value == null ? null : column.type === 'json' ? JSON.stringify(value) : column.type === 'boolean' ? Number(!!value) : value;
  const decode = (table, row) => row ? Object.fromEntries(Object.entries(table.columns).map(([key, column]) => {
    const value = row[column.name]; return [key, value == null ? null : column.type === 'json' ? JSON.parse(value) : column.type === 'boolean' ? !!value : value];
  })) : null;
  function column(type, name) {
    return { type, name, primary: false, required: false, uniqueValue: false,
      primaryKey(options = {}) { this.primary = true; this.auto = options.autoIncrement; return this; },
      notNull() { this.required = true; return this; }, default(value) { this.defaultValue = value; return this; }, unique() { this.uniqueValue = true; return this; } };
  }
  const sdkDb = {
    integer: name => column('integer', name), text: name => column('text', name), boolean: name => column('boolean', name), json: name => column('json', name),
    table(name, columns, indexes) {
      const table = { _name: name, columns };
      for (const [key, value] of Object.entries(columns)) { value.key = key; value.table = table; table[key] = value; }
      const definition = Object.values(columns).map(col => {
        let result = `${quote(col.name)} ${['integer', 'boolean'].includes(col.type) ? 'INTEGER' : 'TEXT'}`;
        if (col.primary) result += ` PRIMARY KEY${col.auto ? ' AUTOINCREMENT' : ''}`;
        if (col.required) result += ' NOT NULL'; if (col.uniqueValue) result += ' UNIQUE';
        if ('defaultValue' in col) { const value = encode(col, col.defaultValue); result += ` DEFAULT ${typeof value === 'number' ? value : "'" + String(value).replaceAll("'", "''") + "'"}`; }
        return result;
      }).join(', ');
      sqlite.exec(`CREATE TABLE IF NOT EXISTS ${quote(name)} (${definition})`); tables.set(name, table); if (indexes) indexes(table); return table;
    },
    index: () => ({ on() { return this; } }),
    uniqueIndex: name => ({ on(...columns) { sqlite.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${quote(name)} ON ${quote(columns[0].table._name)} (${columns.map(col => quote(col.name)).join(',')})`); return this; } }),
    eq: (col, value) => ({ sql: `${quote(col.name)} = ?`, params: [encode(col, value)] }),
    gt: (col, value) => ({ sql: `${quote(col.name)} > ?`, params: [encode(col, value)] }),
    like: (col, value) => ({ sql: `${quote(col.name)} LIKE ?`, params: [value] }),
    inArray: (col, values) => ({ sql: `${quote(col.name)} IN (${values.map(() => '?').join(',')})`, params: values.map(value => encode(col, value)) }),
    and: (...clauses) => combine('AND', clauses), or: (...clauses) => combine('OR', clauses),
    asc: col => `${quote(col.name)} ASC`, desc: col => `${quote(col.name)} DESC`,
  };
  function combine(operator, clauses) { return { sql: '(' + clauses.filter(Boolean).map(clause => clause.sql).join(` ${operator} `) + ')', params: clauses.filter(Boolean).flatMap(clause => clause.params) }; }
  function builder(kind, table, projection) {
    const state = { kind, table, projection };
    const methods = {
      from(value) { state.table = value; return this; }, values(value) { state.values = value; return this; }, set(value) { state.set = value; return this; }, where(value) { state.where = value; return this; },
      orderBy(...values) { state.order = values; return this; }, limit(value) { state.limit = value; return this; }, offset(value) { state.offset = value; return this; },
      onConflictDoNothing(options) { state.conflict = options; return this; }, onConflictDoUpdate(options) { state.conflict = options; state.updateConflict = options.set; return this; },
      returning() { state.returning = true; return this; }, async all() { return execute(true); }, async get() { return execute(true)[0] || null; }, async run() { return execute(state.returning); },
    };
    function execute(rows) {
      const table = state.table, params = []; let query;
      const entries = object => Object.entries(object).filter(([, value]) => value !== undefined);
      const assignments = object => entries(object).map(([key, value]) => { params.push(encode(table.columns[key], value)); return `${quote(table.columns[key].name)} = ?`; }).join(', ');
      if (kind === 'select') query = `SELECT * FROM ${quote(table._name)}`;
      if (kind === 'insert') {
        const pairs = entries(state.values); query = `INSERT INTO ${quote(table._name)} (${pairs.map(([key]) => quote(table.columns[key].name)).join(', ')}) VALUES (${pairs.map(([key, value]) => { params.push(encode(table.columns[key], value)); return '?'; }).join(',')})`;
        if (state.conflict) query += ` ON CONFLICT(${quote(state.conflict.target.name)}) DO ${state.updateConflict ? `UPDATE SET ${assignments(state.updateConflict)}` : 'NOTHING'}`;
      }
      if (kind === 'update') query = `UPDATE ${quote(table._name)} SET ${assignments(state.set)}`;
      if (kind === 'delete') query = `DELETE FROM ${quote(table._name)}`;
      if (state.where) { query += ` WHERE ${state.where.sql}`; params.push(...state.where.params); }
      if (state.order?.length) query += ` ORDER BY ${state.order.join(', ')}`;
      if (state.limit != null) query += ` LIMIT ${state.limit}`;
      if (state.offset != null) query += ` OFFSET ${state.offset}`;
      if (state.returning) query += ' RETURNING *';
      const statement = sqlite.prepare(query);
      if (rows || kind === 'select') return statement.all(...params).map(row => decode(table, row));
      const result = statement.run(...params); return { rowsAffected: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid), rows: [] };
    }
    return methods;
  }
  const db = {
    select: projection => builder('select', null, projection), insert: table => builder('insert', table), update: table => builder('update', table), delete: table => builder('delete', table),
    async $count(table, where) { return builder('select', table).where(where).all().then(rows => rows.length); },
    async all(query, params = {}) { return sqlite.prepare(query).all(params); },
    async run(query, params = {}) { const result = sqlite.prepare(query).run(params); return { rowsAffected: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) }; },
  };
  const messageCounters = new Map();
  const api = new Proxy({}, { get: (_, method) => async params => {
    messages.push({ method, params });
    if (options.apiHandler) { const result = await options.apiHandler(method, params); if (result !== undefined) return result; }
    if (['sendMessage', 'copyMessage', 'sendPhoto', 'forwardMessage'].includes(method)) {
      const id = (messageCounters.get(params.chat_id) || 1000) + 1; messageCounters.set(params.chat_id, id);
      return { message_id: id, chat: { id: params.chat_id } };
    }
    return {};
  } });
  class EndpointError extends Error { constructor(message, parameters) { super(message); this.parameters = parameters; } }
  const context = vm.createContext({ console, Uint8Array, TextEncoder, TextDecoder });
  const cache = new Map();
  function synthetic(name, exports) {
    const mod = new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context, identifier: name }); cache.set(name, mod); return mod;
  }
  const fetch = (...args) => { if (!options.fetchHandler) throw new Error('Network is disabled in tests'); return options.fetchHandler(...args); };
  synthetic('sdk', { api, db, EndpointError, fetch }); synthetic('sdk/db', sdkDb);
  async function module(file) {
    if (cache.has(file)) return cache.get(file);
    const pending = readFile(file, 'utf8').then(source => new vm.SourceTextModule(source, { context, identifier: file }));
    cache.set(file, pending); return pending;
  }
  let linking = Promise.resolve();
  function load(file) {
    const operation = linking.then(async () => {
      const mod = await module(resolve('tgcloud', file));
      if (mod.status === 'unlinked') await mod.link((specifier, parent) => module(specifier.startsWith('sdk') ? specifier : resolve(dirname(parent.identifier), specifier)));
      if (mod.status !== 'evaluated') await mod.evaluate(); return mod.namespace;
    });
    linking = operation.catch(() => {}); return operation;
  }
  await load('schema.js');
  return { load, db, sqlite, messages, async endpoint(name, input, id = 100) { return (await load(`endpoints/${name}.js`)).default(input, id ? { initData: { user: { id, first_name: `Покупатель ${id}` } } } : {}); }, close() { sqlite.close(); } };
}
