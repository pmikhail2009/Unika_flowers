import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { resolveToken } from '../node_modules/@tgcloud/cli/src/core/credentials.js';
import { getFiles, getWebhook, getMigrationStatus, runFunction } from '../node_modules/@tgcloud/cli/src/api/endpoints.js';

const root = resolve('tgcloud'), sources = {};
async function scan(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = resolve(folder, entry.name);
    if (entry.isDirectory()) await scan(file);
    else if (file.endsWith('.js')) sources[relative(root, file).replaceAll('\\', '/').slice(0, -3)] = await readFile(file, 'utf8');
  }
}
await scan(root);
const token = await resolveToken();
const cloud = await getFiles(token);
for (const [name, source] of Object.entries(sources)) assert.equal(cloud.canonical_modules[name], source, `Not deployed: ${name}`);
const migration = await getMigrationStatus(token); assert.equal(migration.db_changes?.length || 0, 0);
const webhook = await getWebhook(token); assert.equal(webhook.in_sync, true);
async function run(name, input, id) {
  return (await runFunction(token, `endpoints/${name}`, sources, input, { initData: { user: { id } } })).result;
}
const owner = await run('getCatalog', {}, 5211227935); assert.equal(owner.profile.isOwner, true);
const admin = await run('getCatalog', {}, 1154273072); assert.equal(admin.profile.isAdmin, true); assert.equal(admin.profile.isOwner, false);
const orders = await run('getAdmin', { action: 'orders' }, 1154273072); assert.ok(Array.isArray(orders.orders));
assert.equal(admin.profile.orderCount, orders.total);
assert.ok(orders.orders.every(order => ['new', 'confirmed', 'preparing', 'ready'].includes(order.status)));
const archive = await run('getAdmin', { action: 'orders', scope: 'archive' }, 1154273072);
assert.ok(archive.orders.every(order => ['done', 'cancelled'].includes(order.status)));
const counts = await run('getAdmin', { action: 'counts' }, 1154273072);
assert.equal(counts.total, orders.total);
const team = await run('getAdmin', { action: 'team' }, 5211227935); assert.ok(team.team.some(member => member.id === 1154273072));
const buyer = await run('getCatalog', {}, 100); assert.equal(buyer.profile.isAdmin, false);
const history = await run('getMyOrders', {}, 100); assert.equal(history.orders.length, 0);
let forbidden = false;
try { await run('getAdmin', {}, 100); } catch (error) { forbidden = error.parameters?.code === 'FORBIDDEN' || error.description?.includes('администратору') || error.message?.includes('администратору'); }
assert.equal(forbidden, true, 'Buyer must not access admin data');
const origin = 'https://app8754275738.tgcloud.ai';
for (const file of ['index.html', 'app.js', 'admin.js', 'lib.js', 'icons.js', 'assets/icons.svg', 'styles.css']) {
  const response = await fetch(`${origin}/${file}`, { cache: 'no-store' }); assert.equal(response.status, 200);
  assert.equal(await response.text(), await readFile(resolve('web', file), 'utf8'), `Static mismatch: ${file}`);
}
const unauthenticated = await fetch(`${origin}/api/getAdmin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
assert.equal(unauthenticated.status, 401);
const report = { verifiedAt: new Date().toISOString(), revision: cloud.revision, modules: Object.keys(sources).length, products: owner.products.length, owner: 5211227935, administrator: 1154273072, webhookInSync: webhook.in_sync, pendingUpdates: webhook.pending_update_count, schemaInSync: true, staticFilesMatch: true, unauthenticatedApi: unauthenticated.status, cloudOrders: orders.total + archive.total, activeOrders: orders.total, archivedOrders: archive.total };
await writeFile('verification.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
