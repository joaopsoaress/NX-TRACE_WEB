// ---------- Estado
var lista = [], backups = [], RES = [], FOUND = [], padrao = null;
var run = null, scanBody = null, lastScan = null, tela = "nova";
var MAX_BACKUPS = 20, MAX_REL = 20, CONCORRENCIA = 4;
var K = {form: "nx_form", state: "nx_state", ep: "nx_endpoints", bk: "nx_backups", rels: "nx_reports", rel: "nx_report_"};


// ---------- Utilidades
function $(id){ return document.getElementById(id); }
function esc(s){
  return String(s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function go(id){
  document.querySelectorAll("section").forEach(function(s){ s.classList.toggle("active", s.id === id); });
  document.querySelectorAll("nav button").forEach(function(b){ b.classList.toggle("active", b.dataset.go === id); });
  window.scrollTo(0, 0);
  tela = id; salvarEstado();
  if (id === "relatorio") montarRel();
  if (id === "endpoints") montarEndpoints();
  if (id === "historico") montarHistorico();
}

// Notificação Toast com suporte a ação "Desfazer" (H3 - Controle e liberdade)
function toast(msg, undoFn){
  var t = $("toast");
  t.innerHTML = "";
  var span = document.createElement("span");
  span.textContent = msg;
  t.appendChild(span);

  if (typeof undoFn === "function") {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toast-undo";
    btn.textContent = "Desfazer";
    btn.addEventListener("click", function(){
      t.classList.remove("show");
      clearTimeout(t._h);
      undoFn();
    });
    t.appendChild(btn);
  }

  t.classList.add("show");
  clearTimeout(t._h);
  t._h = setTimeout(function(){ t.classList.remove("show"); }, undoFn ? 6500 : 4200);
}

// Confirmação padronizada em dois cliques (H4 - Consistência sem window.confirm)
function confirmarAcao(btn, textoConfirmacao, acao){
  if (btn.dataset.confirming === "1") {
    clearTimeout(btn._confirmTimer);
    btn.dataset.confirming = "0";
    btn.textContent = btn.dataset.origText;
    btn.classList.remove("confirm-armed");
    acao();
    return;
  }
  btn.dataset.origText = btn.textContent;
  btn.dataset.confirming = "1";
  btn.textContent = textoConfirmacao;
  btn.classList.add("confirm-armed");
  clearTimeout(btn._confirmTimer);
  btn._confirmTimer = setTimeout(function(){
    btn.dataset.confirming = "0";
    btn.textContent = btn.dataset.origText;
    btn.classList.remove("confirm-armed");
  }, 4000);
}

function tam(b){
  if (b == null) return "–";
  return b > 1024 ? (b / 1024).toFixed(1) + " KB" : b + " B";
}
function authTxt(r){ return r.auth_required ? "Sim" : "Não"; }
function statusBadge(code){
  if (code == null) return '<span class="st-badge st-err">Erro</span>';
  var cls = code >= 500 ? "st-err" : (code >= 400 ? "st-warn" : "st-ok");
  return '<span class="st-badge ' + cls + '">' + code + "</span>";
}
function log(t){ var l = $("log"); l.innerHTML += esc(t) + "<br>"; l.scrollTop = l.scrollHeight; }
function p2(n){ return (n < 10 ? "0" : "") + n; }
function fmtBR(d){ return p2(d.getDate()) + "/" + p2(d.getMonth() + 1) + "/" + d.getFullYear() + " " + p2(d.getHours()) + ":" + p2(d.getMinutes()); }
function fmtLocal(d){ return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) + " " + p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds()); }
function carimbo(d){ return d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + "_" + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds()); }

function baixar(nome, texto){
  var url = URL.createObjectURL(new Blob([texto], {type: "text/plain;charset=utf-8"}));
  var a = document.createElement("a");
  a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
}

// Diagnóstico acionável de erros (H9)
function traduzirErro(e){
  var msg = (e && e.message) ? e.message : "Falha inesperada.";
  var st = e && e.status;
  if (st === 400) return msg + " — Verifique a sintaxe da URL base e dos cabeçalhos informados.";
  if (st === 401 || st === 403) return msg + " — Acesso recusado. Verifique tokens de autenticação ou restrições de rede.";
  if (st === 404) return msg + " — Serviço de análise não encontrado no servidor.";
  if (st === 429) return "Limite de requisições atingido (HTTP 429). Aguarde alguns instantes antes de tentar novamente.";
  if (st >= 500) return "Servidor indisponível ou erro interno (HTTP " + st + "). Tente novamente em instantes.";
  if (/Failed to fetch|NetworkError|fetch/i.test(msg)) {
    return "Falha de conexão de rede. Verifique sua internet ou se o serviço está acessível.";
  }
  return msg;
}

