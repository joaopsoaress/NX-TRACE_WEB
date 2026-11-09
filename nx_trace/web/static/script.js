// ---------- Estado
var lista = [], backups = [], RES = [], FOUND = [];
var job = null, kind = null, scanBody = null, lastScan = null;


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
  if (id === "relatorio") montarRel();
  if (id === "endpoints") carregarEndpoints();
}
function toast(msg){
  var t = $("toast"); t.textContent = msg; t.style.display = "block";
  clearTimeout(t._h); t._h = setTimeout(function(){ t.style.display = "none"; }, 4000);
}
function tam(b){ return b > 1024 ? (b/1024).toFixed(1)+" KB" : b+" B"; }
function authTxt(r){ return r.auth_required ? "Sim" : "Não"; }
function log(t){ var l = $("log"); l.innerHTML += esc(t)+"<br>"; l.scrollTop = l.scrollHeight; }

async function api(url, opt){
  var r = await fetch(url, opt);
  var d = await r.json().catch(function(){ return {}; });
  if (!r.ok) throw new Error(d.error || ("Erro " + r.status));
  return d;
}
function send(url, body, method){
  return api(url, {method: method || "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body || {})});
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


// ---------- Navegação
document.querySelectorAll("nav button").forEach(function(b){
  b.addEventListener("click", function(){ go(b.dataset.go); });
});


// ---------- 1. Nova varredura
$("escopo").addEventListener("change", function(){ $("iniciar").disabled = !this.checked; });
$("iniciar").addEventListener("click", async function(){
  $("erroNova").textContent = "";
  try {
    var body = {target: $("url").value, method: $("met").value, headers: $("hdr").value, scope_confirmed: $("escopo").checked};
    if ($("origUp").checked) body.endpoints_text = await readTxt($("fileOrig"));
    scanBody = body;
    if ($("disc").checked) {
      var d = {target: body.target, headers: body.headers, scope_confirmed: true};
      if ($("wlUp").checked) d.wordlist_text = await readTxt($("fileWl"));
      await iniciar("/api/discover", d, "discover");
    } else {
      await iniciar("/api/scans", body, "scan");
    }
  } catch (e) { $("erroNova").textContent = e.message; }
});


// ---------- 2. Revisão
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
  var sel = [];
  document.querySelectorAll("#descTbody input:checked").forEach(function(c){ sel.push(FOUND[c.dataset.i].endpoint); });
  try {
    if (sel.length) {
      var d = await send("/api/endpoints", {endpoints: lista.concat(sel)}, "PUT");
      lista = d.endpoints; backups = d.backups;
      toast(sel.length + " endpoints adicionados." + (d.backup ? " Backup criado: " + d.backup : ""));
      if (scanBody.endpoints_text) scanBody.endpoints_text += "\n" + sel.join("\n");
    }
    await iniciar("/api/scans", scanBody, "scan");
  } catch (e) { toast(e.message); }
});
$("pular").addEventListener("click", async function(){
  try { await iniciar("/api/scans", scanBody, "scan"); } catch (e) { toast(e.message); }
});


// ---------- 3. Execução
async function iniciar(url, body, k){
  var d = await send(url, body);
  job = {id: d.id, next: 0}; kind = k; RES = []; FOUND = [];
  $("execTbody").innerHTML = ""; $("log").innerHTML = "";
  $("prog").style.width = "0"; $("progTxt").textContent = "Iniciando...";
  $("verRel").disabled = true; $("cancelar").disabled = false;
  $("execSub").textContent = (k === "discover" ? "Descobrindo endpoints em " : "Varredura em andamento em ") + body.target;
  go("exec");
  tick(job.id);
}
async function tick(id){
  if (!job || job.id !== id) return;
  var d;
  try { d = await api("/api/jobs/" + id + "?since=" + job.next); }
  catch (e) { log("[erro] " + e.message); $("execSub").textContent = "Conexão com o servidor perdida."; return; }
  job.next = d.next;
  d.events.forEach(tratar);
  $("prog").style.width = (d.total ? d.done / d.total * 100 : 0) + "%";
  $("progTxt").textContent = d.done + " de " + d.total + (d.kind === "discover" ? " palavras" : " endpoints");
  if (d.status === "running") { setTimeout(function(){ tick(id); }, 500); return; }
  terminar(d);
}
function tratar(ev){
  if (ev.type === "log") { log("[" + ev.level + "] " + ev.msg); return; }
  var tr = document.createElement("tr");
  if (ev.type === "found") {
    FOUND.push(ev.item);
    tr.innerHTML = "<td>" + esc(ev.item.endpoint) + "</td><td>" + ev.item.status_code + "</td><td>–</td><td>–</td><td>–</td>";
  } else {
    var r = ev.result; RES.push(r);
    tr.innerHTML = r.error
      ? "<td>" + esc(r.endpoint) + "</td><td colspan='4'>Erro: " + esc(r.error) + "</td>"
      : "<td>" + esc(r.endpoint) + "</td><td>" + r.status_code + "</td><td>" + r.response_time.toFixed(3) + " s</td><td>" + tam(r.content_length) + "</td><td>" + authTxt(r) + "</td>";
  }
  $("execTbody").appendChild(tr);
}
function terminar(d){
  $("cancelar").disabled = true;
  if (d.status === "error") { $("execSub").textContent = "Falha: " + d.error; return; }
  var cancelado = d.status === "cancelled";
  if (d.kind === "discover") {
    if (cancelado) { $("execSub").textContent = "Descoberta cancelada."; return; }
    montarRevisao(); go("revisao"); return;
  }
  $("execSub").textContent = cancelado ? "Varredura cancelada. Os resultados parciais foram mantidos." : "Varredura concluída.";
  $("verRel").disabled = false;
  lastScan = {id: d.id, target: d.target, started: d.started};
}
$("cancelar").addEventListener("click", function(){
  if (job) send("/api/jobs/" + job.id + "/cancel").catch(function(e){ toast(e.message); });
  $("cancelar").disabled = true;
});
$("verRel").addEventListener("click", function(){ go("relatorio"); });


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
  h += "<p>Status " + r.status_code + " · " + r.response_time.toFixed(3) + " s · " + tam(r.content_length) + "</p>";
  h += "<label>Sinais de autenticação</label><div>" + tag("Status 401/403", s.status_code) + tag("Header WWW-Authenticate", s.www_authenticate) + tag("Palavra-chave no corpo", s.keyword) + "</div>";
  h += "<label>JSON completo</label>" + (r.json_data !== null ? "<pre>" + esc(JSON.stringify(r.json_data, null, 2)) + "</pre>" : "<p class='hint'>Esta resposta não retornou JSON.</p>");
  $("detalhe").innerHTML = h;
}
$("filtro").addEventListener("change", montarRel);
$("exportar").addEventListener("click", function(){
  if (!lastScan) { toast("Execute uma varredura antes de exportar."); return; }
  window.location.href = "/api/jobs/" + lastScan.id + "/report";
});


