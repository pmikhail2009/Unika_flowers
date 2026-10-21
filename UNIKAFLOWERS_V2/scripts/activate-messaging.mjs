import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { resolveToken } from '../node_modules/@tgcloud/cli/src/core/credentials.js';
import { runFunction } from '../node_modules/@tgcloud/cli/src/api/endpoints.js';
const root=resolve('tgcloud'), sources={};
async function scan(folder){for(const entry of await readdir(folder,{withFileTypes:true})){const file=resolve(folder,entry.name);if(entry.isDirectory())await scan(file);else if(file.endsWith('.js'))sources[relative(root,file).replaceAll('\\','/').slice(0,-3)]=await readFile(file,'utf8');}}
await scan(root);
sources['endpoints/activate']=`import { api, db } from 'sdk';
import { mainKeyboard } from '../lib/navigation.js';
export default async function () {
 const results=[];
 for(const id of [5211227935,1154273072]){
  try { const sent=await api.sendMessage({chat_id:id,text:'📦 В «Заказах» теперь только активные заявки, счётчик показывает их количество. Завершённые и отменённые доступны по кнопке «Архив заказов» под списком или во вкладке «Архив» на сайте.',reply_markup:await mainKeyboard(id,true)}); results.push({id,menuDelivered:!!sent.message_id}); }
  catch(error){results.push({id,menuDelivered:false,error:error.description||error.message});}
 }
 return {results,notifications:await db.all('SELECT admin_id, order_id, delivered, attempts, error FROM order_notifications ORDER BY order_id, admin_id')};
}`;
const result=await runFunction(await resolveToken(),'endpoints/activate',sources,{},{});
for(const line of result.log||[]) console.log(line);
await writeFile('messaging-verification.json',JSON.stringify({verifiedAt:new Date().toISOString(),...result.result},null,2)+'\n');
console.log(JSON.stringify(result.result,null,2));
