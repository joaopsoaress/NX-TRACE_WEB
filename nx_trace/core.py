import ipaddress
import json
import re
import socket
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from urllib.parse import urlsplit

import requests
import urllib3.util.connection as _u3conn

DEFAULT_HEADERS = {"Content-Type": "application/json", "User-Agent": "NX-TRACE-Scanner/1.6.1"}
METHODS = ("GET", "HEAD", "OPTIONS")
AUTH_STATUS = (401, 403)
AUTH_KEYWORDS = ["login", "sign in", "authenticate", "authorization",
                 "access denied", "forbidden", "auth", "unauthorized"]
MAX_UPLOAD = 100 * 1024  # 100 KB (RF01)
MAX_BACKUPS = 20
MAX_BODY = 1024 * 1024   # corpo lido por resposta (limite de memória e de payload da função)
MAX_REDIRECTS = 3
MAX_HEADERS = 30
BLOCKED_MSG = "Destino não permitido: endereços locais, privados ou reservados são bloqueados."

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
        raise ValueError("URL inválida. Use o formato https://host ou http://host:porta")
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


# ---------- Proteção de rede (SSRF) ----------
# O serviço roda em servidores públicos e aceita alvos externos. Por isso, só
# endereços IP públicos podem ser contatados. A checagem ocorre no momento da
# conexão (inclusive em redirecionamentos), usando o IP já validado, o que
# evita DNS rebinding.
class BlockedTarget(OSError):
    pass


def _is_public(ip_str):
    ip = ipaddress.ip_address(ip_str.split("%")[0])
    mapped = getattr(ip, "ipv4_mapped", None)
    if mapped is not None:
        ip = mapped
    return ip.is_global


def resolve_public(host, port):
    """Resolve o host e devolve só IPs públicos. Qualquer IP não público bloqueia o alvo."""
    ips = []
    for info in socket.getaddrinfo(host.strip("[]"), port, type=socket.SOCK_STREAM):
        ip = info[4][0]
        if not _is_public(ip):
            raise BlockedTarget(BLOCKED_MSG)
        if ip not in ips:
            ips.append(ip)
    return ips


def assert_public_target(url):
    """Pré-checagem com mensagem amigável. A barreira real é install_ssrf_guard()."""
    parts = urlsplit(url)
    host = parts.hostname
    if not host:
        raise ValueError("URL inválida. Use o formato https://host")
    try:
        port = parts.port or (443 if parts.scheme == "https" else 80)
        resolve_public(host, port)
    except BlockedTarget:
        raise ValueError(BLOCKED_MSG)
    except (socket.gaierror, UnicodeError):
        raise ValueError(f"Não foi possível resolver o host “{host[:60]}”.")
    except ValueError:
        raise ValueError("URL inválida (porta incorreta).")


_guard_installed = False


def install_ssrf_guard():
    """Faz toda conexão TCP do urllib3 passar por resolve_public(). Chamar uma vez na inicialização."""
    global _guard_installed
    if _guard_installed:
        return
    original = _u3conn.create_connection

    def guarded(address, *args, **kwargs):
        host, port = address
        last = None
        for ip in resolve_public(host, port):
            try:
                return original((ip, port), *args, **kwargs)
            except OSError as e:
                last = e
        raise last or OSError("Nenhum endereço disponível.")

    _u3conn.create_connection = guarded
    _guard_installed = True


# ---------- Perfilamento e descoberta ----------
def _session():
    s = requests.Session()
    s.trust_env = False  # ignora proxies do ambiente
    s.max_redirects = MAX_REDIRECTS
    return s


def _read_body(resp, deadline):
    """Lê o corpo até MAX_BODY bytes e até o prazo total. Retorna (bytes, truncado)."""
    chunks, size = [], 0
    for chunk in resp.iter_content(65536):
        chunks.append(chunk)
        size += len(chunk)
        if size > MAX_BODY:
            return b"".join(chunks)[:MAX_BODY], True
        if time.time() > deadline:
            raise requests.exceptions.Timeout()
    return b"".join(chunks), False


def _decode(body, encoding):
    try:
        return body.decode(encoding or "utf-8", errors="replace")
    except LookupError:
        return body.decode("utf-8", errors="replace")