// ---------- 5. Endpoints e backups
async function carregarEndpoints(){
  try { aplicarEstado(await api("/api/endpoints")); } catch (e) { toast(e.message); }
}
function aplicarEstado(d){
  lista = d.endpoints; backups = d.backups;
  montarEndpoints();
}
function montarEndpoints(){
  $("qtd").textContent = lista.length;
  $("qtdPadrao").textContent = lista.length;
  $("listaEp").innerHTML = lista.map(function(e, i){
    return "<li><span>" + esc(e) + '</span><button class="btn sec" data-rm="' + i + '" aria-label="Remover ' + esc(e) + '">Remover</button></li>';
  }).join("");
  $("listaBk").innerHTML = backups.map(function(b, i){
    return "<li><span>" + esc(b) + '</span><button class="btn sec" data-rs="' + i + '">Restaurar</button></li>';
  }).join("") || "<li>Nenhum backup ainda.</li>";
  document.querySelectorAll("[data-rm]").forEach(function(b){
    b.addEventListener("click", function(){ salvar(lista.filter(function(_, i){ return i != b.dataset.rm; })); });
  });
  document.querySelectorAll("[data-rs]").forEach(function(b){
    b.addEventListener("click", async function(){
      try {
        var d = await send("/api/endpoints/restore", {name: backups[b.dataset.rs]});
        aplicarEstado(d); toast("Lista restaurada." + (d.backup ? " Backup da lista anterior: " + d.backup : ""));
      } catch (e) { toast(e.message); }
    });
  });
}
async function salvar(eps, extra){
  try {
    var d = await send("/api/endpoints", extra || {endpoints: eps}, "PUT");
    aplicarEstado(d);
    if (d.backup) toast("Backup criado: " + d.backup);
    return true;
  } catch (e) { $("erroEp").textContent = e.message; return false; }
}
$("addEp").addEventListener("click", async function(){
  var v = $("novoEp").value.trim();
  if (v.charAt(0) !== "/") { $("erroEp").textContent = "O endpoint deve começar com “/”. Exemplo: /api/users"; return; }
  if (lista.indexOf(v) >= 0) { $("erroEp").textContent = "Este endpoint já está na lista."; return; }
  $("erroEp").textContent = "";
  if (await salvar(lista.concat(v))) $("novoEp").value = "";
});
$("btnUp").addEventListener("click", function(){ $("fileEp").click(); });
$("fileEp").addEventListener("change", async function(){
  $("erroEp").textContent = "";
  try { await salvar(null, {endpoints_text: await readTxt(this)}); }
  catch (e) { $("erroEp").textContent = e.message; }
  this.value = "";
});

carregarEndpoints();
