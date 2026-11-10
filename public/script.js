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
  window.scrollTo(0,0);
  tela = id; salvarEstado();
  if (id === "relatorio") montarRel();
  if (id === "endpoints") montarEndpoints();
  if (id === "historico") montarHistorico();
}
function toast(msg){
  var t = $("toast"); t.textContent = msg; t.style.display = "block";
  clearTimeout(t._h); t._h = setTimeout(function(){ t.style.display = "none"; }, 4000);
}
function tam(b){ return b > 1024 ? (b/1024).toFixed(1)+" KB" : b+" B"; }
function authTxt(r){ return r.auth_required ? "Sim" : "Não"; }
function log(t){ var l = $("log"); l.innerHTML += esc(t)+"<br>"; l.scrollTop = l.scrollHeight; }
function p2(n){ return (n < 10 ? "0" : "") + n; }
function fmtBR(d){ return p2(d.getDate())+"/"+p2(d.getMonth()+1)+"/"+d.getFullYear()+" "+p2(d.getHours())+":"+p2(d.getMinutes()); }
function fmtLocal(d){ return d.getFullYear()+"-"+p2(d.getMonth()+1)+"-"+p2(d.getDate())+" "+p2(d.getHours())+":"+p2(d.getMinutes())+":"+p2(d.getSeconds()); }
function carimbo(d){ return d.getFullYear()+p2(d.getMonth()+1)+p2(d.getDate())+"_"+p2(d.getHours())+p2(d.getMinutes())+p2(d.getSeconds()); }

function baixar(nome, texto){
  var url = URL.createObjectURL(new Blob([texto], {type: "text/plain;charset=utf-8"}));
  var a = document.createElement("a");
  a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
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
  $("url").value = f.url || ""; $("met").value = f.met || "GET"; $("hdr").value = f.hdr || ""; $("disc").checked = !!f.disc;
}
["url", "met", "hdr", "disc"].forEach(function(id){
  $(id).addEventListener("input", salvarForm);
  $(id).addEventListener("change", salvarForm);
});


// ---------- Comunicação com a API
async function api(url, opt){
  var r = await fetch(url, opt);
  var d = await r.json().catch(function(){ return {}; });
  if (!r.ok) {
    var e = new Error(d.error || ("Erro " + r.status));
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
    throw new Error(d.error || ("Erro " + r.status));
  }
  return r.text();
}
function readTxt(input){
  return new Promise(function(ok, fail){
    var f = input.files[0];
    if (!f) return fail(new Error("Selecione um arquivo .txt."));
    if (!/\.txt$/i.test(f.name)) return fail(new Error("Apenas arquivos .txt são aceitos."));
    if (f.size > 102400) return fail(new Error("O arquivo excede 100 KB."));
    var r = new FileReader();
    r.onload = function(){ ok(r.result); };
    r.onerror = function(){ fail(new Error("Falha ao ler o arquivo.")); };
    r.readAsText(f);
  });
}
async function carregarPadrao(){
  if (!padrao) {
    padrao = await api("/api/defaults");
    $("qtdWl").textContent = padrao.wordlist.length;
  }
  return padrao;
}
function baseBody(b){
  return {target: b.target, method: b.method, headers: b.headers, scope_confirmed: b.scope_confirmed};
}


// ---------- Navegação
document.querySelectorAll("nav button").forEach(function(b){
  b.addEventListener("click", function(){ go(b.dataset.go); });
});


// ---------- 1. Nova varredura
$("escopo").addEventListener("change", function(){ $("iniciar").disabled = !this.checked; });
$("iniciar").addEventListener("click", async function(){
  $("erroNova").textContent = "";
  if (run) { $("erroNova").textContent = "Já existe uma operação em andamento."; return; }
  try {
    var body = {target: $("url").value, method: $("met").value, headers: $("hdr").value, scope_confirmed: $("escopo").checked};
    if ($("origUp").checked) body.endpoints_text = await readTxt($("fileOrig"));
    scanBody = body;
    if ($("disc").checked) {
      var wl = $("wlUp").checked ? await readTxt($("fileWl")) : null;
      await iniciarDescoberta(body, wl);
    } else {
      await iniciarVarredura(body);
    }
  } catch (e) { run = null; $("erroNova").textContent = e.message; }
});


