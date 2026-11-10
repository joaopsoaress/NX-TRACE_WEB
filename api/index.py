"""NX-TRACE web: API Flask sem estado para a Vercel (runtime Python / WSGI).

A Vercel executa cada requisição em uma função isolada, sem threads de fundo nem disco
gravável. Por isso o navegador conduz a varredura (um endpoint por chamada) e guarda
lista de endpoints, backups e relatórios no localStorage. Esta API só executa a lógica
de nx_trace/core.py.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from flask import Flask, Response, jsonify, request  # noqa: E402
from werkzeug.exceptions import HTTPException  # noqa: E402

from nx_trace import core  # noqa: E402

core.install_ssrf_guard()  # alvos externos sim; rede local/privada não

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 4 * 1024 * 1024  # limite de payload da Vercel: 4,5 MB
PROBE_TIMEOUT = 8
HEADER_NAME = re.compile(r"^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$")


# ---------- Helpers ----------
def body():
    return request.get_json(silent=True) or {}


def common(d):
    """Valida o que toda operação exige: escopo confirmado, alvo público, método e headers."""
    if not d.get("scope_confirmed"):
        raise ValueError("Confirme que você tem autorização para analisar este alvo.")
    target = core.normalize_target(d.get("target"))
    core.assert_public_target(target)
    method = str(d.get("method") or "GET").upper()
    if method not in core.METHODS:
        raise ValueError("Método não suportado.")
    raw = d.get("headers") or ""
    if not isinstance(raw, str) or len(raw.encode("utf-8")) > 8192:
        raise ValueError("Headers inválidos ou grandes demais.")
    headers = core.parse_headers(raw)
    if len(headers) > core.MAX_HEADERS or not all(HEADER_NAME.match(k) for k in headers):
        raise ValueError("Headers inválidos (nome com caracteres não permitidos ou excesso de headers).")
    return target, method, headers or dict(core.DEFAULT_HEADERS)


def single(items, msg):
    if len(items) != 1:
        raise ValueError(msg)
    return items[0]


def clean_result(r):
    """Aceita só o formato produzido por profile_endpoint (o navegador reenvia os resultados)."""
    if not isinstance(r, dict) or not isinstance(r.get("endpoint"), str):
        raise ValueError("Resultado inválido.")
    sig = r.get("auth_signals") if isinstance(r.get("auth_signals"), dict) else {}
    err = r.get("error")
    return {
        "endpoint": r["endpoint"][:300],
        "status_code": r.get("status_code") if isinstance(r.get("status_code"), int) else None,
        "response_time": r.get("response_time") if isinstance(r.get("response_time"), (int, float)) else None,
        "content_length": r.get("content_length") if isinstance(r.get("content_length"), int) else None,
        "truncated": bool(r.get("truncated")),
        "auth_signals": {k: bool(sig.get(k)) for k in ("status_code", "www_authenticate", "keyword")},
        "auth_required": bool(r.get("auth_required")),
        "json_data": r.get("json_data"),
        "error": str(err)[:300] if err else None,
    }


@app.after_request
def no_store(resp):
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.errorhandler(ValueError)
def on_value_error(e):
    return jsonify(error=str(e)), 400


@app.errorhandler(ConnectionError)
def on_connection_error(e):
    return jsonify(error=str(e)), 502


@app.errorhandler(HTTPException)
def on_http_error(e):
    msg = {404: "Rota não encontrada.", 405: "Método não permitido.",
           413: "Corpo da requisição grande demais."}.get(e.code, e.description)
    return jsonify(error=msg), e.code


@app.errorhandler(Exception)
def on_error(e):
    app.logger.exception("Erro inesperado")
    return jsonify(error="Erro interno."), 500


# ---------- Rotas ----------
@app.get("/api/defaults")
def defaults():
    """Lista de endpoints e wordlist iniciais (o navegador copia para o localStorage)."""
    with open(os.path.join(ROOT, "nx_trace", "endpoints.txt"), encoding="utf-8") as f:
        endpoints = sorted(core.parse_endpoints(f.read(), strict=False))
    return jsonify(endpoints=endpoints, wordlist=core.DEFAULT_WORDLIST,
                   max_upload=core.MAX_UPLOAD, max_backups=core.MAX_BACKUPS)


@app.post("/api/parse")
def parse():
    """Valida o texto de um .txt enviado (endpoints ou wordlist)."""
    d = body()
    text = d.get("text")
    if not isinstance(text, str) or len(text.encode("utf-8")) > core.MAX_UPLOAD:
        raise ValueError("O arquivo excede 100 KB.")
    if d.get("kind") == "words":
        return jsonify(items=core.parse_words(text))
    return jsonify(items=core.parse_endpoints(text))


@app.post("/api/check")
def check():
    """Pré-validação (escopo, URL, alvo público, método, headers) antes de começar uma operação."""
    common(body())
    return jsonify(ok=True)


@app.post("/api/probe")
def probe():
    """Perfila UM endpoint. O navegador chama em sequência para varrer a lista."""
    d = body()
    target, method, headers = common(d)
    ep = single(core.parse_endpoints(str(d.get("endpoint") or "")), "Endpoint inválido.")
    return jsonify(core.profile_endpoint(target, ep, headers, method, timeout=PROBE_TIMEOUT))


@app.post("/api/discover")
def discover():
    """Testa as variações de UMA palavra da wordlist."""
    d = body()
    target, _, headers = common(d)
    word = single(core.parse_words(str(d.get("word") or "")), "Palavra inválida.")
    return jsonify(found=core.discover_word(target, word, headers))


@app.post("/api/report")
def report():
    """Monta o relatório .txt a partir dos resultados (sem guardar nada no servidor)."""
    d = body()
    results = d.get("results")
    if not isinstance(results, list) or len(results) > 2000:
        raise ValueError("Resultados inválidos.")
    target = core.normalize_target(d.get("target"))
    text = core.build_report(target, core.parse_started(d.get("started")),
                             [clean_result(r) for r in results])
    return Response(text, mimetype="text/plain; charset=utf-8")
