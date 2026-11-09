import json
import os
import re
import shutil
import time
from datetime import datetime

import requests

DEFAULT_HEADERS = {"Content-Type": "application/json", "User-Agent": "NX-TRACE-Scanner/1.6.1"}
METHODS = ("GET", "HEAD", "OPTIONS")
AUTH_STATUS = (401, 403)
AUTH_KEYWORDS = ["login", "sign in", "authenticate", "authorization",
                 "access denied", "forbidden", "auth", "unauthorized"]
MAX_UPLOAD = 100 * 1024  # 100 KB (RF01)
MAX_BACKUPS = 20

DEFAULT_WORDLIST = [
    "admin", "dashboard", "manager", "management", "api", "v1", "v2", "v3", "rest", "graphql",
    "login", "logout", "register", "auth", "users", "user", "accounts", "profile",
    "products", "orders", "payments", "cart", "health", "status", "ping", "metrics",
    "docs", "swagger", "openapi", "redoc", "backup", "temp", "logs", "config",
    ".env", ".git", "test", "dev", "public", "private", "internal",
    "webhook", "callback", "hooks", "db", "database", "search", "query",
    "reports", "export", "import", "download",
]


# ---------- Validação e parsing ----------
def normalize_target(url):
    url = (url or "").strip().rstrip("/")
    if not re.match(r"^https?://[^\s/]+(/\S*)?$", url):
        raise ValueError("URL inválida. Use o formato http://host:porta")
    return url


def parse_endpoints(text, strict=True):
    """Um endpoint por linha, começando com '/'. Ignora vazias e comentários (#)."""
    out, seen = [], set()
    for line in text.splitlines():
        ep = line.strip()
        if not ep or ep.startswith("#"):
            continue
        if not re.match(r"^/\S{0,199}$", ep):
            if strict:
                raise ValueError(f"Endpoint inválido: {ep[:40]}")
            continue
        if ep not in seen:
            seen.add(ep)
            out.append(ep)
    return out


def parse_words(text):
    words, seen = [], set()
    for line in text.splitlines():
        w = line.strip().lstrip("/")
        if not w or w.startswith("#"):
            continue
        if not re.match(r"^[\w.\-]{1,60}$", w):
            raise ValueError(f"Palavra inválida na wordlist: {w[:40]}")
        if w not in seen:
            seen.add(w)
            words.append(w)
    if len(words) > 500:
        raise ValueError("A wordlist pode ter no máximo 500 palavras.")
    return words


def parse_headers(text):
    headers = {}
    for line in (text or "").splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            if k.strip():
                headers[k.strip()] = v.strip()
    return headers


# ---------- Perfilamento e descoberta ----------
def profile_endpoint(target, endpoint, headers=None, method="GET", timeout=10):
    r = {"endpoint": endpoint, "status_code": None, "response_time": None, "content_length": None,
         "auth_signals": {"status_code": False, "www_authenticate": False, "keyword": False},
         "auth_required": False, "json_data": None, "error": None}
    start = time.time()
    try:
        resp = requests.request(method, target + endpoint, headers=headers or DEFAULT_HEADERS, timeout=timeout)
        r["response_time"] = round(time.time() - start, 3)
        r["status_code"] = resp.status_code
        r["content_length"] = len(resp.content)
        if "application/json" in resp.headers.get("Content-Type", ""):
            try:
                r["json_data"] = resp.json()
            except ValueError:
                r["json_data"] = {"error": "Failed to parse JSON"}
        sig = r["auth_signals"]
        sig["status_code"] = resp.status_code in AUTH_STATUS
        sig["www_authenticate"] = "WWW-Authenticate" in resp.headers
        text = resp.text.lower()
        sig["keyword"] = any(k in text for k in AUTH_KEYWORDS)
        r["auth_required"] = any(sig.values())
    except requests.exceptions.Timeout:
        r["error"] = f"Timeout após {timeout} segundos"
    except requests.exceptions.ConnectionError:
        r["error"] = "Conexão recusada – o servidor está rodando?"
    except requests.exceptions.RequestException as e:
        r["error"] = f"Erro de requisição: {e}"
    return r


def discover(target, words, headers, emit, should_stop):
    """Descoberta por wordlist (mesmas 6 variações do CLI). Não toca em arquivos."""
    found, seen = [], set()
    for i, word in enumerate(words):
        if should_stop():
            break
        emit("progress", done=i, total=len(words))
        for ep in (f"/{word}", f"/api/{word}", f"/rest/{word}", f"/v1/{word}", f"/{word}/v1", f"/{word}/api"):
            if should_stop() or ep in seen:
                continue
            try:
                resp = requests.get(target + ep, headers=headers, timeout=2, allow_redirects=False)
            except requests.exceptions.ConnectionError:
                raise ConnectionError(f"Falha de conexão com {target}")
            except requests.exceptions.RequestException:
                continue
            if resp.status_code != 404:
                seen.add(ep)
                item = {"endpoint": ep, "status_code": resp.status_code,
                        "content_type": resp.headers.get("Content-Type", "unknown")}
                found.append(item)
                emit("found", item=item)
    emit("progress", done=len(words), total=len(words))
    return found