// Prevenção de erros na URL base (H5)
function validarUrlBase(raw){
  var v = String(raw || "").trim();
  if (!v) throw new Error("Informe a URL base do alvo (ex.: https://api.exemplo.com).");
  if (!/^https?:\/\//i.test(v)) {
    throw new Error("A URL base deve começar com http:// ou https:// (ex.: https://api.exemplo.com).");
  }
  try {
    var u = new URL(v);
    if (!u.hostname) throw new Error();
  } catch (_) {
    throw new Error("URL base inválida. Informe um endereço completo como https://api.exemplo.com.");
  }
}


// ---------- Persistência no navegador (localStorage)
function guardar(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
function ler(k){ try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
function apagar(k){ try { localStorage.removeItem(k); } catch (e) {} }

function salvarEstado(){
  guardar(K.state, {tela: tela, lastId: lastScan ? lastScan.id : null, scanBody: scanBody, found: FOUND});
}
function salvarForm(){
  guardar(K.form, {url: $("url").value, met: $("met").value, hdr: $("hdr").value, disc: $("disc").checked});
}
function restaurarForm(){
  var f = ler(K.form); if (!f) return;
  $("url").value = f.url || "";
  $("met").value = f.met || "GET";
  $("hdr").value = f.hdr || "";
  $("disc").checked = !!f.disc;
}


// ---------- Comunicação com a API
async function api(url, opt){
  var r = await fetch(url, opt);
  var d = await r.json().catch(function(){ return {}; });
  if (!r.ok) {
    var e = new Error(d.error || ("Erro HTTP " + r.status));
    e.status = r.status; throw e;
  }
  return d;
}
function send(url, body, ctrl){
  return api(url, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body || {}),
                   signal: ctrl ? ctrl.signal : undefined});
}
async function sendTexto(url, body){
  var r = await fetch(url, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
  if (!r.ok) {
    var d = await r.json().catch(function(){ return {}; });
    var e = new Error(d.error || ("Erro HTTP " + r.status));
    e.status = r.status; throw e;
  }
  return r.text();
}
function readTxt(input){
  return new Promise(function(ok, fail){
    var f = input.files[0];
    if (!f) return fail(new Error("Selecione um arquivo .txt para continuar."));
    if (!/\.txt$/i.test(f.name)) return fail(new Error("Formato inválido: apenas arquivos .txt são aceitos."));
    if (f.size === 0) return fail(new Error("O arquivo selecionado está vazio."));
    if (f.size > 102400) return fail(new Error("O arquivo excede o limite máximo de 100 KB."));
    var r = new FileReader();
    r.onload = function(){ ok(r.result); };
    r.onerror = function(){ fail(new Error("Não foi possível ler o arquivo selecionado.")); };
    r.readAsText(f);
  });
}
async function carregarPadrao(){
  if (!padrao) {
    padrao = await api("/api/defaults");
    $("qtdWl").textContent = padrao.wordlist.length;
    renderizarPreviewWordlist(padrao.wordlist);
  }
  return padrao;
}
function renderizarPreviewWordlist(words){
  var box = $("wlListPreview");
  if (!box) return;
  box.innerHTML = words.map(function(w){
    return '<span class="wl-chip">' + esc(w) + "</span>";
  }).join("");
}
function baseBody(b){
  return {target: b.target, method: b.method, headers: b.headers, scope_confirmed: b.scope_confirmed};
}


// ---------- Navegação
document.querySelectorAll("nav button").forEach(function(b){
  b.addEventListener("click", function(){ go(b.dataset.go); });
});


// ---------- 1. Nova varredura & Controles reativos (H6, H8, H9)
function limparErroNova(){
  $("erroNova").textContent = "";
}

function atualizarControlesForm(){
  var usarUploadOrig = $("origUp").checked;
  $("wrapFileOrig").classList.toggle("hidden", !usarUploadOrig);

  var discAtivo = $("disc").checked;
  var wlControls = $("wlControls");
  wlControls.classList.toggle("is-disabled", !discAtivo);
  $("wlPadrao").disabled = !discAtivo;
  $("wlUp").disabled = !discAtivo;
  $("btnVerWl").disabled = !discAtivo;
  $("fileWl").disabled = !discAtivo;

  if (!discAtivo) {
    $("boxWlPreview").classList.add("hidden");
  }

  var usarUploadWl = discAtivo && $("wlUp").checked;
  $("wrapFileWl").classList.toggle("hidden", !usarUploadWl);

  var escopoOk = $("escopo").checked;
  $("iniciar").disabled = !escopoOk;
  $("hintEscopo").classList.toggle("hidden", escopoOk);
}

["url", "met", "hdr", "disc", "origPadrao", "origUp", "wlPadrao", "wlUp", "escopo"].forEach(function(id){
  $(id).addEventListener("input", function(){
    limparErroNova();
    salvarForm();
    atualizarControlesForm();
  });
  $(id).addEventListener("change", function(){
    limparErroNova();
    salvarForm();
    atualizarControlesForm();
  });
});

// Validação imediata de arquivos ao selecionar (H9)
$("fileOrig").addEventListener("change", async function(){
  limparErroNova();
  if (!this.files.length) return;
  try { await readTxt(this); }
  catch (e) { $("erroNova").textContent = e.message; }
});
$("fileWl").addEventListener("change", async function(){
  limparErroNova();
  if (!this.files.length) return;
  try { await readTxt(this); }
  catch (e) { $("erroNova").textContent = e.message; }
});

// Pré-visualização da wordlist padrão (H6)
$("btnVerWl").addEventListener("click", async function(){
  var box = $("boxWlPreview");
  if (!box.classList.contains("hidden")) {
    box.classList.add("hidden");
    this.textContent = "Ver palavras";
    return;
  }
  try {
    await carregarPadrao();
    box.classList.remove("hidden");
    this.textContent = "Ocultar palavras";
  } catch (e) {
    $("erroNova").textContent = traduzirErro(e);
  }
});

function setBtnCarregando(ativo){
  var btn = $("iniciar");
  btn.setAttribute("aria-busy", ativo ? "true" : "false");
  btn.textContent = ativo ? "Validando alvo..." : "Iniciar varredura";
  btn.disabled = ativo || !$("escopo").checked;
}

$("iniciar").addEventListener("click", async function(){
  limparErroNova();
  if (run) { $("erroNova").textContent = "Já existe uma operação em andamento."; return; }
  setBtnCarregando(true);
  try {
    validarUrlBase($("url").value);
    var body = {
      target: $("url").value.trim(),
      method: $("met").value,
      headers: $("hdr").value,
      scope_confirmed: $("escopo").checked
    };
    if ($("origUp").checked) body.endpoints_text = await readTxt($("fileOrig"));
    scanBody = body;
    if ($("disc").checked) {
      var wl = $("wlUp").checked ? await readTxt($("fileWl")) : null;
      await iniciarDescoberta(body, wl);
    } else {
      await iniciarVarredura(body);
    }
  } catch (e) {
    run = null;
    $("erroNova").textContent = traduzirErro(e);
  } finally {
    setBtnCarregando(false);
  }
});


// ---------- Execução (comum)
function prepararExec(k, target, method){
  RES = []; FOUND = [];
  $("execTbody").innerHTML = ""; $("log").innerHTML = "";
  $("prog").style.width = "0"; $("progTxt").textContent = "Iniciando...";
  $("verRel").disabled = true; $("cancelar").disabled = false;

  if (k === "discover") {
    $("execThead").innerHTML = "<tr><th>Endpoint encontrado</th><th>Status</th><th>Tipo de conteúdo</th><th>Situação</th></tr>";
    $("execSub").textContent = "Descobrindo endpoints em " + target;
  } else {
    $("execThead").innerHTML = "<tr><th>Endpoint</th><th>Status</th><th>Tempo</th><th>Tamanho</th><th>Auth</th></tr>";
    $("execSub").textContent = "Varredura [" + (method || "GET") + "] em andamento em " + target;
  }

  run = {kind: k, cancel: false, ctrl: new AbortController()};
  go("exec");
  return run;
}
function progresso(feito, total, unidade){
  $("prog").style.width = (total ? feito / total * 100 : 0) + "%";
  $("progTxt").textContent = feito + " de " + total + " " + unidade;
}
function linha(html){
  var tr = document.createElement("tr"); tr.innerHTML = html; $("execTbody").appendChild(tr);
}
function resultadoErro(ep, msg){
  return {endpoint: ep, status_code: null, response_time: null, content_length: null, truncated: false,
          auth_signals: {status_code: false, www_authenticate: false, keyword: false},
          auth_required: false, json_data: null, error: msg};
}
function fatal(e){ return e.status >= 400 && e.status < 500; }

$("cancelar").addEventListener("click", function(){
  if (run) { run.cancel = true; run.ctrl.abort(); }
  $("cancelar").disabled = true;
});
$("verRel").addEventListener("click", function(){ go("relatorio"); });


// ---------- 2. Varredura
async function iniciarVarredura(body){
  var eps = body.endpoints_text != null
    ? (await send("/api/parse", {kind: "endpoints", text: body.endpoints_text})).items
    : lista.slice();
  if (!eps.length) throw new Error("A lista de endpoints está vazia. Adicione rotas ou importe um arquivo .txt.");
  await send("/api/check", baseBody(body));

  var meu = prepararExec("scan", body.target, body.method), inicio = new Date(), estado = "done", erro = null;
  log("[info] Iniciando varredura (" + body.method + ") de " + eps.length + " endpoints em " + body.target);
  for (var i = 0; i < eps.length; i++) {
    if (meu.cancel) { estado = "cancelled"; break; }
    progresso(i, eps.length, "endpoints");
    var r;
    try {
      r = await send("/api/probe", {target: body.target, endpoint: eps[i], method: body.method,
                                    headers: body.headers, scope_confirmed: true}, meu.ctrl);
    } catch (e) {
      if (meu.cancel) { estado = "cancelled"; break; }
      if (fatal(e)) { estado = "error"; erro = traduzirErro(e); break; }
      r = resultadoErro(eps[i], traduzirErro(e));
    }
    RES.push(r);
    if (r.error) {
      linha("<td>" + esc(r.endpoint) + "</td><td colspan='4'><span class='st-badge st-err'>Falha</span> " + esc(r.error) + "</td>");
      log("[erro] " + r.endpoint + ": " + r.error);
    } else {
      linha("<td>" + esc(r.endpoint) + "</td><td>" + statusBadge(r.status_code) + "</td><td>" + r.response_time.toFixed(3) + " s</td><td>" +
            tam(r.content_length) + (r.truncated ? "+" : "") + "</td><td>" + authTxt(r) + "</td>");
      log("[ok] " + r.endpoint + " → HTTP " + r.status_code + " em " + r.response_time.toFixed(3) + " s");
    }
  }
  progresso(RES.length, eps.length, "endpoints");
  $("cancelar").disabled = true;
  if (estado === "cancelled") log("[cancel] Interrompido pelo usuário.");
  if (estado === "done") log("[fim] Varredura concluída.");

  if (RES.length) await salvarRelatorio(body, inicio);
  if (estado === "error") $("execSub").textContent = "Falha: " + erro + (RES.length ? " Os resultados parciais foram mantidos." : "");
  else $("execSub").textContent = estado === "cancelled" ? "Varredura cancelada. Os resultados parciais foram mantidos." : "Varredura concluída.";
  $("verRel").disabled = !RES.length;
  run = null;
  salvarEstado();
}

// Gera o .txt e guarda o relatório no histórico local
async function salvarRelatorio(body, inicio){
  var texto = null, startedISO = fmtLocal(inicio);
  try { texto = await sendTexto("/api/report", {target: body.target, started: startedISO, results: RES}); }
  catch (e) { toast("Relatório .txt não gerado agora: " + traduzirErro(e)); }
  var ok = RES.filter(function(r){ return !r.error; });
  var meta = {
    id: Date.now().toString(36),
    target: body.target,
    method: body.method,
    started: fmtBR(inicio),
    startedISO: startedISO,
    total: RES.length,
    ok: ok.length,
    auth: ok.filter(function(r){ return r.auth_required; }).length
  };
  lastScan = meta;
  if (!gravarRelatorio(meta, {results: RES, text: texto})) toast("Sem espaço no navegador para guardar este relatório no histórico.");
}
function gravarRelatorio(meta, dados){
  var rels = ler(K.rels) || [];
  while (!guardar(K.rel + meta.id, dados)) {
    var velho = rels.pop();
    if (!velho) { guardar(K.rels, rels); return false; }
    apagar(K.rel + velho.id);
  }
  rels.unshift(meta);
  while (rels.length > MAX_REL) apagar(K.rel + rels.pop().id);
  guardar(K.rels, rels);
  return true;
}


// ---------- 3. Descoberta por wordlist
async function iniciarDescoberta(body, wlTexto){
  var words = wlTexto != null
    ? (await send("/api/parse", {kind: "words", text: wlTexto})).items
    : (await carregarPadrao()).wordlist;
  if (!words.length) throw new Error("A wordlist está vazia.");
  await send("/api/check", baseBody(body));

  var meu = prepararExec("discover", body.target, body.method), known = new Set(lista), seen = new Set(), idx = 0, feitas = 0, erro = null;
  log("[info] Testando " + words.length + " palavras em 6 variações de caminho (raiz, barra final, /api e /v1)");

  async function worker(){
    while (!meu.cancel && !erro && idx < words.length) {
      var w = words[idx++];
      try {
        var d = await send("/api/discover", {target: body.target, word: w, headers: body.headers, scope_confirmed: true}, meu.ctrl);
        d.found.forEach(function(it){
          if (seen.has(it.endpoint)) return;
          seen.add(it.endpoint);
          it.is_new = !known.has(it.endpoint);
          FOUND.push(it);
          linha("<td>" + esc(it.endpoint) + "</td><td>" + statusBadge(it.status_code) + "</td><td>" + esc(it.content_type || "–") + "</td><td>" +
                (it.is_new ? '<span class="tag on">Novo</span>' : '<span class="tag off">Já na lista</span>') + "</td>");
          log("[ok] Encontrado: " + it.endpoint + " [HTTP " + it.status_code + "]");
        });
      } catch (e) {
        if (!meu.cancel && !erro) { erro = traduzirErro(e); meu.ctrl.abort(); }
        return;
      }
      progresso(++feitas, words.length, "palavras");
    }
  }
  await Promise.all(Array.from({length: CONCORRENCIA}, worker));

  $("cancelar").disabled = true;
  var cancelado = meu.cancel;
  run = null;
  if (erro) { $("execSub").textContent = "Falha: " + erro; return; }
  if (cancelado) { $("execSub").textContent = "Descoberta cancelada."; return; }
  progresso(words.length, words.length, "palavras");
  FOUND.sort(function(a, b){ return a.endpoint < b.endpoint ? -1 : 1; });
  montarRevisao(); go("revisao");
}

function montarRevisao(){
  var novos = FOUND.filter(function(f){ return f.is_new; }).length;
  $("revSub").textContent = FOUND.length
    ? FOUND.length + " endpoints encontrados, " + novos + " ainda não estão na lista. Marque os que quer adicionar."
    : "Nenhum endpoint encontrado com a wordlist selecionada.";
  $("descTbody").innerHTML = FOUND.map(function(f, i){
    return "<tr><td>" + (f.is_new ? '<input type="checkbox" checked data-i="' + i + '" aria-label="Adicionar ' + esc(f.endpoint) + '">' : "") + "</td>" +
      "<td>" + esc(f.endpoint) + "</td><td>" + statusBadge(f.status_code) + "</td><td>" + esc(f.content_type || "–") + "</td><td>" +
      (f.is_new ? '<span class="tag on">Novo</span>' : '<span class="tag off">Já está na lista</span>') + "</td></tr>";
  }).join("") || '<tr><td colspan="5">Nenhum endpoint encontrado. Clique em “Continuar sem adicionar” para prosseguir com a lista atual.</td></tr>';
}
$("aplicar").addEventListener("click", async function(){
  if (run || !scanBody) return;
  var sel = [];
  document.querySelectorAll("#descTbody input:checked").forEach(function(c){ sel.push(FOUND[c.dataset.i].endpoint); });
  try {
    if (sel.length) {
      var d = atualizarLista(lista.concat(sel), "Antes da descoberta");
      toast(sel.length + " endpoints adicionados." + (d.backup ? " Backup: " + d.backup : ""));
      if (scanBody.endpoints_text) scanBody.endpoints_text += "\n" + sel.join("\n");
    }
    await iniciarVarredura(scanBody);
  } catch (e) { run = null; toast(traduzirErro(e)); }
});
$("pular").addEventListener("click", async function(){
  if (run || !scanBody) return;
  try { await iniciarVarredura(scanBody); } catch (e) { run = null; toast(traduzirErro(e)); }
});


// ---------- 4. Relatório
function montarRel(){
  var semErroConexao = RES.filter(function(r){ return !r.error; });
  var sucessoHttp = semErroConexao.filter(function(r){ return r.status_code >= 200 && r.status_code < 400; });
  var erroHttp = semErroConexao.filter(function(r){ return r.status_code >= 400; });
  var soma = semErroConexao.reduce(function(a, r){ return a + r.response_time; }, 0);

  if (lastScan) {
    $("relSub").textContent = "Varredura de " + lastScan.started + " em " + lastScan.target;
    $("relMethod").textContent = lastScan.method || "GET";
    $("relMethod").classList.remove("hidden");
  } else {
    $("relSub").textContent = "Nenhuma varredura realizada ainda.";
    $("relMethod").classList.add("hidden");
  }

  $("cTotal").textContent = RES.length;
  $("c2xx").textContent = sucessoHttp.length;
  $("c4xx5xx").textContent = erroHttp.length;
  $("cErr").textContent = RES.length - semErroConexao.length;
  $("cAvg").textContent = semErroConexao.length ? (soma / semErroConexao.length).toFixed(2).replace(".", ",") + " s" : "–";
  $("cAuth").textContent = semErroConexao.filter(function(r){ return r.auth_required; }).length;
  $("detalhe").innerHTML = "<h3>Detalhe do Endpoint</h3><p class='hint'>Selecione um endpoint na tabela ao lado para inspecionar os sinais de autenticação e o corpo JSON completo.</p>";

  var f = $("filtro").value;
  var itens = RES.filter(function(r){
    if (f === "ok") return !r.error && r.status_code >= 200 && r.status_code < 400;
    if (f === "auth") return r.auth_required;
    if (f === "http_err") return !r.error && r.status_code >= 400;
    if (f === "erro") return !!r.error;
    if (f === "json") return r.json_data !== null;
    return true;
  });
  $("relTbody").innerHTML = itens.map(function(r){
    var i = RES.indexOf(r);
    return '<tr class="click" data-i="' + i + '" tabindex="0"><td>' + esc(r.endpoint) + "</td><td>" + statusBadge(r.status_code) + "</td><td>" +
      (r.error ? "–" : r.response_time.toFixed(3) + " s") + "</td><td>" +
      (r.error ? "–" : tam(r.content_length) + (r.truncated ? "+" : "")) + "</td><td>" +
      (r.error ? "–" : authTxt(r)) + "</td></tr>";
  }).join("") || '<tr><td colspan="5">Nenhum endpoint corresponde ao filtro selecionado.</td></tr>';

  document.querySelectorAll("#relTbody tr.click").forEach(function(tr){
    var abrir = function(){
      document.querySelectorAll("#relTbody tr").forEach(function(x){ x.classList.remove("sel"); });
      tr.classList.add("sel"); detalhe(RES[tr.dataset.i]);
    };
    tr.addEventListener("click", abrir);
    tr.addEventListener("keydown", function(e){ if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(); } });
  });
}
function tag(nome, on){ return '<span class="tag ' + (on ? "on" : "off") + '">' + nome + "</span>"; }
function detalhe(r){
  var h = "<h3>" + esc(r.endpoint) + "</h3>";
  if (r.error) {
    $("detalhe").innerHTML = h + "<p class='alert-msg'>" + esc(r.error) + "</p><p class='hint'>A varredura continuou normalmente para os demais endpoints.</p>";
    return;
  }
  var s = r.auth_signals;
  h += "<p>Status " + statusBadge(r.status_code) + " · " + r.response_time.toFixed(3) + " s · " + tam(r.content_length) + (r.truncated ? " (truncado em 1 MB)" : "") + "</p>";
  h += "<label>Sinais de autenticação</label><div>" + tag("Status 401/403", s.status_code) + tag("Header WWW-Authenticate", s.www_authenticate) + tag("Palavra-chave no corpo", s.keyword) + "</div>";
  h += "<label>JSON completo</label>" + (r.json_data !== null ? "<pre>" + esc(JSON.stringify(r.json_data, null, 2)) + "</pre>" : "<p class='hint'>Esta resposta não retornou payload JSON.</p>");
  $("detalhe").innerHTML = h;
}
$("filtro").addEventListener("change", montarRel);

