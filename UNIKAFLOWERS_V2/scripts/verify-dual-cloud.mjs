import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { resolveToken } from '../node_modules/@tgcloud/cli/src/core/credentials.js';
import { getFiles, runFunction, getMigrationStatus, getWebhook } from '../node_modules/@tgcloud/cli/src/api/endpoints.js';

const site = 'https://unika-flowers-garden.brainy-chick-3547.chatgpt.site', telegram = 'https://app8754275738.tgcloud.ai';
const deadline = () => AbortSignal.timeout(25000);
for (const file of ['index.html','app.js','lib.js','admin.js','standalone.js','transport.js','styles.css','legacy/index.html','legacy/app.js']) {
  const response = await fetch(`${telegram}/${file}`, { signal: deadline(), cache: 'no-store' }); assert.equal(response.status, 200, file);
  assert.equal(await response.text(), await readFile(resolve('web', file), 'utf8'), `Static mismatch: ${file}`);
}
const preflight = await fetch(`${site}/api/getCatalog`, { method: 'OPTIONS', headers: { Origin: telegram, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Content-Type,Authorization,X-Unica-Session' }, signal: deadline() });
assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), telegram);
const browser = await fetch(`${site}/api/getCatalog`, { method: 'POST', headers: { Origin: telegram, 'Content-Type': 'application/json' }, body: '{}', signal: deadline() });
assert.equal(browser.status, 200); assert.equal(browser.headers.get('access-control-allow-origin'), telegram);
const catalog = await browser.json(); assert.ok(catalog.result.products.length); assert.equal(catalog.result.profile.isAdmin, false); assert.match(catalog.auth.guestToken, /^[a-f0-9]{48}$/);
const forbidden = await fetch(`${site}/api/getAdmin`, { method: 'POST', headers: { Origin: telegram, 'Content-Type': 'application/json', Authorization: `Bearer ${catalog.auth.guestToken}` }, body: JSON.stringify({ telegram: { id: 5211227935, isOwner: true }, isAdmin: true }), signal: deadline() }); assert.equal(forbidden.status, 401);
const forgedBridge = await fetch(`${site}/api/telegramBridge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'getAdmin', telegram: { id: 5211227935, isOwner: true, isAdmin: true } }), signal: deadline() }); assert.equal(forgedBridge.status, 403);
const sources = {}, root = resolve('tgcloud');
async function scan(dir) { for (const entry of await readdir(dir, { withFileTypes: true })) { const file = resolve(dir, entry.name); if (entry.isDirectory()) await scan(file); else if (file.endsWith('.js')) sources[relative(root, file).replaceAll('\\', '/').slice(0,-3)] = await readFile(file, 'utf8'); } }
await scan(root);
const token = await resolveToken(), cloud = await getFiles(token);
assert.equal(cloud.canonical_modules['endpoints/siteBridge'], sources['endpoints/siteBridge']);
const profiles = [];
for (const id of [5211227935, 1154273072, 100]) {
  const response = await runFunction(token, 'endpoints/siteBridge', sources, { action: 'getCatalog', input: {} }, { initData: { user: { id, first_name: 'Проверка доступа' } } });
  const profile = response.result.result.profile;
  assert.equal(profile.isAdmin, id !== 100); assert.equal(profile.isOwner, id === 5211227935);
  profiles.push({ id, isAdmin: profile.isAdmin, isOwner: profile.isOwner, authMethod: profile.authMethod });
}
const migration = await getMigrationStatus(token); assert.equal(migration.db_changes?.length || 0, 0);
const hook = await getWebhook(token); assert.equal(hook.in_sync, true);
const report = { verifiedAt: new Date().toISOString(), telegramUrl: telegram, backendUrl: site, revision: cloud.revision, publicBrowserApi: browser.status, crossOriginPreflight: preflight.status, anonymousAdmin: forbidden.status, forgedTelegramIdentity: forgedBridge.status, profiles, products: catalog.result.products.length, staticFilesMatch: true, legacyPreserved: true, schemaInSync: true, webhookInSync: hook.in_sync, productionTestOrdersCreated: 0 };
await writeFile('dual-mode-verification.json', JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