# ---------- Arquivo de endpoints com backup (RF08) ----------
class EndpointStore:
    def __init__(self, data_dir, seed=None):
        self.file = os.path.join(data_dir, "endpoints.txt")
        self.backup_dir = os.path.join(data_dir, "backups")
        self.report_dir = os.path.join(data_dir, "reports")
        os.makedirs(self.backup_dir, exist_ok=True)
        os.makedirs(self.report_dir, exist_ok=True)
        if not os.path.exists(self.file) and seed and os.path.exists(seed):
            shutil.copyfile(seed, self.file)

    def load(self):
        if not os.path.exists(self.file):
            return []
        with open(self.file, encoding="utf-8") as f:
            return parse_endpoints(f.read(), strict=False)

    def save(self, endpoints):
        """Grava a lista; cria backup (cópia) do arquivo atual antes. Retorna o nome do backup."""
        endpoints = sorted(set(endpoints))
        backup = None
        if os.path.exists(self.file):
            if sorted(self.load()) == endpoints:
                return None
            backup = self._backup()
        with open(self.file, "w", encoding="utf-8") as f:
            f.write("# NX-TRACE Endpoints File\n")
            f.write(f"# Updated: {datetime.now():%Y-%m-%d %H:%M:%S}\n\n")
            f.write("\n".join(endpoints) + "\n")
        return backup

    def _backup(self):
        base = f"endpoints_backup_{datetime.now():%Y%m%d_%H%M%S}"
        name, n = base + ".txt", 1
        while os.path.exists(os.path.join(self.backup_dir, name)):
            name, n = f"{base}_{n}.txt", n + 1
        shutil.copyfile(self.file, os.path.join(self.backup_dir, name))
        for old in self.backups()[MAX_BACKUPS:]:
            os.remove(os.path.join(self.backup_dir, old))
        return name

    def backups(self):
        names = [n for n in os.listdir(self.backup_dir) if re.match(r"^endpoints_backup_\d{8}_\d{6}(_\d+)?\.txt$", n)]
        return sorted(names, reverse=True)

    def restore(self, name):
        if name not in self.backups():
            raise ValueError("Backup não encontrado.")
        with open(os.path.join(self.backup_dir, name), encoding="utf-8") as f:
            eps = parse_endpoints(f.read(), strict=False)
        return self.save(eps)


# ---------- Relatório (RF09) ----------
def summarize(results):
    ok = [r for r in results if not r["error"]]
    return {"total": len(results), "successful": len(ok), "failed": len(results) - len(ok),
            "avg_time": round(sum(r["response_time"] for r in ok) / len(ok), 3) if ok else None,
            "auth_count": sum(1 for r in ok if r["auth_required"])}


def build_report(target, started, results):
    s = summarize(results)
    L = ["=" * 70, "                     NX-TRACE SCAN REPORT", "=" * 70, "",
         f"Scan Date: {started:%Y-%m-%d %H:%M:%S}", f"Target URL: {target}",
         f"Endpoints Scanned: {s['total']}", f"Successful: {s['successful']}", f"Failed: {s['failed']}"]
    if s["avg_time"] is not None:
        L.append(f"Average Response Time: {s['avg_time']:.3f} seconds")
    L += ["", "-" * 70, ""]
    for r in results:
        L.append(f"ENDPOINT: {r['endpoint']}")
        if r["error"]:
            L += ["  Status: ERROR", f"  Error: {r['error']}"]
        else:
            sig = r["auth_signals"]
            L += [f"  Status Code: {r['status_code']}", f"  Response Time: {r['response_time']} seconds",
                  f"  Content Length: {r['content_length']} bytes",
                  f"  Authentication Required: {'YES' if r['auth_required'] else 'NO'}",
                  f"  Auth Signals: status={sig['status_code']} www-authenticate={sig['www_authenticate']} keyword={sig['keyword']}"]
        if r["json_data"] is not None:  # payload JSON completo, inclusive aninhado (RNF05)
            L.append("  Response Data (JSON):")
            L += ["    " + ln for ln in json.dumps(r["json_data"], indent=2, ensure_ascii=False).splitlines()]
        L.append("-" * 40)
    return "\n".join(L) + "\n"