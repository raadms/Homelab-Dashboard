"""Homelab dashboard server (Python standard library only).

Run:   python3 -m server.app                 (from the project folder)
Admin: python3 -m server.app --set-password  (sets/changes the admin password)

Credentials for integrations (the Home Assistant token) stay on this backend:
they are read from files named in data/config.json and are never sent to the
browser, written to snapshots, or included in exports.
"""
import argparse
import getpass
import gzip
import hashlib
import hmac
import io
import json
import mimetypes
import os
import re
import secrets
import sys
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from . import checks, discovery, live, merge
from .store import Store, now
from .vault import Vault

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get("DASH_DATA", os.path.join(ROOT, "data"))
WEB = os.path.join(ROOT, "web")
CONFIG_PATH = os.path.join(DATA, "config.json")

DEFAULT_CONFIG = {
    "listen": "0.0.0.0",
    "port": 8088,
    "ha_url_file": "~/.config/ha-agent/url",
    "ha_token_file": "~/.config/ha-agent/token",
    "collector_label": None,
    "secure_cookie": False,
    "admin_user": "admin",
    "admin_pw_hash": None,
}


def load_config():
    cfg = dict(DEFAULT_CONFIG)
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH) as f:
            cfg.update(json.load(f))
    # Container-friendly overrides
    if os.environ.get("DASH_PORT"):
        cfg["port"] = int(os.environ["DASH_PORT"])
    if os.environ.get("DASH_SECURE_COOKIE"):
        cfg["secure_cookie"] = os.environ["DASH_SECURE_COOKIE"].lower() in ("1", "true", "yes")
    if os.environ.get("DASH_COLLECTOR_LABEL"):
        cfg["collector_label"] = os.environ["DASH_COLLECTOR_LABEL"]
    return cfg


def save_config(cfg):
    os.makedirs(DATA, exist_ok=True)
    tmp = CONFIG_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(cfg, f, indent=2)
    os.chmod(tmp, 0o600)
    os.replace(tmp, CONFIG_PATH)


def _read_secret(path):
    try:
        with open(os.path.expanduser(path)) as f:
            return f.read().strip()
    except (OSError, TypeError):
        return None


def hash_pw(pw, salt=None, n=600_000):
    salt = salt or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), n).hex()
    return f"pbkdf2_sha256${n}${salt}${h}"


def check_pw(pw, stored):
    try:
        _, n, salt, h = stored.split("$")
        return hmac.compare_digest(hash_pw(pw, salt, int(n)).split("$")[3], h)
    except (ValueError, AttributeError):
        return False


def collector_label():
    import socket
    host = socket.gethostname()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.10.1.1", 9))
        ip = s.getsockname()[0]
        s.close()
    except OSError:
        ip = "?"
    return f"{host} ({ip})"


# ======================================================================= engine