// ---------- Execução (comum)
function prepararExec(k, target){
  RES = []; FOUND = [];
  $("execTbody").innerHTML = ""; $("log").innerHTML = "";
  $("prog").style.width = "0"; $("progTxt").textContent = "Iniciando...";
  $("verRel").disabled = true; $("cancelar").disabled = false;
  $("execSub").textContent = (k === "discover" ? "Descobrindo endpoints em " : "Varredura em andamento em ") + target;
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
// 4xx = a API recusou a operação (alvo bloqueado, escopo, rate limit...) e não adianta continuar
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
  if (!eps.length) throw new Error("A lista de endpoints está vazia.");
  await send("/api/check", baseBody(body));   // erros de URL/escopo/alvo aparece na tela anterior

  var meu = prepararExec("scan", body.target), inicio = new Date(), estado = "done", erro = null;
  log("[info] Iniciando varredura de " + eps.length + " endpoints");
  for (var i = 0; i < eps.length; i++) {
    if (meu.cancel) { estado = "cancelled"; break; }
    progresso(i, eps.length, "endpoints");
    var r;
    try {
      r = await send("/api/probe", {target: body.target, endpoint: eps[i], method: body.method,
                                    headers: body.headers, scope_confirmed: true}, meu.ctrl);
    } catch (e) {
      if (meu.cancel) { estado = "cancelled"; break; }
      if (fatal(e)) { estado = "error"; erro = e.message; break; }
      r = resultadoErro(eps[i], "Falha ao consultar o servidor: " + e.message);
    }
    RES.push(r);
    if (r.error) {
      linha("<td>" + esc(r.endpoint) + "</td><td colspan='4'>Erro: " + esc(r.error) + "</td>");
      log("[erro] " + r.endpoint + ": " + r.error);
    } else {
      linha("<td>" + esc(r.endpoint) + "</td><td>" + r.status_code + "</td><td>" + r.response_time.toFixed(3) + " s</td><td>" +
            tam(r.content_length) + (r.truncated ? "+" : "") + "</td><td>" + authTxt(r) + "</td>");
      log("[ok] " + r.endpoint + " → " + r.status_code + " em " + r.response_time.toFixed(3) + " s");
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
  var texto = null;
  try { texto = await sendTexto("/api/report", {target: body.target, started: fmtLocal(inicio), results: RES}); }
  catch (e) { toast("Relatório .txt não gerado agora: " + e.message + ". Você pode tentar baixar depois."); }
  var ok = RES.filter(function(r){ return !r.error; });
  var meta = {id: Date.now().toString(36), target: body.target, method: body.method, started: fmtBR(inicio),
              total: RES.length, ok: ok.length, auth: ok.filter(function(r){ return r.auth_required; }).length};
  lastScan = meta;
  if (!gravarRelatorio(meta, {results: RES, text: texto})) toast("Sem espaço no navegador para guardar este relatório no histórico.");
}
function gravarRelatorio(meta, dados){
  var rels = ler(K.rels) || [];
  while (!guardar(K.rel + meta.id, dados)) {     // sem espaço: descarta o mais antigo e tenta de novo
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

  var meu = prepararExec("discover", body.target), known = new Set(lista), seen = new Set(), idx = 0, feitas = 0, erro = null;
  log("[info] Testando " + words.length + " palavras (6 variações cada)");

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
          linha("<td>" + esc(it.endpoint) + "</td><td>" + it.status_code + "</td><td>–</td><td>–</td><td>–</td>");
          log("[ok] Encontrado: " + it.endpoint + " [" + it.status_code + "]");
        });
      } catch (e) {
        if (!meu.cancel && !erro) { erro = e.message; meu.ctrl.abort(); }
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
    : "Nenhum endpoint encontrado.";
  $("descTbody").innerHTML = FOUND.map(function(f, i){
    return "<tr><td>" + (f.is_new ? '<input type="checkbox" checked data-i="' + i + '" aria-label="Adicionar ' + esc(f.endpoint) + '">' : "") + "</td>" +
      "<td>" + esc(f.endpoint) + "</td><td>" + f.status_code + "</td><td>" + esc(f.content_type) + "</td><td>" + (f.is_new ? "Novo" : "Já está na lista") + "</td></tr>";
  }).join("");
}
$("aplicar").addEventListener("click", async function(){
  if (run || !scanBody) return;
  var sel = [];
  document.querySelectorAll("#descTbody input:checked").forEach(function(c){ sel.push(FOUND[c.dataset.i].endpoint); });
  try {
    if (sel.length) {
      var d = atualizarLista(lista.concat(sel));
      toast(sel.length + " endpoints adicionados." + (d.backup ? " Backup criado: " + d.backup : ""));
      if (scanBody.endpoints_text) scanBody.endpoints_text += "\n" + sel.join("\n");
    }
    await iniciarVarredura(scanBody);
  } catch (e) { run = null; toast(e.message); }
});
$("pular").addEventListener("click", async function(){
  if (run || !scanBody) return;
  try { await iniciarVarredura(scanBody); } catch (e) { run = null; toast(e.message); }
});


// ---------- 4. Relatório
function montarRel(){
  var ok = RES.filter(function(r){ return !r.error; });
  var soma = ok.reduce(function(a, r){ return a + r.response_time; }, 0);
  $("relSub").textContent = lastScan ? "Varredura de " + lastScan.started + " em " + lastScan.target : "Nenhuma varredura realizada ainda.";
  $("cTotal").textContent = RES.length;
  $("cOk").textContent = ok.length;
  $("cErr").textContent = RES.length - ok.length;
  $("cAvg").textContent = ok.length ? (soma / ok.length).toFixed(2).replace(".", ",") + " s" : "–";
  $("cAuth").textContent = ok.filter(function(r){ return r.auth_required; }).length;
  $("detalhe").innerHTML = "<h3>Detalhe</h3><p class='hint'>Selecione um endpoint na tabela para ver os sinais de autenticação e o JSON completo.</p>";

  var f = $("filtro").value;
  var itens = RES.filter(function(r){
    if (f === "auth") return r.auth_required;
    if (f === "erro") return !!r.error;
    if (f === "json") return r.json_data !== null;
    return true;
  });
  $("relTbody").innerHTML = itens.map(function(r){
    var i = RES.indexOf(r);
    return '<tr class="click" data-i="' + i + '" tabindex="0"><td>' + esc(r.endpoint) + "</td><td>" + (r.error ? "Erro" : r.status_code) + "</td><td>" +
      (r.error ? "–" : r.response_time.toFixed(3) + " s") + "</td><td>" + (r.error ? "–" : authTxt(r)) + "</td></tr>";
  }).join("") || '<tr><td colspan="4">Nenhum endpoint para exibir.</td></tr>';
  document.querySelectorAll("#relTbody tr.click").forEach(function(tr){
    var abrir = function(){
      document.querySelectorAll("#relTbody tr").forEach(function(x){ x.classList.remove("sel"); });
      tr.classList.add("sel"); detalhe(RES[tr.dataset.i]);
    };
    tr.addEventListener("click", abrir);
    tr.addEventListener("keydown", function(e){ if (e.key === "Enter") abrir(); });
  });
}
function tag(nome, on){ return '<span class="tag ' + (on ? "on" : "off") + '">' + nome + "</span>"; }
function detalhe(r){
  var h = "<h3>" + esc(r.endpoint) + "</h3>";
  if (r.error) { $("detalhe").innerHTML = h + "<p>Erro: " + esc(r.error) + "</p><p class='hint'>A varredura continuou para o próximo endpoint.</p>"; return; }
  var s = r.auth_signals;
  h += "<p>Status " + r.status_code + " · " + r.response_time.toFixed(3) + " s · " + tam(r.content_length) + (r.truncated ? " (truncado em 1 MB)" : "") + "</p>";
  h += "<label>Sinais de autenticação</label><div>" + tag("Status 401/403", s.status_code) + tag("Header WWW-Authenticate", s.www_authenticate) + tag("Palavra-chave no corpo", s.keyword) + "</div>";
  h += "<label>JSON completo</label>" + (r.json_data !== null ? "<pre>" + esc(JSON.stringify(r.json_data, null, 2)) + "</pre>" : "<p class='hint'>Esta resposta não retornou JSON.</p>");
  $("detalhe").innerHTML = h;
}
$("filtro").addEventListener("change", montarRel);

// Baixa o relatório .txt; se o texto não foi gerado na hora da varredura, gera agora.
async function exportarRelatorio(meta){
  var dados = ler(K.rel + meta.id);
  if (!dados) { toast("Relatório não encontrado neste navegador."); return; }
  try {
    if (!dados.text) {
      dados.text = await sendTexto("/api/report", {target: meta.target, started: fmtLocal(new Date()), results: dados.results});
      guardar(K.rel + meta.id, dados);
    }
    baixar("report_" + carimbo(new Date()) + ".txt", dados.text);
  } catch (e) { toast(e.message); }
}
$("exportar").addEventListener("click", function(){
  if (!lastScan) { toast("Execute uma varredura antes de exportar."); return; }
  exportarRelatorio(lastScan);
});


// ---------- 5. Histórico
function montarHistorico(){
  var rels = ler(K.rels) || [];
  $("listaRel").innerHTML = rels.map(function(m, i){
    return '<li><span class="info">' + esc(m.target) + "<small>" + esc(m.started) + " · " + m.total + " endpoints · " + m.auth + " exigem autenticação</small></span>" +
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
    });
  });
}
$("limparRel").addEventListener("click", function(){
  var rels = ler(K.rels) || [];
  if (!rels.length || !confirm("Apagar todos os relatórios salvos neste navegador?")) return;
  rels.forEach(function(m){ apagar(K.rel + m.id); });
  apagar(K.rels); lastScan = null; RES = [];
  salvarEstado(); montarHistorico();
});