// Baixa o relatório .txt preservando o carimbo temporal original da varredura (H4)
async function exportarRelatorio(meta){
  var dados = ler(K.rel + meta.id);
  if (!dados) { toast("Relatório não encontrado neste navegador."); return; }
  try {
    if (!dados.text) {
      var dataOriginal = meta.startedISO || meta.started || fmtLocal(new Date());
      dados.text = await sendTexto("/api/report", {target: meta.target, started: dataOriginal, results: dados.results});
      guardar(K.rel + meta.id, dados);
    }
    baixar("report_" + carimbo(new Date()) + ".txt", dados.text);
  } catch (e) { toast(traduzirErro(e)); }
}
$("exportar").addEventListener("click", function(){
  if (!lastScan) { toast("Execute uma varredura antes de exportar."); return; }
  exportarRelatorio(lastScan);
});


// ---------- 5. Histórico
function montarHistorico(){
  var rels = ler(K.rels) || [];
  $("listaRel").innerHTML = rels.map(function(m, i){
    var metodo = esc(m.method || "GET");
    return '<li><span class="info"><span class="pill pill-sm">' + metodo + "</span> " + esc(m.target) +
      "<small>" + esc(m.started) + " · " + m.total + " endpoints · " + m.auth + " exigem autenticação</small></span>" +
      '<span class="btns"><button class="btn sec" data-ab="' + i + '">Abrir</button><button class="btn sec" data-dl="' + i + '">Baixar .txt</button>' +
      '<button class="btn sec" data-ex="' + i + '" aria-label="Excluir relatório de ' + esc(m.started) + '">Excluir</button></span></li>';
  }).join("") || "<li>Nenhum relatório salvo ainda.</li>";
  document.querySelectorAll("[data-ab]").forEach(function(b){
    b.addEventListener("click", function(){
      var m = rels[b.dataset.ab], d = ler(K.rel + m.id);
      if (!d) { toast("Dados deste relatório não foram encontrados."); return; }
      RES = d.results; lastScan = m; go("relatorio");
    });
  });
  document.querySelectorAll("[data-dl]").forEach(function(b){
    b.addEventListener("click", function(){ exportarRelatorio(rels[b.dataset.dl]); });
  });
  document.querySelectorAll("[data-ex]").forEach(function(b){
    b.addEventListener("click", function(){
      var m = rels[b.dataset.ex];
      apagar(K.rel + m.id);
      guardar(K.rels, rels.filter(function(x){ return x.id !== m.id; }));
      if (lastScan && lastScan.id === m.id) { lastScan = null; RES = []; }
      salvarEstado(); montarHistorico();
      toast("Relatório removido do histórico.");
    });
  });
}
$("limparRel").addEventListener("click", function(){
  var rels = ler(K.rels) || [];
  if (!rels.length) { toast("O histórico já está vazio."); return; }
  confirmarAcao(this, "Confirmar limpeza do histórico?", function(){
    rels.forEach(function(m){ apagar(K.rel + m.id); });
    apagar(K.rels); lastScan = null; RES = [];
    salvarEstado(); montarHistorico();
    toast("Todo o histórico foi apagado.");
  });
});