def profile_endpoint(target, endpoint, headers=None, method="GET", timeout=10):
    r = {"endpoint": endpoint, "status_code": None, "response_time": None, "content_length": None,
         "truncated": False,
         "auth_signals": {"status_code": False, "www_authenticate": False, "keyword": False},
         "auth_required": False, "json_data": None, "error": None}
    start = time.time()
    try:
        with _session() as s:
            resp = s.request(method, target + endpoint, headers=headers or DEFAULT_HEADERS,
                             timeout=timeout, stream=True)
            body, r["truncated"] = _read_body(resp, start + timeout)
            resp.close()
        r["response_time"] = round(time.time() - start, 3)
        r["status_code"] = resp.status_code
        r["content_length"] = len(body)
        text = _decode(body, resp.encoding)
        if "application/json" in resp.headers.get("Content-Type", ""):
            try:
                if r["truncated"]:
                    raise ValueError
                r["json_data"] = json.loads(text)
            except ValueError:
                r["json_data"] = {"error": "Failed to parse JSON"}
        sig = r["auth_signals"]
        sig["status_code"] = resp.status_code in AUTH_STATUS
        sig["www_authenticate"] = "WWW-Authenticate" in resp.headers
        low = text.lower()
        sig["keyword"] = any(k in low for k in AUTH_KEYWORDS)
        r["auth_required"] = any(sig.values())
    except requests.exceptions.Timeout:
        r["error"] = f"Timeout após {timeout} segundos"
    except requests.exceptions.SSLError:
        r["error"] = "Falha de SSL/TLS: certificado inválido ou handshake recusado"
    except requests.exceptions.ConnectionError as e:
        msg = str(e)
        if "Destino não permitido" in msg:
            r["error"] = "Redirecionamento para destino não permitido (rede local/privada)"
        elif any(k in msg for k in ("Name or service not known", "NameResolution", "getaddrinfo",
                                    "Temporary failure in name resolution")):
            r["error"] = "Não foi possível resolver o host"
        else:
            r["error"] = "Conexão recusada ou interrompida – o servidor está acessível?"
    except requests.exceptions.RequestException as e:
        r["error"] = f"Erro de requisição: {e}"
    return r


def variants(word):
    """As 6 variações de caminho testadas por palavra (iguais às do CLI)."""
    return list(dict.fromkeys((f"/{word}", f"/api/{word}", f"/rest/{word}",
                               f"/v1/{word}", f"/{word}/v1", f"/{word}/api")))


def _probe_variant(target, ep, headers):
    """Retorna (item|None, falha_de_conexao)."""
    try:
        with _session() as s:
            resp = s.get(target + ep, headers=headers, timeout=2, allow_redirects=False, stream=True)
            item = None
            if resp.status_code != 404:
                item = {"endpoint": ep, "status_code": resp.status_code,
                        "content_type": resp.headers.get("Content-Type", "unknown")}
            resp.close()
            return item, False
    except requests.exceptions.ConnectionError:
        return None, True
    except requests.exceptions.RequestException:
        return None, False


def discover_word(target, word, headers):
    """Testa as variações de UMA palavra (em paralelo) e devolve os endpoints que não deram 404.
    Sem estado: o navegador chama uma vez por palavra. Levanta ConnectionError se nenhuma
    variação conseguiu conectar ao alvo."""
    eps = variants(word)
    with ThreadPoolExecutor(max_workers=len(eps)) as pool:
        out = list(pool.map(lambda ep: _probe_variant(target, ep, headers), eps))
    if all(failed for _, failed in out):
        raise ConnectionError(f"Falha de conexão com {target}")
    return [item for item, _ in out if item]


# ---------- Relatório (RF09) ----------
def summarize(results):
    ok = [r for r in results if not r["error"]]
    return {"total": len(results), "successful": len(ok), "failed": len(results) - len(ok),
            "avg_time": round(sum(r["response_time"] for r in ok) / len(ok), 3) if ok else None,
            "auth_count": sum(1 for r in ok if r["auth_required"])}


def parse_started(text):
    """Data/hora local enviada pelo navegador ('AAAA-MM-DD HH:MM:SS'); usa agora se inválida."""
    try:
        return datetime.strptime(str(text), "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return datetime.now()


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
                  f"  Content Length: {r['content_length']} bytes" + (" (truncated)" if r.get("truncated") else ""),
                  f"  Authentication Required: {'YES' if r['auth_required'] else 'NO'}",
                  f"  Auth Signals: status={sig['status_code']} www-authenticate={sig['www_authenticate']} keyword={sig['keyword']}"]
        if r["json_data"] is not None:  # payload JSON completo, inclusive aninhado (RNF05)
            L.append("  Response Data (JSON):")
            L += ["    " + ln for ln in json.dumps(r["json_data"], indent=2, ensure_ascii=False).splitlines()]
        L.append("-" * 40)
    return "\n".join(L) + "\n"