// ---------- 6. Endpoints e backups
function nomeBackup(){
  var base = "endpoints_backup_" + carimbo(new Date()), nome = base + ".txt", n = 1;
  var usados = backups.map(function(b){ return b.name; });
  while (usados.indexOf(nome) >= 0) nome = base + "_" + (n++) + ".txt";
  return nome;
}
// Grava a nova lista (ordenada, sem repetições) e guarda a anterior como backup.
function atualizarLista(novos){
  novos = Array.from(new Set(novos)).sort();
  if (JSON.stringify(novos) === JSON.stringify(lista)) return {mudou: false, backup: null};
  var nome = nomeBackup();
  var bk = [{name: nome, endpoints: lista.slice()}].concat(backups).slice(0, MAX_BACKUPS);
  if (!guardar(K.bk, bk) || !guardar(K.ep, novos)) {
    guardar(K.bk, backups); guardar(K.ep, lista);
    throw new Error("Não foi possível gravar no navegador (armazenamento cheio ou bloqueado).");
  }
  backups = bk; lista = novos;
  montarEndpoints();
  return {mudou: true, backup: nome};
}
function montarEndpoints(){
  $("qtd").textContent = lista.length;
  $("qtdPadrao").textContent = lista.length;
  $("listaEp").innerHTML = lista.map(function(e, i){
    return "<li><span>" + esc(e) + '</span><button class="btn sec" data-rm="' + i + '" aria-label="Remover ' + esc(e) + '">Remover</button></li>';
  }).join("") || "<li>A lista está vazia.</li>";
  $("listaBk").innerHTML = backups.map(function(b, i){
    return "<li><span>" + esc(b.name) + " <small>(" + b.endpoints.length + ")</small></span>" +
      '<button class="btn sec" data-rs="' + i + '">Restaurar</button></li>';
  }).join("") || "<li>Nenhum backup ainda.</li>";
  document.querySelectorAll("[data-rm]").forEach(function(b){
    b.addEventListener("click", function(){ aplicarLista(lista.filter(function(_, i){ return i != b.dataset.rm; })); });
  });
  document.querySelectorAll("[data-rs]").forEach(function(b){
    b.addEventListener("click", function(){
      aplicarLista(backups[b.dataset.rs].endpoints.slice(), "Lista restaurada.");
    });
  });
}
function aplicarLista(eps, msg){
  try {
    var d = atualizarLista(eps);
    $("erroEp").textContent = "";
    if (d.backup) toast((msg || "Lista atualizada.") + " Backup da lista anterior: " + d.backup);
    else if (msg) toast("A lista já é igual a esta.");
    return true;
  } catch (e) { $("erroEp").textContent = e.message; return false; }
}
$("addEp").addEventListener("click", function(){
  var v = $("novoEp").value.trim();
  if (v.charAt(0) !== "/") { $("erroEp").textContent = "O endpoint deve começar com “/”. Exemplo: /api/users"; return; }
  if (!/^\/\S{0,199}$/.test(v)) { $("erroEp").textContent = "Endpoint inválido: sem espaços e com até 200 caracteres."; return; }
  if (lista.indexOf(v) >= 0) { $("erroEp").textContent = "Este endpoint já está na lista."; return; }
  if (aplicarLista(lista.concat(v))) $("novoEp").value = "";
});
$("btnUp").addEventListener("click", function(){ $("fileEp").click(); });
$("fileEp").addEventListener("change", async function(){
  $("erroEp").textContent = "";
  try {
    var d = await send("/api/parse", {kind: "endpoints", text: await readTxt(this)});
    aplicarLista(d.items, "Lista substituída pelo arquivo.");
  } catch (e) { $("erroEp").textContent = e.message; }
  this.value = "";
});
$("btnDown").addEventListener("click", function(){
  if (!lista.length) { toast("A lista está vazia."); return; }
  baixar("endpoints.txt", "# NX-TRACE Endpoints File\n\n" + lista.join("\n") + "\n");
});
$("btnPadrao").addEventListener("click", async function(){
  try { aplicarLista((await carregarPadrao()).endpoints.slice(), "Lista padrão restaurada."); }
  catch (e) { $("erroEp").textContent = e.message; }
});