// ---------- 6. Endpoints e backups
function nomeBackup(){
  var base = "endpoints_backup_" + carimbo(new Date()), nome = base + ".txt", n = 1;
  var usados = backups.map(function(b){ return b.name; });
  while (usados.indexOf(nome) >= 0) nome = base + "_" + (n++) + ".txt";
  return nome;
}

// Grava a nova lista (ordenada, sem repetições) e guarda a anterior como backup com motivo (H2)
function atualizarLista(novos, motivo){
  novos = Array.from(new Set(novos)).sort();
  if (JSON.stringify(novos) === JSON.stringify(lista)) return {mudou: false, backup: null};
  var nome = nomeBackup();
  var bk = [{name: nome, reason: motivo || "Alteração manual", endpoints: lista.slice()}].concat(backups).slice(0, MAX_BACKUPS);
  if (!guardar(K.bk, bk) || !guardar(K.ep, novos)) {
    guardar(K.bk, backups); guardar(K.ep, lista);
    throw new Error("Não foi possível gravar no navegador (armazenamento cheio ou bloqueado).");
  }
  backups = bk; lista = novos;
  montarEndpoints();
  return {mudou: true, backup: nome};
}

function restaurarBackupPorNome(nome){
  var alvo = backups.filter(function(b){ return b.name === nome; })[0];
  if (!alvo) { toast("Backup não encontrado."); return; }
  aplicarLista(alvo.endpoints.slice(), "Alteração desfeita.", "Antes de desfazer alteração", true);
}

