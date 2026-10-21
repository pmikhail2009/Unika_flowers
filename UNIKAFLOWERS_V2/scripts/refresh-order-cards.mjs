import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { resolveToken } from '../node_modules/@tgcloud/cli/src/core/credentials.js';
import { runFunction } from '../node_modules/@tgcloud/cli/src/api/endpoints.js';
const root=resolve('tgcloud'),sources={};
async function scan(folder){for(const entry of await readdir(folder,{withFileTypes:true})){const path=resolve(folder,entry.name);if(entry.isDirectory())await scan(path);else if(path.endsWith('.js'))sources[relative(root,path).replaceAll('\\','/').slice(0,-3)]=await readFile(path,'utf8');}}
await scan(root);
sources['endpoints/refreshCards']=`import { db } from 'sdk';
import { desc } from 'sdk/db';
import { orders } from '../schema.js';
import { showAdminOrder } from '../lib/admin.js';
export default async function(){
 const latest=await db.select().from(orders).orderBy(desc(orders.id)).limit(1).get();
 if(!latest)return {sent:[],reason:'No orders'};
 const sent=[];
 for(const id of [5211227935,1154273072]){
  await showAdminOrder(id,latest);
  sent.push({adminId:id,orderId:latest.id,status:latest.status});
 }
 return {sent};
}`;
const result=await runFunction(await resolveToken(),'endpoints/refreshCards',sources,{},{});
console.log(JSON.stringify(result.result,null,2));
