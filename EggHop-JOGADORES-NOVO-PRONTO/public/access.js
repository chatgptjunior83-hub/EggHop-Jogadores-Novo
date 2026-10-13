(()=>{
  'use strict';
  // EGGBUILD NOVO-2026: depois de aprovado, não reabre o portão em falhas temporárias.
  const $ = id => document.getElementById(id);
  const sections = ['gateLoading','requestForm','pendingPanel','blockedPanel','configPanel'];
  let state = 'loading';
  let currentNick = '';
  let currentCode = '';
  let waitingTimer = null;
  let checking = false;
  let approved = false;

  function show(id) { sections.forEach(p => { $(p).hidden = p !== id; }); }
  function message(text,good=false) {
    $('accessNotice').textContent = text;
    $('accessNotice').className = 'access-notice' + (good ? ' good' : '');
  }
  function stopPolling() { if (waitingTimer !== null) { clearInterval(waitingTimer); waitingTimer = null; } }
  function activate(nick) {
    if (approved) return;
    approved = true;
    state = 'approved';
    stopPolling();
    $('accessGate').hidden = true;
    document.body.classList.remove('is-locked');
    $('accountBar').hidden = false;
    $('activeAccount').textContent = nick || currentNick;
    window.eggHopUnlock?.();
  }
  function showBlocked() {
    // Somente um status confirmado do servidor pode bloquear.
    approved = false;
    stopPolling();
    state = 'blocked';
    window.eggHopClear?.();
    $('accessGate').hidden = false;
    document.body.classList.add('is-locked');
    $('accountBar').hidden = true;
    show('blockedPanel');
  }
  async function api(route, options={}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch('/.netlify/functions/api?route='+encodeURIComponent(route),{
        method: options.method || 'GET',
        credentials:'same-origin',cache:'no-store',signal:controller.signal,
        headers:{Accept:'application/json', ...(options.body?{'Content-Type':'application/json'}:{})},
        ...options
      });
      const json = await res.json().catch(()=>({}));
      if (!res.ok) throw Error(json.error || 'O serviço de autorização não respondeu corretamente ('+res.status+').');
      return json;
    } catch (e) {
      if(e.name==='AbortError') throw Error('A verificação demorou demais. Tente novamente.');
      throw e;
    } finally { clearTimeout(timeout); }
  }
  function draw(result) {
    if (approved) return;
    const next = result.status || 'new';
    state = next;
    if(next==='approved') return activate(result.nick);
    if(next==='blocked') return showBlocked();
    if(next==='pending') {
      currentNick = String(result.nick||''); currentCode = String(result.code||'');
      $('pendingNick').textContent=currentNick;
      $('pendingCode').textContent=currentCode;
      show('pendingPanel');
      if(waitingTimer===null) waitingTimer=setInterval(checkStatus, 12000);
      return;
    }
    stopPolling();
    show('requestForm');
  }
  async function checkStatus() {
    if (approved || checking) return; // evita respostas concorrentes ou repetidas após aprovação
    checking = true;
    try {
      const result = await api('status');
      draw(result);
      message('');
    } catch(e) {
      if(approved) return;
      // Erro temporário não faz a página piscar: conserva o painel que estava visível.
      if(state==='loading') show('configPanel');
      message(e.message || 'Falha ao verificar acesso. Tente novamente.');
    } finally { checking = false; }
  }
  $('requestForm').addEventListener('submit', async event => {
    event.preventDefault();
    const nick = $('robloxNick').value.trim();
    if(!/^[A-Za-z0-9_]{3,20}$/.test(nick)) return message('Digite um nick válido (3 a 20 letras, números ou _).');
    const b=$('requestBtn');b.disabled=true;message('Enviando pedido...');
    try {
      const result=await api('request',{method:'POST',body:JSON.stringify({nick})});
      draw(result);
      message('Pedido enviado. Agora mande o nick e o código pelo TikTok.',true);
    } catch(e) { message(e.message); }
    finally {b.disabled=false;}
  });
  $('copyPending').addEventListener('click',async()=>{
    const text=`Meu nick no Roblox: ${currentNick}\nCódigo EggHop: ${currentCode}`;
    try { await navigator.clipboard.writeText(text);message('Copiado! Envie pelo TikTok.',true); }
    catch { message('Copie o nick e o código manualmente.'); }
  });
  $('manualRefresh').addEventListener('click',checkStatus);
  $('accessExit').addEventListener('click',()=>alert('O acesso está vinculado a este navegador. Se você trocar de aparelho ou apagar os cookies, peça nova aprovação ao administrador pelo TikTok.'));
  // Sem escuta de 'egghop:lock': falha na busca NÃO altera o estado de autorização no navegador.
  checkStatus();
})();