function montarEndpoints(){
  $("qtd").textContent = lista.length;
  $("qtdPadrao").textContent = lista.length;
  $("listaEp").innerHTML = lista.map(function(e, i){
    return "<li><span>" + esc(e) + '</span><button class="btn sec" data-rm="' + i + '" aria-label="Remover ' + esc(e) + '">Remover</button></li>';
  }).join("") || "<li>A lista está vazia.</li>";
  $("listaBk").innerHTML = backups.map(function(b, i){
    var detalheBk = b.endpoints.length + " endpoints" + (b.reason ? " · " + esc(b.reason) : "");
    return '<li><span class="info">' + esc(b.name) + "<small>" + detalheBk + "</small></span>" +
      '<button class="btn sec" data-rs="' + i + '">Restaurar</button></li>';
  }).join("") || "<li>Nenhum backup ainda.</li>";
  document.querySelectorAll("[data-rm]").forEach(function(b){
    b.addEventListener("click", function(){
      aplicarLista(lista.filter(function(_, i){ return i != b.dataset.rm; }), "Endpoint removido.", "Antes de remover endpoint");
    });
  });
  document.querySelectorAll("[data-rs]").forEach(function(b){
    b.addEventListener("click", function(){
      aplicarLista(backups[b.dataset.rs].endpoints.slice(), "Backup restaurado.", "Antes de restaurar backup");
    });
  });
}

