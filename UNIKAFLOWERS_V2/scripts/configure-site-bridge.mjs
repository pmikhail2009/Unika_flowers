import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { resolveToken } from '../node_modules/@tgcloud/cli/src/core/credentials.js';
import { runFunction } from '../node_modules/@tgcloud/cli/src/api/endpoints.js';
process.stdin.setRawMode?.(true); process.stdin.setEncoding('utf8'); console.error('Ready for bridge configuration JSON (input hidden).');
let raw=''; for await (const chunk of process.stdin) { raw+=chunk; if (raw.includes('\n') || raw.includes('\r')) break; }
process.stdin.setRawMode?.(false); process.stdin.pause();
const config=JSON.parse(raw); if (!/^[a-f0-9]{64}$/.test(config.secret)) throw new Error('Invalid bridge key');
if (config.origin!=='https://unika-flowers-garden.brainy-chick-3547.chatgpt.site') throw new Error('Unexpected site origin');
const root=resolve('tgcloud'),sources={};
async function scan(dir) { for(const entry of await readdir(dir,{withFileTypes:true})) { const file=resolve(dir,entry.name); if(entry.isDirectory()) await scan(file); else if(file.endsWith('.js')) sources[relative(root,file).replaceAll('\\','/').slice(0,-3)]=await readFile(file,'utf8'); } }
await scan(root);
sources['endpoints/configureShared']=`import { db } from 'sdk'; import { settings } from '../schema.js'; export default async function(input) { await db.insert(settings).values({key:'site-bridge',value:input,version:0}).onConflictDoUpdate({target:settings.key,set:{value:input}}).run(); return {configured:true}; }`;
const result=await runFunction(await resolveToken(),'endpoints/configureShared',sources,config,{});
console.log(JSON.stringify(result.result));