class Engine:
    """Discovery, health checks and digests; also the background scheduler."""

    def __init__(self, store, cfg):
        self.store, self.cfg = store, cfg
        self.lock = threading.Lock()
        self.state = dict(discovery=dict(running=False, last=None, error=None),
                          checks=dict(running=False, last=None, count=0), digest=dict(last=None))
        self.label = cfg.get("collector_label") or collector_label()
        self.vault = Vault(DATA)
        self._import_token_files()
        self._diag_last = {}
        self._cache = None

    def _import_token_files(self):
        """One-time move of token files used before the admin UI existed into the vault."""
        try:
            if not self.vault.get("proxmox"):
                t = live._read("pve_token")
                if t:
                    self.vault.set("proxmox", dict(token=t))
            # The Home Assistant token file on the dev VM is an owner token for another project:
            # deliberately NOT imported. Create a dedicated non-admin HA token in Admin → Connections.
        except (ValueError, OSError) as e:
            print("token import skipped:", e, flush=True)

    def source_cfg(self):
        """Credentials for discovery: Admin → Connections first, token files as fallback."""
        v = self.vault
        pve, por, uni, ha = v.get("proxmox"), v.get("portainer"), v.get("unifi"), v.get("homeassistant")
        return dict(mode=self.store.settings().get("mode", "live"), collector_label=self.label,
                    ha_url=ha.get("url") or _read_secret(self.cfg["ha_url_file"]), ha_token=ha.get("token") or _read_secret(self.cfg["ha_token_file"]),
                    pve_token=pve.get("token"), pve_hosts=pve.get("hosts"), portainer_servers=por.get("servers"),
                    unifi_host=uni.get("host"), unifi_key=uni.get("key"), unifi_site=uni.get("site"))

    def test_connection(self, name, typed=None):
        """Run one connector now and report the result (never returns secrets).
        Values typed in the form but not saved yet are tested as-is (and not stored)."""
        c = self.source_cfg()
        t = {k: str(v).strip() for k, v in (typed or {}).items() if isinstance(v, str) and str(v).strip()}
        if name == "proxmox":
            c["pve_token"] = t.get("token") or c["pve_token"]
            c["pve_hosts"] = t.get("hosts") or c["pve_hosts"]
            if not c["pve_token"]:
                return dict(status="not-configured", error="No Proxmox token yet — paste it in the API token box, then click Save & test.")
        elif name == "unifi":
            c["unifi_key"] = t.get("key") or c["unifi_key"]
            c["unifi_host"] = t.get("host") or c["unifi_host"]
        elif name == "homeassistant":
            c["ha_url"] = t.get("url") or c["ha_url"]
            c["ha_token"] = t.get("token") or c["ha_token"]
        elif name == "portainer" and (typed or {}).get("servers"):
            saved = {x["host"]: x["token"] for x in (c["portainer_servers"] or [])}
            c["portainer_servers"] = [dict(host=x["host"], token=x.get("token") or saved.get(x["host"], "")) for x in typed["servers"] if x.get("host")]
        if name == "proxmox":
            from .discovery import ROOT
            seed = json.load(open(os.path.join(ROOT, "config", "seed.json")))
            hosts = [h.strip() for h in (c.get("pve_hosts") or "").split(",") if h.strip()] or [n["ip"] for n in seed.get("proxmox_nodes", [])]
            st, _ = live.proxmox(hosts, c["pve_token"])
        elif name == "portainer":
            st, _ = live.portainer(c["portainer_servers"])
        elif name == "unifi":
            st, _ = live.unifi(c["unifi_host"], c["unifi_key"], c["unifi_site"] or "default")
        elif name == "homeassistant":
            r = discovery.source_home_assistant(c)
            st = dict(status=r.get("status"), error=r.get("error"), detail=f"{len(r.get('clients', []))} network clients, {len(r.get('addons', []))} add-ons" if r.get("status") == "ok" else None)
        else:
            raise KeyError(name)
        return {k: v for k, v in st.items() if k in ("status", "detail", "error")}

    def inventory(self):
        if self._cache is None:
            _, inv = self.store.snapshot(0)
            self._cache = inv
        return self._cache

    def merged(self):
        m = merge.merged(self.store, self.inventory())
        m["collector"] = self.label
        m["engine"] = self.state
        return m

    def discover(self):
        if self.state["discovery"]["running"]:
            return False
        self.state["discovery"]["running"] = True
        try:
            cfg = self.source_cfg()
            inv = discovery.build(cfg, DATA)
            _, prev = self.store.snapshot(0)
            self.store.save_snapshot(inv)
            self._cache = inv
            if prev:
                for c in merge.diff(prev, inv):
                    self.store.event(c["type"], c.get("ref"), c["severity"], c["title"], dict(c.get("detail") or {}, hypothesis=c.get("hypothesis")))
            else:
                self.store.event("baseline", None, "info", f"Baseline established: {len(inv['apps'])} apps, {len(inv['devices'])} devices")
            self.state["discovery"].update(last=now(), error=None, apps=len(inv["apps"]))
            return True
        except Exception as e:  # noqa: BLE001
            self.state["discovery"]["error"] = f"{type(e).__name__}: {e}"
            traceback.print_exc()
            return False
        finally:
            self.state["discovery"]["running"] = False

    def run_checks(self):
        if self.state["checks"]["running"]:
            return False
        self.state["checks"]["running"] = True
        try:
            m = self.merged()
            todo, seen = [], set()
            for a in m["apps"]:
                if a.get("disabled"):
                    continue
                for e in a["endpoints"]:
                    if e.get("check_disabled") or e["url"] in seen:
                        continue
                    seen.add(e["url"])
                    todo.append((a, e))
            states = self.store.endpoint_states()

            def one(item):
                a, e = item
                st = states.get(e["url"]) or {}
                res = checks.check_endpoint(e, last_http_at=st.get("last_http_at") or 0, location=self.label, prev_http=st.get("last_http"))
                self.store.record_check(e["url"], res, a["name"])
            with ThreadPoolExecutor(8) as ex:
                list(ex.map(one, todo))
            self.store.prune()
            self.state["checks"].update(last=now(), count=len(todo))
            return True
        finally:
            self.state["checks"]["running"] = False

    def diagnose(self, endpoint_id):
        """On-demand check of one *known* endpoint (never an arbitrary URL)."""
        m = self.merged()
        found = next(((a, e) for a in m["apps"] for e in a["endpoints"] if e["id"] == endpoint_id), None)
        if not found:
            raise KeyError("unknown endpoint")
        a, e = found
        last = self._diag_last.get(endpoint_id, 0)
        wait = (300 if e.get("sensitive") else 20) - (time.time() - last)
        if wait > 0:
            raise PermissionError(f"Diagnostics for this endpoint ran recently; try again in {int(wait)} s")
        self._diag_last[endpoint_id] = time.time()
        res = checks.check_endpoint(dict(e, sensitive=False), location=self.label)
        self.store.record_check(e["url"], res, a["name"])
        res["endpoint"] = dict(url=e["url"], app=a["name"], kind=e["kind"], proxy=e.get("proxy"), upstream=e.get("upstream"))
        # reverse-proxy reachability: if the endpoint is behind a proxy, also test the proxy port
        if e.get("proxy_ip"):
            res["proxy_tcp"] = checks.tcp(e["proxy_ip"], 443)
        return res

    def digest(self, kind="on-demand"):
        d = merge.build_digest(self.store, self.merged(), kind=kind)
        d["id"] = self.store.save_digest(kind, d)
        self.state["digest"]["last"] = d["generated_at"]
        return d

    def scheduler(self):
        last_disc = last_chk = 0.0
        if self.inventory() is None:
            self.discover()
            last_disc = time.time()
        while True:
            try:
                s = self.store.settings()
                t = time.time()
                if t - last_disc >= s["discovery_interval_min"] * 60:
                    last_disc = t
                    self.discover()
                if t - last_chk >= s["check_interval_min"] * 60:
                    last_chk = t
                    self.run_checks()
                if s["digest_enabled"]:
                    loc = datetime.now()
                    last = self.store.last_digest_at("daily")
                    today = loc.strftime("%Y-%m-%d")
                    if loc.hour >= s["digest_hour_local"] and (not last or datetime.fromisoformat(last.replace("Z", "+00:00")).astimezone().strftime("%Y-%m-%d") != today):
                        self.digest("daily")
            except Exception:  # noqa: BLE001
                traceback.print_exc()
            time.sleep(20)


