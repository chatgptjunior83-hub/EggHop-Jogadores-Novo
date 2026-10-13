(() => {
  'use strict';
  const PLACE_ID = '107778070777162';
  const API_URL = '/.netlify/functions/api?route=servers';
  // EGGBUILD NOVO-2026: falha de busca nunca fecha o painel aprovado.
  const $ = (id) => document.getElementById(id);
  const els = {
    minSlots:$('minSlots'), playerCount:$('playerCount'), sortBy:$('sortBy'),
    hop:$('hopButton'), refresh:$('refreshButton'), more:$('loadMoreButton'),
    status:$('statusMessage'), results:$('results'), summary:$('resultSummary'),
    pages:$('pageBadge'), note:$('paginationNote'),
    count:$('metricServers'), players:$('metricPlayers'), slots:$('metricSlots'),
    modal:$('joinModal'),close:$('closeModal'),modalInfo:$('modalServerInfo'),
    appLink:$('openAppLink'),webLink:$('openWebLink'),copy:$('copyJobButton'),toast:$('toast')
  };
  const state = { servers:[], seen:new Set(), pages:0, nextCursor:null, loading:false, fetched:false, selected:null, visited:[], randomOrder:new Map(), request:null, querySort:'Asc', loadError:false };
  try { state.visited = JSON.parse(localStorage.getItem('eggHopVisited_v1') || '[]').filter(id => typeof id === 'string').slice(-150); } catch { state.visited=[]; }
  let toastTimer;
  function say(message,type='neutral') {
    els.status.textContent=message;
    els.status.className='status-message'+(type==='error'?' error':type==='success'?' success':'');
  }
  function toast(message){
    els.toast.textContent=message;els.toast.classList.add('show');
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>els.toast.classList.remove('show'),3300);
  }
  function minSlots(){
    const n = Number.parseInt(els.minSlots.value,10);
    return Number.isFinite(n)?Math.min(7,Math.max(1,n)):1;
  }
  function filters(){return {minSlots:minSlots(),playerCount:els.playerCount.value,sortBy:els.sortBy.value};}
  function filterServers(){
    const f=filters();
    const a=state.servers.filter(s=>s.maxPlayers-s.playing>=f.minSlots && (f.playerCount==='any'||s.playing===Number(f.playerCount)));
    return a.sort((x,y)=>{
      if(f.sortBy==='most') return y.playing-x.playing || x.id.localeCompare(y.id);
      if(f.sortBy==='slots') return (y.maxPlayers-y.playing)-(x.maxPlayers-x.playing) || x.playing-y.playing;
      if(f.sortBy==='random') return (state.randomOrder.get(x.id)??0)-(state.randomOrder.get(y.id)??0);
      return x.playing-y.playing || x.id.localeCompare(y.id);
    });
  }
  function el(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
  function emptyState(icon,title,description){
    const wrapper=el('div','empty-state');wrapper.append(el('div','empty-icon',icon),el('h3','',title),el('p','',description));return wrapper;
  }
  function renderServer(server,index){
    const slots=server.maxPlayers-server.playing;
    const article=el('article','server-card');
    const head=el('div','server-card-head'); const name=el('div','server-title');
    name.append(el('span','server-bullet','⌁'));
    const title=el('div');title.append(el('strong','',`Servidor #${String(index+1).padStart(2,'0')}`),el('small','',`${server.id.slice(0,8)}… · Público`));name.append(title);
    const badge=el('span','capacity-pill'+(slots<3?' medium':''),`${slots} ${slots===1?'vaga':'vagas'}`);
    head.append(name,badge);
    const progress=el('div','server-progress');const bar=el('span');bar.style.width=`${Math.max(0,Math.min(100,(server.playing/server.maxPlayers)*100))}%`;progress.append(bar);
    const bottom=el('div','server-bottom');
    const details=el('div','server-details');details.append('👥  ',el('strong','',`${server.playing} / ${server.maxPlayers}`),' jogadores');
    const join=el('button','join-button','Entrar ↗');join.type='button';join.setAttribute('aria-label',`Entrar no servidor com ${server.playing} jogadores e ${slots} vagas`);join.addEventListener('click',()=>joinServer(server));
    bottom.append(details,join);article.append(head,progress,bottom);return article;
  }
  function render(){
    const matched=filterServers(),count=matched.length;
    els.results.replaceChildren();
    els.count.textContent=state.fetched?count.toLocaleString('pt-BR'):'—';
    els.players.textContent=state.fetched?matched.reduce((acc,s)=>acc+s.playing,0).toLocaleString('pt-BR'):'—';
    els.slots.textContent=state.fetched&&count?Math.max(...matched.map(s=>s.maxPlayers-s.playing)):'—';
    els.pages.textContent=`${state.pages} ${state.pages===1?'página':'páginas'}`;
    els.summary.textContent=state.fetched?`${count} ${count===1?'servidor encontrado':'servidores encontrados'} nos resultados carregados`:'Nenhuma consulta feita';
    if(state.loading && !state.fetched){for(let i=0;i<3;i++)els.results.append(el('div','skeleton'));}
    else if(!state.fetched){els.results.append(state.loadError?emptyState('⚠️','Não foi possível carregar','O Roblox pode estar indisponível ou limitando consultas. Toque em Atualizar para tentar novamente.'):emptyState('🥚','Pronto para encontrar servidores?','Toque em Atualizar para carregar a lista de servidores públicos.'));}
    else if(!count){els.results.append(emptyState('🔎','Nenhum servidor neste filtro','Experimente diminuir o mínimo de vagas ou mudar a quantidade de jogadores.'));}
    else {const fragment=document.createDocumentFragment();matched.forEach((s,i)=>fragment.append(renderServer(s,i)));els.results.append(fragment);}
    els.more.hidden=!state.fetched||!state.nextCursor;els.more.disabled=state.loading;
    els.more.textContent=state.loading?'Carregando...':'Carregar mais servidores ↓';
    els.hop.disabled=state.loading&&state.servers.length===0;
    els.refresh.disabled=state.loading;
    els.refresh.setAttribute('aria-busy',String(state.loading));
    els.note.textContent=state.nextCursor?'* Vagas mudam rapidamente. Carregue mais para ampliar a busca.':'* As vagas podem mudar entre a busca e a entrada.';
  }
  async function fetchPage(reset=false){
    if(state.loading)return;
    if(reset){
      state.loadError=false;state.servers=[];state.seen.clear();state.randomOrder.clear();state.nextCursor=null;state.pages=0;state.fetched=false;
    }
    state.loading=true;render();say('Consultando servidores públicos do Roblox...');
    state.querySort=els.sortBy.value==='most'?'Desc':'Asc';
    const params=new URLSearchParams({limit:'100',sortOrder:state.querySort});
    if(state.nextCursor)params.set('cursor',state.nextCursor);
    const controller=new AbortController();state.request=controller;
    const timeout=setTimeout(()=>controller.abort(),17000);
    try {
      const response=await fetch(`${API_URL}&${params.toString()}`,{signal:controller.signal,headers:{Accept:'application/json'}});
      const body=await response.json().catch(()=>({}));
      if(response.status === 401 || response.status === 403) { throw new Error('Sem autorização para consultar servidores. Peça ao administrador para verificar seu acesso e recarregue a página.'); }
      if(!response.ok){throw new Error(body.error||`Não foi possível consultar o Roblox (${response.status}).`);}
      if(!Array.isArray(body.data))throw new Error('Resposta inesperada da consulta de servidores.');
      for(const item of body.data){
        if(!item || typeof item.id!=='string'||!Number.isInteger(item.playing)||!Number.isInteger(item.maxPlayers)||item.maxPlayers<=0||item.playing>=item.maxPlayers||state.seen.has(item.id))continue;
        state.seen.add(item.id);state.servers.push({id:item.id,playing:item.playing,maxPlayers:item.maxPlayers});
        state.randomOrder.set(item.id,Math.random());
      }
      state.pages++;state.fetched=true;
      state.nextCursor=typeof body.nextPageCursor==='string'&&body.nextPageCursor?body.nextPageCursor:null;
      say(`Busca concluída. ${state.servers.length} servidores públicos carregados.`, 'success');
    }catch(err){
      if(!state.servers.length){state.fetched=false;state.loadError=true;}
      const message=err.name==='AbortError'?'A consulta demorou demais. Tente atualizar.':err.message;
      say(message+' Se continuar, tente novamente mais tarde.','error');
      if(!state.servers.length)toast('Falha na consulta dos servidores. Veja a mensagem detalhada abaixo dos botões.');
    }finally{clearTimeout(timeout);state.loading=false;state.request=null;render();}
  }
  function registerVisit(id){
    state.visited=state.visited.filter(item=>item!==id);state.visited.push(id);
    if(state.visited.length>150)state.visited=state.visited.slice(-150);
    try{localStorage.setItem('eggHopVisited_v1',JSON.stringify(state.visited));}catch{}
  }
  function joinServer(server){
    state.selected=server;registerVisit(server.id);
    const query=`placeId=${encodeURIComponent(PLACE_ID)}&gameInstanceId=${encodeURIComponent(server.id)}`;
    const appUrl=`roblox://${query}`;const webUrl=`https://www.roblox.com/games/start?${query}`;
    els.appLink.href=appUrl;els.webLink.href=webUrl;
    els.modalInfo.textContent=`${server.playing}/${server.maxPlayers} jogadores · ${server.maxPlayers-server.playing} vagas · ID: ${server.id.slice(0,8)}…`;
    els.modal.hidden=false;els.close.focus({preventScroll:true});
    // A chamada ao protocolo roblox:// precisa acontecer no clique do usuário.
    // O Roblox poderá pedir confirmação e poderá ignorar a sala específica.
    window.location.href=appUrl;
  }
  function hop(){
    if(!state.fetched){toast('Busque os servidores primeiro.');fetchPage(true);return;}
    const candidates=filterServers();
    if(!candidates.length){toast('Nenhum servidor atende aos filtros atuais.');return;}
    const fresh=candidates.filter(s=>!state.visited.includes(s.id));
    const pool=fresh.length?fresh:candidates;
    const choice=pool[Math.floor(Math.random()*Math.min(pool.length,Math.min(15,pool.length)))];
    joinServer(choice);
  }
  function closeModal(){els.modal.hidden=true;els.hop.focus({preventScroll:true});}
  async function copyId(){
    if(!state.selected)return;
    try{await navigator.clipboard.writeText(state.selected.id);toast('ID do servidor copiado!');}catch{toast('Não foi possível copiar automaticamente.');}
  }
  els.refresh.addEventListener('click',()=>fetchPage(true));
  els.more.addEventListener('click',()=>fetchPage(false));
  els.hop.addEventListener('click',hop);
  els.minSlots.addEventListener('change',()=>{els.minSlots.value=String(minSlots());render();});
  els.minSlots.addEventListener('input',render);
  els.playerCount.addEventListener('change',render);
  els.sortBy.addEventListener('change',()=>{
    const nextSort=els.sortBy.value==='most'?'Desc':'Asc';
    if(nextSort!==state.querySort&&!state.loading)fetchPage(true);else render();
  });
  els.close.addEventListener('click',closeModal);
  els.modal.addEventListener('click',(ev)=>{if(ev.target===els.modal)closeModal();});
  document.addEventListener('keydown',(ev)=>{if(ev.key==='Escape'&&!els.modal.hidden)closeModal();});
  els.copy.addEventListener('click',copyId);
  // A consulta só começa após uma sessão autorizada no backend.
  window.eggHopUnlock = () => fetchPage(true);
  window.eggHopClear = () => {
    if(state.request) state.request.abort();
    state.servers=[];state.seen.clear();state.nextCursor=null;state.fetched=false;state.pages=0;state.selected=null;
    render();
  };
  render();
})();