function aplicarLista(eps, msg, motivo, semUndo){
  try {
    var d = atualizarLista(eps, motivo);
    $("erroEp").textContent = "";
    if (d.backup) {
      var textoToast = (msg || "Lista atualizada.") + " Backup: " + d.backup;
      toast(textoToast, semUndo ? null : function(){ restaurarBackupPorNome(d.backup); });
    } else if (msg) {
      toast("A lista atual já é idêntica a esta.");
    }
    return true;
  } catch (e) { $("erroEp").textContent = e.message; return false; }
}

$("novoEp").addEventListener("input", function(){ $("erroEp").textContent = ""; });
$("novoEp").addEventListener("keydown", function(e){
  if (e.key === "Enter") { e.preventDefault(); $("addEp").click(); }
});

$("addEp").addEventListener("click", function(){
  var v = $("novoEp").value.trim();
  if (v.charAt(0) !== "/") { $("erroEp").textContent = "O endpoint deve começar com “/”. Exemplo: /api/users"; return; }
  if (!/^\/\S{0,199}$/.test(v)) { $("erroEp").textContent = "Endpoint inválido: sem espaços e com até 200 caracteres."; return; }
  if (lista.indexOf(v) >= 0) { $("erroEp").textContent = "Este endpoint já está na lista."; return; }
  if (aplicarLista(lista.concat(v), "Endpoint adicionado.", "Antes de adicionar endpoint")) $("novoEp").value = "";
});

