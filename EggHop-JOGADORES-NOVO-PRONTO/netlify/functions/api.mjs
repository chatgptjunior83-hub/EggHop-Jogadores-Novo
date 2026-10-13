import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { getStore } from '@netlify/blobs';

// No password or admin token is ever sent to public HTML/JS.
const PLACE_ID = '107778070777162';
const GUEST = 'egghop_guest';
const ACCESS_SECONDS = 90 * 86400;
const outputHeaders = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const cache = new Map();
function json(value,status=200,headers={}){return new Response(JSON.stringify(value),{status,headers:{...outputHeaders,...headers}});}
function env(){return {bridge:process.env.ADMIN_BRIDGE_SECRET||'',secret:process.env.SESSION_SECRET||''};}
function goodConfig(e){return e.bridge.length>=32 && e.secret.length>=32 && e.bridge!==e.secret && !e.bridge.includes('COLOQUE_') && !e.secret.includes('GERE_');}
function hmac(secret,s){return createHmac('sha256',secret).update(s).digest('hex');}
function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||!a||a.length!==b.length)return false;return timingSafeEqual(Buffer.from(a),Buffer.from(b));}
function isBridge(request,secret){return equal(request.headers.get('x-egghop-bridge')||'',secret);}
function cookies(request){const cookie=request.headers.get('cookie')||'';const v={};for(const item of cookie.split(';')){const at=item.indexOf('=');if(at>0)v[item.slice(0,at).trim()]=item.slice(at+1).trim();}return v;}
function cookie(name,value,maxAge,request){const u=new URL(request.url);const secure=u.protocol==='https:'?'; Secure':'';return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=${maxAge}`;}
function store(){return getStore({name:'egghop-tiktok-access-v1',consistency:'strong'});}
function keyFor(token,secret){return `requests/${hmac(secret,`guest:${token}`)}`;}
// Reserva um nick aprovado para um único pedido/navegador, sem diferenciação de maiúsculas.
function nickKey(nick,secret){return `nick_claims/${hmac(secret,`nick:${nick.toLowerCase()}`)}`;}
async function account(request,s,e){
  const t=cookies(request)[GUEST]||'';
  if(!/^[a-f0-9]{64}$/.test(t))return null;
  const id=keyFor(t,e.secret);
  const r=await s.get(id,{type:'json',consistency:'strong'});
  if(!r||!['pending','approved','blocked'].includes(r.status))return null;
  if(r.status!=='approved')return r;
  // Protege até aprovações anteriores à implantação desta versão (migração automática).
  const nk=nickKey(r.nick,e.secret);
  let claim=await s.get(nk,{type:'json',consistency:'strong'});
  if(!claim){
    const write=await s.setJSON(nk,{requestId:id,nick:r.nick,claimedAt:new Date().toISOString()},{onlyIfNew:true});
    claim=write.modified?{requestId:id}:await s.get(nk,{type:'json',consistency:'strong'});
  }
  // Só a sessão que recebeu a reserva pode acessar, mesmo conhecendo o nick.
  return claim?.requestId===id?r:{...r,status:'blocked'};
}
function publicAccount(r){if(!r)return {status:'new'};return {status:r.status,nick:r.nick,code:r.status==='pending'?r.code:undefined};}
async function data(request){if(request.headers.get('content-type')?.split(';')[0]?.trim()!=='application/json')throw Object.assign(Error('Envie JSON.'),{status:415});const raw=await request.text();if(raw.length>4000)throw Object.assign(Error('Dados grandes demais.'),{status:413});try{return JSON.parse(raw);}catch{throw Object.assign(Error('Dados inválidos.'),{status:400});}}
function checkOrigin(request){const origin=request.headers.get('origin');if(!origin)return true;try{return new URL(origin).host===new URL(request.url).host;}catch{return false;}}
function ipHash(request,secret){const ip=(request.headers.get('x-nf-client-connection-ip')||request.headers.get('x-forwarded-for')||'').split(',')[0].trim().slice(0,80);return `rates/${hmac(secret,`ip:${ip||'unknown'}`)}`;}
async function rateRequest(request,s,e){
  const key=ipHash(request,e.secret);const now=Date.now();const row=await s.get(key,{type:'json',consistency:'strong'});
  if(row?.until>now)throw Object.assign(Error('Muitos pedidos. Tente mais tarde.'),{status:429});
  const count=Number(row?.count)||0;const reset=Number(row?.reset)||0;
  const next=now>reset?{count:1,reset:now+3600000,until:0}:{count:count+1,reset,until:count>=7?now+3600000:0};
  await s.setJSON(key,next);
  if(next.until)throw Object.assign(Error('Limite de solicitações atingido. Tente mais tarde.'),{status:429});
}
async function robloxServers(url){
  const cursor=url.searchParams.get('cursor')||'';const order=url.searchParams.get('sortOrder')==='Desc'?'Desc':'Asc';
  if(cursor.length>2048||/[^A-Za-z0-9_+\-/=.]/.test(cursor))return json({error:'Cursor inválido.'},400);
  const k=order+':'+cursor;const hit=cache.get(k);if(hit&&hit.until>Date.now())return json(hit.value);
  const api=new URL(`https://games.roblox.com/v1/games/${PLACE_ID}/servers/Public`);
  api.searchParams.set('sortOrder',order);api.searchParams.set('limit','100');api.searchParams.set('excludeFullGames','true');if(cursor)api.searchParams.set('cursor',cursor);
  let upstream;try{upstream=await fetch(api,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)});}catch{return json({error:'O Roblox não respondeu agora.'},503);}
  if(upstream.status===429)return json({error:'Limite de consultas do Roblox. Aguarde um pouco.'},429);
  if(!upstream.ok)return json({error:`Erro temporário ao consultar o Roblox (${upstream.status}).`},502);
  let body;try{body=await upstream.json();}catch{return json({error:'Resposta inválida do Roblox.'},502);}
  if(!Array.isArray(body?.data))return json({error:'A lista de servidores não está disponível.'},502);
  const value={data:body.data.filter(x=>x&&typeof x.id==='string'&&/^[0-9a-f-]{16,80}$/i.test(x.id)&&Number.isInteger(x.playing)&&Number.isInteger(x.maxPlayers)&&x.playing>=0&&x.playing<x.maxPlayers).map(x=>({id:x.id,playing:x.playing,maxPlayers:x.maxPlayers})),nextPageCursor:typeof body.nextPageCursor==='string'?body.nextPageCursor:null};
  if(cache.size>45)cache.clear();cache.set(k,{value,until:Date.now()+20000});return json(value);
}
async function allRequests(s){
  const found=[];
  for await (const page of s.list({prefix:'requests/',paginate:true})) {
    for(const item of page.blobs){const req=await s.get(item.key,{type:'json',consistency:'strong'});if(req)found.push({id:item.key,...req});if(found.length>=500)break;}
    if(found.length>=500)break;
  }
  found.sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));return found;
}
export default async function handler(request){
  const route=(new URL(request.url)).searchParams.get('route')||'';const e=env();
  if(!['GET','POST'].includes(request.method))return json({error:'Método não permitido.'},405);
  if(request.method==='POST'&&!checkOrigin(request))return json({error:'Origem inválida.'},403);
  if(!goodConfig(e))return json({error:'Este site ainda precisa das variáveis SESSION_SECRET e ADMIN_BRIDGE_SECRET na Netlify.'},503);
  try{
    const s=store();
    if(route==='status'&&request.method==='GET')return json(publicAccount(await account(request,s,e)));
    if(route==='request'&&request.method==='POST'){
      const payload=await data(request);const nick=String(payload.nick||'').trim();
      if(!/^[A-Za-z0-9_]{3,20}$/.test(nick))return json({error:'O nick precisa ter entre 3 e 20 caracteres válidos.'},400);
      let token=cookies(request)[GUEST]||'';const valid=/^[a-f0-9]{64}$/.test(token);
      if(!valid)token=randomBytes(32).toString('hex');
      const key=keyFor(token,e.secret);
      const present=await s.get(key,{type:'json',consistency:'strong'});
      if(present){return json(publicAccount(await account(request,s,e)),200,{'Set-Cookie':cookie(GUEST,token,ACCESS_SECONDS,request)});}
      if(await s.get(nickKey(nick,e.secret),{type:'json',consistency:'strong'}))
        return json({error:'Este nick já foi liberado para outro navegador. Peça ao administrador para desvincular o acesso anterior.'},409);
      await rateRequest(request,s,e);
      const code=String(randomInt(100000,1000000));const now=new Date().toISOString();
      const row={nick,code,status:'pending',createdAt:now,updatedAt:now};
      const result=await s.setJSON(key,row,{onlyIfNew:true});
      if(!result.modified)return json({error:'Pedido já registrado. Atualize a página.'},409);
      return json(publicAccount(row),201,{'Set-Cookie':cookie(GUEST,token,ACCESS_SECONDS,request)});
    }
    if(route==='servers'&&request.method==='GET'){
      const r=await account(request,s,e);if(r?.status!=='approved')return json({error:'Acesso ao Server Hop não autorizado.'},403);
      return robloxServers(new URL(request.url));
    }
    if(!isBridge(request,e.bridge))return json({error:'Acesso exclusivo do painel administrador.'},403);
    if(route==='admin-list'&&request.method==='GET')return json({requests:await allRequests(s)});
    if(route==='admin-decision'&&request.method==='POST'){
      const payload=await data(request);const id=String(payload.id||'');const decision=String(payload.decision||'');
      if(!/^requests\/[a-f0-9]{64}$/.test(id)||!['approved','blocked','pending'].includes(decision))return json({error:'Decisão inválida.'},400);
      const meta=await s.getMetadata(id);const existing=await s.get(id,{type:'json',consistency:'strong'});
      if(!meta?.etag||!existing)return json({error:'Pedido não encontrado.'},404);
      if(decision==='approved'){
        const nk=nickKey(existing.nick,e.secret);
        let claim=await s.get(nk,{type:'json',consistency:'strong'});
        if(!claim){
          const reserved=await s.setJSON(nk,{requestId:id,nick:existing.nick,claimedAt:new Date().toISOString()},{onlyIfNew:true});
          claim=reserved.modified?{requestId:id}:await s.get(nk,{type:'json',consistency:'strong'});
        }
        if(claim?.requestId!==id)return json({error:'Este nick já pertence a outro acesso. Bloqueie pedidos duplicados ou desvincule o acesso anterior.'},409);
      }
      const row={...existing,status:decision,everApproved:decision==='approved'||existing.everApproved===true,updatedAt:new Date().toISOString()};
      const r=await s.setJSON(id,row,{onlyIfMatch:meta.etag});
      if(!r.modified)return json({error:'O pedido foi alterado por outra sessão. Atualize e tente novamente.'},409);
      return json({ok:true,status:decision});
    }
    if(route==='admin-release-nick'&&request.method==='POST'){
      const payload=await data(request);
      const id=String(payload.id||'');
      if(!/^requests\/[a-f0-9]{64}$/.test(id))return json({error:'Pedido inválido.'},400);
      const meta=await s.getMetadata(id);
      const r=await s.get(id,{type:'json',consistency:'strong'});
      if(!meta?.etag||!r)return json({error:'Pedido não encontrado.'},404);
      const nk=nickKey(r.nick,e.secret);
      const claim=await s.get(nk,{type:'json',consistency:'strong'});
      if(!claim||claim.requestId!==id)return json({error:'Este pedido não tem a reserva do nick.'},409);
      // Primeiro bloqueia o acesso antigo, depois libera o nick para novo pedido.
      const block=await s.setJSON(id,{...r,status:'blocked',updatedAt:new Date().toISOString()},{onlyIfMatch:meta.etag});
      if(!block.modified)return json({error:'Pedido alterado, atualize e tente novamente.'},409);
      await s.delete(nk);
      return json({ok:true,status:'blocked',released:true});
    }
    return json({error:'Rota não encontrada.'},404);
  }catch(err){
    if(err.status&&err.status<500)return json({error:err.message},err.status);
    console.error('[EggHop]',err?.message||err);
    return json({error:'Falha no servidor. Confira a implantação e tente novamente.'},503);
  }
}
