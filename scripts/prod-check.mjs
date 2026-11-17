import { createHmac } from 'node:crypto';
const token = '123456:PROD_TEST_TOKEN';
const owner = 777777;
function sign(user, authDate = Math.floor(Date.now()/1000)) {
  const params = new URLSearchParams({ auth_date: String(authDate), query_id: 'AAH-prod', user: JSON.stringify(user) });
  const check = [...params.entries()].sort(([a],[b]) => a<b?-1:1).map(([k,v])=>`${k}=${v}`).join('\n');
  const secret = createHmac('sha256','WebAppData').update(token).digest();
  const hash = createHmac('sha256',secret).update(check).digest('hex');
  params.set('hash', hash);
  return params.toString();
}
const base='http://localhost:3100';
const results={};
const health=await fetch(base+'/api/health'); results.health=[health.status, await health.json()];
const unauth=await fetch(base+'/api/items'); results.unauth=[unauth.status, await unauth.text()];
const wrong=await fetch(base+'/api/items',{headers:{'X-Telegram-Init-Data':sign({id:42,first_name:'Eve'})}}); results.wrong=[wrong.status, await wrong.text()];
const valid=sign({id:owner,first_name:'Owner'});
const ok=await fetch(base+'/api/items',{headers:{'X-Telegram-Init-Data':valid}}); results.valid=[ok.status, (await ok.json()).total];
const header=await fetch(base+'/api/tags',{headers:{Authorization:'tma '+valid}}); results.authHeader=[header.status, await header.json()];
const unknown=await fetch(base+'/api/nope',{headers:{'X-Telegram-Init-Data':valid}}); results.unknownApi=[unknown.status, await unknown.text()];
const root=await fetch(base+'/'); results.root=[root.status, (await root.text()).includes('<div id="root">')];
const webhookNoSecret=await fetch(base+'/telegram/webhook',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}); results.webhookNoSecret=[webhookNoSecret.status, await webhookNoSecret.text()];
const webhookWrongSecret=await fetch(base+'/telegram/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':'wrong'},body:'{}'}); results.webhookWrongSecret=[webhookWrongSecret.status, await webhookWrongSecret.text()];
const create=await fetch(base+'/api/items',{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Init-Data':valid},body:JSON.stringify({content:'Production #search test'})}); results.create=[create.status, await create.json()];
const fts=await fetch(base+'/api/items?q='+encodeURIComponent('prod* - "'),{headers:{'X-Telegram-Init-Data':valid}}); results.fts=[fts.status, await fts.json()];
console.log(JSON.stringify(results,null,2));