$("btnUp").addEventListener("click", function(){ $("fileEp").click(); });
$("fileEp").addEventListener("change", async function(){
  $("erroEp").textContent = "";
  try {
    var d = await send("/api/parse", {kind: "endpoints", text: await readTxt(this)});
    aplicarLista(d.items, "Lista substituída pelo arquivo.", "Antes de importar .txt");
  } catch (e) { $("erroEp").textContent = traduzirErro(e); }
  this.value = "";
});
$("btnDown").addEventListener("click", function(){
  if (!lista.length) { toast("A lista está vazia."); return; }
  baixar("endpoints.txt", "# NX-TRACE Endpoints File\n\n" + lista.join("\n") + "\n");
});
$("btnPadrao").addEventListener("click", function(){
  confirmarAcao(this, "Confirmar restauração?", async function(){
    try { aplicarLista((await carregarPadrao()).endpoints.slice(), "Lista padrão restaurada.", "Antes de restaurar lista padrão"); }
    catch (e) { $("erroEp").textContent = traduzirErro(e); }
  });
});


// ---------- Restaurar o estado ao abrir ou recarregar a página
async function restaurar(){
  restaurarForm();
  atualizarControlesForm();

  var s = ler(K.state) || {};
  scanBody = s.scanBody || null; FOUND = Array.isArray(s.found) ? s.found : [];

  var l = ler(K.ep), b = ler(K.bk);
  backups = Array.isArray(b) ? b : [];
  if (Array.isArray(l)) {
    lista = l;
    carregarPadrao().catch(function(){});
  } else {
    try { lista = (await carregarPadrao()).endpoints.slice(); guardar(K.ep, lista); }
    catch (e) { lista = []; toast("Não foi possível carregar a lista padrão: " + traduzirErro(e)); }
  }
  montarEndpoints();

  var m = (ler(K.rels) || []).filter(function(x){ return x.id === s.lastId; })[0];
  var d = m && ler(K.rel + m.id);
  if (d) { RES = d.results; lastScan = m; }

  var t = s.tela || "nova";
  if (t === "exec") t = lastScan ? "relatorio" : "nova";
  if (t === "relatorio" && !lastScan) t = "nova";
  if (t === "revisao") { if (scanBody) montarRevisao(); else t = "nova"; }
  go(t);
}
restaurar();