// ---------- Restaurar o estado ao abrir ou recarregar a página
async function restaurar(){
  restaurarForm();
  var s = ler(K.state) || {};
  scanBody = s.scanBody || null; FOUND = Array.isArray(s.found) ? s.found : [];

  var l = ler(K.ep), b = ler(K.bk);
  backups = Array.isArray(b) ? b : [];
  if (Array.isArray(l)) {
    lista = l;
    carregarPadrao().catch(function(){});   // só para mostrar o tamanho da wordlist
  } else {
    try { lista = (await carregarPadrao()).endpoints.slice(); guardar(K.ep, lista); }
    catch (e) { lista = []; toast("Não foi possível carregar a lista padrão: " + e.message); }
  }
  montarEndpoints();

  var m = (ler(K.rels) || []).filter(function(x){ return x.id === s.lastId; })[0];
  var d = m && ler(K.rel + m.id);
  if (d) { RES = d.results; lastScan = m; }

  var t = s.tela || "nova";
  if (t === "exec") t = lastScan ? "relatorio" : "nova"; // uma varredura em andamento não continua se carregar a página!!
  if (t === "relatorio" && !lastScan) t = "nova";
  if (t === "revisao") { if (scanBody) montarRevisao(); else t = "nova"; }
  go(t);
}
restaurar();
