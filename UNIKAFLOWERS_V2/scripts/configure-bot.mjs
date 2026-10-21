import { resolveToken } from '../node_modules/@tgcloud/cli/src/core/credentials.js';
import { runFunction } from '../node_modules/@tgcloud/cli/src/api/endpoints.js';
import { APP_URL, OWNER_IDS, ADMIN_IDS } from '../tgcloud/lib/config.js';

const commands = [
  { command: 'start', description: 'Главное меню' },
  { command: 'catalog', description: 'Каталог гортензий и корзина' },
  { command: 'orders', description: 'Мои заказы и статусы' },
  { command: 'order', description: 'Оформить заявку текстом' },
  { command: 'cancel', description: 'Отменить текущий ввод' },
  { command: 'help', description: 'Помощь и связь с магазином' },
  { command: 'id', description: 'Мой Telegram ID' },
  { command: 'support', description: 'Написать магазину через бота' },
];
const source = `import { api } from 'sdk';
export default async function(input) {
  await api.setMyCommands({commands: input.commands});
  await api.setChatMenuButton({menu_button:{type:'web_app',text:'🌸 Магазин',web_app:{url:input.url}}});
  await api.setMyDescription({description:'Гортензии UNICA & FLOWERS 🌸\\nВыберите сорта в магазине, отправьте заявку и следите за её статусом. Поможем с выбором и согласуем получение. Связь с продавцом: @unika_flowers.'});
  await api.setMyShortDescription({short_description:'Гортензии с любовью 🌸 Каталог, заказы и помощь с выбором. @unika_flowers'});
  const scoped = [];
  for(const id of input.admins) {
    try { await api.setMyCommands({scope:{type:'chat',chat_id:id},commands:[...input.commands.map(command=>command.command==='orders'?{...command,description:'Заказы покупателей и архив'}:command),{command:'admin',description:'Управление магазином'},{command:'inbox',description:'Диалоги с покупателями'}]}); scoped.push({id,ok:true}); }
    catch { scoped.push({id,ok:false,reason:'Откройте бота и нажмите Start, затем повторите настройку команд.'}); }
  }
  return {username:(await api.getMe()).username,menu:await api.getChatMenuButton({}),commands:await api.getMyCommands({}),scoped};
}`;
const result = await runFunction(await resolveToken(), 'endpoints/configure', { 'endpoints/configure': source }, { commands, url: APP_URL, admins: [...OWNER_IDS, ...ADMIN_IDS] }, {});
console.log(JSON.stringify(result.result, null, 2));
