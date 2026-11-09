"""NX-TRACE web: backend Flask local."""
import os
import sys
import threading
import uuid
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)

from flask import Flask, Response, jsonify, request, send_from_directory  # noqa: E402
from nx_trace import core  # noqa: E402

DATA_DIR = os.environ.get("NX_TRACE_DATA", os.path.join(ROOT, "data"))
store = core.EndpointStore(DATA_DIR, seed=os.path.join(ROOT, "nx_trace", "endpoints.txt"))
STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
app = Flask(__name__, static_folder=STATIC, static_url_path="")


class Job:
    def __init__(self, kind, target):
        self.id = uuid.uuid4().hex[:8]
        self.kind, self.target = kind, target
        self.status, self.error = "running", None
        self.events, self.results = [], []
        self.total = self.done = 0
        self.cancel = False
        self.started = datetime.now()
        self.report = None

    def log(self, level, msg):
        self.events.append({"type": "log", "level": level, "msg": msg})


JOBS = {}


def run_scan(job, endpoints, headers, method):
    try:
        job.total = len(endpoints)
        job.log("info", f"Iniciando varredura de {job.total} endpoints")
        for ep in endpoints:
            if job.cancel:
                job.status = "cancelled"
                job.log("cancel", "Interrompido pelo usuário.")
                break
            r = core.profile_endpoint(job.target, ep, headers, method)
            job.results.append(r)
            job.done += 1
            job.events.append({"type": "result", "result": r})
            if r["error"]:
                job.log("erro", f"{ep}: {r['error']}")
            else:
                job.log("ok", f"{ep} → {r['status_code']} em {r['response_time']:.3f} s")
        else:
            job.status = "done"
            job.log("fim", "Varredura concluída.")
        job.report = core.build_report(job.target, job.started, job.results)
        path = os.path.join(store.report_dir, f"report_{job.started:%Y%m%d_%H%M%S}.txt")
        with open(path, "w", encoding="utf-8") as f:
            f.write(job.report)
    except Exception as e:  # nunca derruba o servidor
        job.status, job.error = "error", str(e)


def run_discover(job, words, headers):
    def emit(kind, **d):
        if kind == "progress":
            job.done, job.total = d["done"], d["total"]
        elif kind == "found":
            item = dict(d["item"], is_new=d["item"]["endpoint"] not in known)
            job.events.append({"type": "found", "item": item})
            job.log("ok", f"Encontrado: {item['endpoint']} [{item['status_code']}]")
    try:
        known = set(store.load())
        job.log("info", f"Testando {len(words)} palavras (6 variações cada)")
        core.discover(job.target, words, headers, emit, lambda: job.cancel)
        job.status = "cancelled" if job.cancel else "done"
    except Exception as e:
        job.status, job.error = "error", str(e)


# ---------- Helpers ----------
def bad(msg, code=400):
    return jsonify(error=msg), code


def body():
    return request.get_json(silent=True) or {}


def text_field(d, key):
    t = d.get(key)
    if t is None:
        return None
    if not isinstance(t, str) or len(t.encode("utf-8")) > core.MAX_UPLOAD:
        raise ValueError("O arquivo excede 100 KB.")
    return t


def common(d):
    if not d.get("scope_confirmed"):
        raise ValueError("Confirme que você tem autorização para analisar este alvo.")
    target = core.normalize_target(d.get("target"))
    method = str(d.get("method") or "GET").upper()
    if method not in core.METHODS:
        raise ValueError("Método não suportado.")
    headers = core.parse_headers(d.get("headers")) or dict(core.DEFAULT_HEADERS)
    if any(j.status == "running" for j in JOBS.values()):
        raise RuntimeError("Já existe uma operação em andamento.")
    return target, method, headers


def start(job, fn, *args):
    JOBS[job.id] = job
    threading.Thread(target=fn, args=(job, *args), daemon=True).start()
    return jsonify(id=job.id)


def endpoints_state(backup=None):
    return jsonify(endpoints=store.load(), backups=store.backups(), backup=backup)


# ---------- Rotas ----------
@app.get("/")
def index():
    return send_from_directory(STATIC, "index.html")


@app.get("/api/endpoints")
def endpoints_get():
    return endpoints_state()


@app.put("/api/endpoints")
def endpoints_put():
    d = body()
    try:
        text = text_field(d, "endpoints_text")
        eps = core.parse_endpoints(text) if text is not None else core.parse_endpoints("\n".join(d.get("endpoints") or []))
        return endpoints_state(store.save(eps))
    except ValueError as e:
        return bad(str(e))


@app.post("/api/endpoints/restore")
def endpoints_restore():
    try:
        return endpoints_state(store.restore(str(body().get("name", ""))))
    except ValueError as e:
        return bad(str(e))


@app.post("/api/scans")
def scans_post():
    d = body()
    try:
        target, method, headers = common(d)
        text = text_field(d, "endpoints_text")
        eps = core.parse_endpoints(text) if text is not None else store.load()
        if not eps:
            raise ValueError("A lista de endpoints está vazia.")
    except ValueError as e:
        return bad(str(e))
    except RuntimeError as e:
        return bad(str(e), 409)
    return start(Job("scan", target), run_scan, eps, headers, method)


@app.post("/api/discover")
def discover_post():
    d = body()
    try:
        target, _, headers = common(d)
        text = text_field(d, "wordlist_text")
        words = core.parse_words(text) if text is not None else core.DEFAULT_WORDLIST
        if not words:
            raise ValueError("A wordlist está vazia.")
    except ValueError as e:
        return bad(str(e))
    except RuntimeError as e:
        return bad(str(e), 409)
    return start(Job("discover", target), run_discover, words, headers)


@app.get("/api/jobs/<jid>")
def job_get(jid):
    j = JOBS.get(jid)
    if not j:
        return bad("Operação não encontrada.", 404)
    since = request.args.get("since", 0, type=int)
    ev = j.events[since:]
    return jsonify(id=j.id, kind=j.kind, status=j.status, error=j.error, total=j.total, done=j.done,
                   target=j.target, started=f"{j.started:%d/%m/%Y %H:%M}", events=ev, next=since + len(ev))


@app.post("/api/jobs/<jid>/cancel")
def job_cancel(jid):
    j = JOBS.get(jid)
    if not j:
        return bad("Operação não encontrada.", 404)
    j.cancel = True
    return jsonify(ok=True)


@app.get("/api/jobs/<jid>/report")
def job_report(jid):
    j = JOBS.get(jid)
    if not j or j.report is None:
        return bad("Relatório indisponível.", 404)
    return Response(j.report, mimetype="text/plain; charset=utf-8",
                    headers={"Content-Disposition": "attachment; filename=report.txt"})


def main():
    print("NX-TRACE web em http://127.0.0.1:5000  (dados em: %s)" % DATA_DIR)
    app.run(host="127.0.0.1", port=5000, threaded=True)


if __name__ == "__main__":
    main()