# ======================================================================= HTTP

class Handler(BaseHTTPRequestHandler):
    server_version = "homelab-dash/1.0"
    engine: Engine = None
    store: Store = None
    cfg: dict = None
    login_fail = {}

    # ---------------------------------------------------------------- utils
    def log_message(self, fmt, *args):
        if os.environ.get("DASH_QUIET"):
            return
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    def _headers(self, code, ctype, length=None, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        if length is not None:
            self.send_header("Content-Length", str(length))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy",
                         "default-src 'self'; img-src 'self' data: https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; "
                         "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()

    def json(self, obj, code=200, extra=None):
        body = json.dumps(obj, default=str).encode()
        if "gzip" in (self.headers.get("Accept-Encoding") or "") and len(body) > 2048:
            body = gzip.compress(body, 5)
            extra = dict(extra or {}, **{"Content-Encoding": "gzip", "Vary": "Accept-Encoding"})
        self._headers(code, "application/json; charset=utf-8", len(body), dict(extra or {}, **{"Cache-Control": "no-store"}))
        self.wfile.write(body)

    def err(self, code, msg):
        self.json(dict(error=msg), code)

    def body(self, limit=2_000_000):
        n = int(self.headers.get("Content-Length") or 0)
        if n > limit:
            raise ValueError("request too large")
        return self.rfile.read(n) if n else b""

    def body_json(self):
        raw = self.body()
        if not raw:
            return {}
        if "application/json" not in (self.headers.get("Content-Type") or ""):
            raise ValueError("expected application/json")
        return json.loads(raw)

    def cookie(self, name):
        for part in (self.headers.get("Cookie") or "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == name:
                return v
        return None

    def is_admin(self):
        return self.store.valid_session(self.cookie("dash_session"))

    def require_admin(self):
        if not self.is_admin():
            self.err(401, "admin login required")
            return False
        return True

    def csrf_ok(self):
        # Mutations need a custom header (not sendable cross-site without CORS) and same-origin cookies.
        return self.headers.get("X-Dashboard") == "1"

    # ---------------------------------------------------------------- dispatch
    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_PUT(self):
        self._dispatch("PUT")

    def do_DELETE(self):
        self._dispatch("DELETE")

    def _dispatch(self, method):
        u = urlparse(self.path)
        path, qs = u.path, parse_qs(u.query)
        try:
            if not path.startswith("/api/"):
                if method != "GET":
                    return self.err(405, "method not allowed")
                return self.static(path)
            if method != "GET" and not self.csrf_ok():
                return self.err(403, "missing X-Dashboard header")
            if self.store.settings()["require_login_for_view"] and not self.is_admin() and path not in ("/api/login", "/api/me", "/api/setup"):
                return self.err(401, "login required")
            return self.route(method, path, qs)
        except (ValueError, json.JSONDecodeError) as e:
            return self.err(400, str(e))
        except KeyError as e:
            return self.err(404, f"not found: {e}")
        except PermissionError as e:
            return self.err(429, str(e))
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            return self.err(500, f"{type(e).__name__}")

    def route(self, method, path, qs):
        E, S = self.engine, self.store
        # -------------------------------------------------- public (read-only)
        if method == "GET" and path == "/api/inventory":
            return self.json(E.merged())
        if method == "POST" and path == "/api/setup":
            # First run only: create the admin account from the browser (no command line needed).
            if self.cfg.get("admin_pw_hash"):
                return self.err(409, "admin account already exists")
            b = self.body_json()
            user, pw = str(b.get("username") or "admin").strip()[:40], str(b.get("password") or "")
            if len(pw) < 10 or not re.match(r"^[\w.@-]{3,40}$", user):
                raise ValueError("username 3–40 letters/digits, password at least 10 characters")
            self.cfg.update(admin_user=user, admin_pw_hash=hash_pw(pw))
            save_config(self.cfg)
            tok = S.new_session()
            flags = "HttpOnly; SameSite=Strict; Path=/; Max-Age=43200" + ("; Secure" if self.cfg.get("secure_cookie") else "")
            return self.json(dict(ok=True), extra={"Set-Cookie": f"dash_session={tok}; {flags}"})
        if method == "GET" and path == "/api/me":
            return self.json(dict(admin=self.is_admin(), password_set=bool(self.cfg.get("admin_pw_hash")), user=self.cfg.get("admin_user") if self.is_admin() else None,
                                  require_login_for_view=S.settings()["require_login_for_view"]))
        if method == "GET" and path == "/api/status":
            return self.json(dict(engine=E.state, collector=E.label, snapshots=S.snapshot_count()))
        if method == "GET" and path == "/api/history":
            return self.json(S.history(qs.get("url", [""])[0]))
        if method == "GET" and path == "/api/events":
            return self.json(S.events(qs.get("since", [None])[0], 300))
        if method == "GET" and path == "/api/digests":
            return self.json(S.digests())
        if method == "GET" and path == "/api/digest":
            did = qs.get("id", [None])[0]
            return self.json(S.digest(int(did)) if did else S.digest())
        if method == "GET" and path == "/api/export/inventory.json":
            m = E.merged()
            body = {k: m[k] for k in ("generated_at", "collector", "sources", "networks", "nodes", "workloads", "containers",
                                     "devices", "apps", "domains", "routes", "issues", "summary")}
            return self.json(body, extra={"Content-Disposition": "attachment; filename=homelab-inventory.json"})
        if method == "GET" and path == "/api/export/inventory.csv":
            return self.csv(E.merged())
        if method == "GET" and path == "/api/prefs/favorites":
            return self.json(S.prefs("favorites", []))
        if method == "POST" and path == "/api/diagnose":
            b = self.body_json()
            return self.json(E.diagnose(str(b.get("endpoint_id", ""))))
        if method == "PUT" and path == "/api/prefs/favorites":
            # Favorites are a viewer convenience; they cannot affect infrastructure.
            favs = [str(x)[:200] for x in (self.body_json().get("favorites") or [])][:200]
            S.set_pref("favorites", favs)
            return self.json(favs)
        # -------------------------------------------------- auth
        if method == "POST" and path == "/api/login":
            ip = self.client_address[0]
            fails = [t for t in self.login_fail.get(ip, []) if time.time() - t < 300]
            if len(fails) >= 5:
                return self.err(429, "too many attempts; wait 5 minutes")
            b = self.body_json()
            if not self.cfg.get("admin_pw_hash"):
                return self.err(409, "no admin password set; run: python3 -m server.app --set-password")
            if b.get("username") == self.cfg.get("admin_user") and check_pw(str(b.get("password", "")), self.cfg["admin_pw_hash"]):
                self.login_fail.pop(ip, None)
                tok = S.new_session()
                flags = "HttpOnly; SameSite=Strict; Path=/; Max-Age=43200" + ("; Secure" if self.cfg.get("secure_cookie") else "")
                return self.json(dict(ok=True), extra={"Set-Cookie": f"dash_session={tok}; {flags}"})
            self.login_fail[ip] = fails + [time.time()]
            time.sleep(0.5)
            return self.err(401, "invalid username or password")
        if method == "POST" and path == "/api/logout":
            S.end_session(self.cookie("dash_session"))
            return self.json(dict(ok=True), extra={"Set-Cookie": "dash_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"})
        # -------------------------------------------------- admin
        if not path.startswith("/api/admin/"):
            raise KeyError(path)
        if not self.require_admin():
            return
        if method == "POST" and path == "/api/admin/discover":
            threading.Thread(target=E.discover, daemon=True).start()
            return self.json(dict(started=True))
        if method == "POST" and path == "/api/admin/check":
            threading.Thread(target=E.run_checks, daemon=True).start()
            return self.json(dict(started=True))
        if method == "POST" and path == "/api/admin/digest":
            return self.json(E.digest("on-demand"))
        if method == "GET" and path == "/api/admin/connections":
            srcs = {(x.get("name") or "").split(" ")[0].lower(): x for x in (E.inventory() or {}).get("sources", [])}
            pub = E.vault.public()
            last = dict(proxmox=srcs.get("proxmox"), portainer=srcs.get("portainer"), unifi=srcs.get("unifi"), homeassistant=srcs.get("home"))
            return self.json(dict(connections={k: dict(v, last={kk: vv for kk, vv in (last.get(k) or {}).items() if kk in ("status", "detail", "error", "at")})
                                               for k, v in pub.items()}, mode=S.settings().get("mode", "live")))
        m = re.match(r"^/api/admin/connections/(\w+)(/test)?$", path)
        if m:
            name, test = m.group(1), m.group(2)
            if test and method == "POST":
                return self.json(E.test_connection(name, self.body_json()))
            if method == "PUT":
                E.vault.set(name, self.body_json())
                threading.Thread(target=E.discover, daemon=True).start()
                return self.json(dict(ok=True, test=E.test_connection(name)))
            if method == "DELETE":
                E.vault.delete(name)
                threading.Thread(target=E.discover, daemon=True).start()
                return self.json(dict(ok=True))
        if method == "PUT" and path == "/api/admin/password":
            b = self.body_json()
            if not check_pw(str(b.get("current", "")), self.cfg.get("admin_pw_hash")):
                return self.err(403, "current password is wrong")
            if len(str(b.get("new", ""))) < 10:
                raise ValueError("new password must be at least 10 characters")
            self.cfg["admin_pw_hash"] = hash_pw(str(b["new"]))
            save_config(self.cfg)
            S.x("DELETE FROM sessions")  # log out every other device
            tok = S.new_session()
            flags = "HttpOnly; SameSite=Strict; Path=/; Max-Age=43200" + ("; Secure" if self.cfg.get("secure_cookie") else "")
            return self.json(dict(ok=True), extra={"Set-Cookie": f"dash_session={tok}; {flags}"})
        if method == "GET" and path == "/api/admin/settings":
            return self.json(S.settings())
        if method == "PUT" and path == "/api/admin/settings":
            return self.json(S.set_settings(self.body_json()))
        m = re.match(r"^/api/admin/override/(.+)$", path)
        if m:
            tid = m.group(1)
            if method == "PUT":
                return self.json(S.set_override(tid, self.body_json()))
            if method == "DELETE":
                S.delete_override(tid)
                return self.json(dict(ok=True))
        if method == "GET" and path == "/api/admin/overrides":
            return self.json(S.overrides())
        if path == "/api/admin/manual" and method == "POST":
            b = self.body_json()
            return self.json(dict(id=S.upsert_manual(b.pop("kind", "app"), b)))
        m = re.match(r"^/api/admin/manual/(.+)$", path)
        if m:
            if method == "PUT":
                b = self.body_json()
                return self.json(dict(id=S.upsert_manual(b.pop("kind", "app"), b, m.group(1))))
            if method == "DELETE":
                S.delete_manual(m.group(1))
                return self.json(dict(ok=True))
        if method == "GET" and path == "/api/admin/export":
            body = dict(format="homelab-dashboard-config", version=1, exported_at=now(),
                        settings=S.settings(), overrides=S.overrides(), manual=S.manual(),
                        favorites=S.prefs("favorites", []))
            return self.json(body, extra={"Content-Disposition": "attachment; filename=dashboard-config.json"})
        if method == "POST" and path == "/api/admin/import":
            b = self.body_json()
            if b.get("format") != "homelab-dashboard-config":
                raise ValueError("not a dashboard config export")
            mode = (b.get("mode") or "merge")
            n = 0
            if b.get("settings"):
                S.set_settings({k: v for k, v in b["settings"].items() if k in S.settings()})
            if mode == "replace":
                for k in S.overrides():
                    S.delete_override(k)
            for tid, data in (b.get("overrides") or {}).items():
                S.set_override(tid, data)
                n += 1
            for mm in b.get("manual") or []:
                mid = mm.get("id") if str(mm.get("id", "")).startswith("manual:") else None
                kind = mm.get("kind", "app")
                data = {k: v for k, v in mm.items() if k not in ("id", "kind", "created_at", "updated_at")}
                try:
                    S.upsert_manual(kind, data, mid)
                except KeyError:
                    S.x("INSERT INTO manual(id,kind,data,created_at,updated_at) VALUES(?,?,?,?,?)", (mid, kind, json.dumps(data), now(), now()))
                n += 1
            if isinstance(b.get("favorites"), list):
                S.set_pref("favorites", b["favorites"][:200])
            return self.json(dict(ok=True, imported=n))
        if method == "POST" and path == "/api/admin/upload":
            name = os.path.basename((parse_qs(urlparse(self.path).query).get("name") or [""])[0])
            if not re.match(r"^[\w.\-]{1,120}\.tar\.gz$", name):
                raise ValueError("file must be a collector .tar.gz")
            raw = self.body(30_000_000)
            if raw[:2] != b"\x1f\x8b":
                raise ValueError("not a gzip file")
            os.makedirs(os.path.join(DATA, "incoming"), exist_ok=True)
            with open(os.path.join(DATA, "incoming", name), "wb") as f:
                f.write(raw)
            threading.Thread(target=E.discover, daemon=True).start()
            return self.json(dict(ok=True, saved=name, rediscovery="started"))
        raise KeyError(path)

    def csv(self, m):
        import csv
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["name", "category", "status", "preferred_domain_url", "preferred_ip_url", "host", "node", "workload",
                    "container", "compose", "ip", "vlan", "endpoints (url status health)", "sources", "confidence", "hidden"])
        wl = {x["id"]: x for x in m["workloads"]}
        for a in m["apps"]:
            ep = {e["id"]: e for e in a["endpoints"]}
            loc = a.get("location") or {}
            w.writerow([a["name"], a.get("category"), a["status"], (ep.get(a.get("preferred_domain")) or {}).get("url"),
                        (ep.get(a.get("preferred_ip")) or {}).get("url"), loc.get("host_label"), (loc.get("node_id") or "").replace("node:", ""),
                        (wl.get(loc.get("workload_id")) or {}).get("name"), loc.get("container_id", "").split(":")[-1] if loc.get("container_id") else "",
                        loc.get("compose_project"), loc.get("host_ip"), a.get("vlan"),
                        " | ".join(f"{e['url']} {e['status']} {e.get('health') or '-'}" for e in a["endpoints"]),
                        "; ".join(a.get("sources") or []), a.get("confidence"), a.get("hidden")])
        body = buf.getvalue().encode()
        self._headers(200, "text/csv; charset=utf-8", len(body), {"Content-Disposition": "attachment; filename=homelab-inventory.csv"})
        self.wfile.write(body)

    def static(self, path):
        if path == "/collect-proxmox.sh":
            with open(os.path.join(ROOT, "collectors", "dist", "collect-proxmox.sh"), "rb") as f:
                body = f.read()
            self._headers(200, "text/x-shellscript; charset=utf-8", len(body), {"Content-Disposition": "attachment; filename=collect-proxmox.sh"})
            self.wfile.write(body)
            return
        if path in ("", "/"):
            path = "/index.html"
        full = os.path.realpath(os.path.join(WEB, path.lstrip("/")))
        if not full.startswith(os.path.realpath(WEB) + os.sep) or not os.path.isfile(full):
            full = os.path.join(WEB, "index.html")  # SPA fallback
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if full.endswith(".webmanifest"):
            ctype = "application/manifest+json"
        with open(full, "rb") as f:
            body = f.read()
        cache = "no-cache" if full.endswith((".html", ".js", ".css")) else "public, max-age=86400"
        self._headers(200, ctype + ("; charset=utf-8" if ctype.startswith("text/") or ctype.endswith("javascript") else ""), len(body), {"Cache-Control": cache})
        self.wfile.write(body)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--set-password", action="store_true", help="set the admin password and exit")
    ap.add_argument("--user", default=None, help="admin username (with --set-password)")
    ap.add_argument("--port", type=int)
    ap.add_argument("--listen")
    ap.add_argument("--no-scheduler", action="store_true")
    ap.add_argument("--discover-once", action="store_true", help="run discovery + checks + digest once and exit")
    args = ap.parse_args()
    cfg = load_config()
    if args.set_password:
        pw = os.environ.get("DASH_ADMIN_PASSWORD") or getpass.getpass("New admin password: ")
        if len(pw) < 10:
            sys.exit("Use at least 10 characters.")
        if not os.environ.get("DASH_ADMIN_PASSWORD") and getpass.getpass("Repeat: ") != pw:
            sys.exit("Passwords differ.")
        cfg["admin_user"] = args.user or cfg.get("admin_user") or "admin"
        cfg["admin_pw_hash"] = hash_pw(pw)
        save_config(cfg)
        print(f"Admin password set for user '{cfg['admin_user']}' in {CONFIG_PATH}")
        return
    probe = os.path.join(DATA, ".write-test")
    try:
        os.makedirs(DATA, exist_ok=True)
        with open(probe, "w") as f:
            f.write("ok")
        os.remove(probe)
    except OSError:
        sys.exit(f"ERROR: the data folder {DATA} is not writable by user id {os.getuid()}.\n"
                 f"On the Docker host run:  sudo chown -R {os.getuid()}:{os.getgid()} <the folder you mounted at {DATA}>\n"
                 f"then restart the container.")
    if not os.path.exists(CONFIG_PATH):
        save_config(cfg)
    store = Store(os.path.join(DATA, "dashboard.db"))
    engine = Engine(store, cfg)
    if args.discover_once:
        engine.discover(); engine.run_checks(); d = engine.digest("on-demand")
        print(d["headline"])
        return
    Handler.engine, Handler.store, Handler.cfg = engine, store, cfg
    if not args.no_scheduler:
        threading.Thread(target=engine.scheduler, daemon=True).start()
    host, port = args.listen or cfg["listen"], args.port or cfg["port"]
    srv = ThreadingHTTPServer((host, port), Handler)
    srv.daemon_threads = True
    print(f"Dashboard on http://{host}:{port}  (collector: {engine.label})", flush=True)
    if not cfg.get("admin_pw_hash"):
        print("No admin password yet: python3 -m server.app --set-password", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
