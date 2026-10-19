"""SQLite persistence.

Tables keep three kinds of data apart:
  snapshots       – discovered facts, one row per discovery run (never edited)
  overrides       – the user's edits, keyed by entity id (survive rediscovery)
  manual          – entries the user added by hand
plus runtime state: endpoint_state / checks (health), events, digests, prefs.
Nothing here can modify real infrastructure; "remove" only hides or deletes
a dashboard row.
"""
import hashlib
import json
import os
import re
import sqlite3
import threading
import time
import uuid

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, inventory TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS overrides (target_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS manual (id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS endpoint_state (url TEXT PRIMARY KEY, status TEXT, summary TEXT, last TEXT, last_ok_at TEXT,
  last_change_at TEXT, last_http_at REAL, last_http TEXT, fail_count INTEGER DEFAULT 0, checked_at TEXT);
CREATE TABLE IF NOT EXISTS checks (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT, at TEXT, status TEXT, summary TEXT, ms INTEGER);
CREATE INDEX IF NOT EXISTS checks_url_at ON checks(url, at);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, type TEXT, ref TEXT, severity TEXT, title TEXT, detail TEXT);
CREATE INDEX IF NOT EXISTS events_at ON events(at);
CREATE TABLE IF NOT EXISTS digests (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, kind TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, created_at REAL, expires_at REAL);
CREATE TABLE IF NOT EXISTS prefs (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""

DEFAULT_SETTINGS = {
    "discovery_interval_min": 60,
    "check_interval_min": 5,
    "digest_hour_local": 7,
    "digest_enabled": True,
    "cert_warn_days": 21,
    "require_login_for_view": False,
    "default_access_mode": "domain",
    "snapshot_keep": 120,
    "check_history_days": 30,
    "categories_order": ["Home", "Infrastructure", "Network", "Storage", "Media", "Downloads", "Security", "Monitoring", "Productivity", "Other"],
}

# Fields a user may override on each entity type (anything else is rejected).
OVERRIDE_FIELDS = {"name", "icon", "category", "purpose", "hidden", "disabled", "preferred_url", "order",
                   "notes_user", "tags", "extra_endpoints", "check_disabled", "favorite", "access", "dependencies_user"}


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


class Store:
    def __init__(self, path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.path = path
        self.lock = threading.RLock()
        self.db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript(SCHEMA)
        os.chmod(path, 0o600)

    # ------------------------------------------------------------- generic
    def q(self, sql, args=()):
        with self.lock:
            return self.db.execute(sql, args).fetchall()

    def x(self, sql, args=()):
        with self.lock:
            cur = self.db.execute(sql, args)
            return cur.lastrowid

    # ------------------------------------------------------------- settings
    def settings(self):
        s = dict(DEFAULT_SETTINGS)
        for k, v in self.q("SELECT key, value FROM settings"):
            s[k] = json.loads(v)
        return s

    def set_settings(self, patch):
        allowed = set(DEFAULT_SETTINGS)
        clean = {}
        for k, v in patch.items():
            if k not in allowed:
                raise ValueError(f"unknown setting {k}")
            d = DEFAULT_SETTINGS[k]
            if isinstance(d, bool):
                v = bool(v)
            elif isinstance(d, int):
                v = int(v)
                if k.endswith("_min") and not (1 <= v <= 1440):
                    raise ValueError(f"{k} must be 1–1440 minutes")
                if k == "check_interval_min" and v < 2:
                    raise ValueError("health checks may not run more often than every 2 minutes")
            elif isinstance(d, list):
                v = [str(i)[:40] for i in v][:40]
            else:
                v = str(v)[:40]
            clean[k] = v
        for k, v in clean.items():
            self.x("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (k, json.dumps(v)))
        return self.settings()

    def prefs(self, key, default=None):
        r = self.q("SELECT value FROM prefs WHERE key=?", (key,))
        return json.loads(r[0][0]) if r else default

    def set_pref(self, key, value):
        self.x("INSERT INTO prefs(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, json.dumps(value)))

    # ------------------------------------------------------------- snapshots
    def save_snapshot(self, inv):
        sid = self.x("INSERT INTO snapshots(at, inventory) VALUES(?,?)", (inv["generated_at"], json.dumps(inv)))
        keep = self.settings()["snapshot_keep"]
        self.x("DELETE FROM snapshots WHERE id <= ?", (sid - keep,))
        return sid

    def snapshot(self, offset=0):
        r = self.q("SELECT id, at, inventory FROM snapshots ORDER BY id DESC LIMIT 1 OFFSET ?", (offset,))
        return (r[0][0], json.loads(r[0][2])) if r else (None, None)

    def snapshot_count(self):
        return self.q("SELECT COUNT(*) FROM snapshots")[0][0]

    def snapshot_before(self, at_iso):
        r = self.q("SELECT id, inventory FROM snapshots WHERE at <= ? ORDER BY id DESC LIMIT 1", (at_iso,))
        return (r[0][0], json.loads(r[0][1])) if r else (None, None)

    # ------------------------------------------------------------- overrides / manual
    def overrides(self):
        return {t: json.loads(d) for t, d in self.q("SELECT target_id, data FROM overrides")}

    def set_override(self, target_id, patch):
        bad = set(patch) - OVERRIDE_FIELDS
        if bad:
            raise ValueError("cannot override: " + ", ".join(sorted(bad)))
        if not re.match(r"^[\w:.\-/@]{1,200}$", target_id):
            raise ValueError("bad id")
        cur = self.overrides().get(target_id, {})
        for k, v in patch.items():
            if v is None or v == "":
                cur.pop(k, None)
            else:
                cur[k] = _clean(k, v)
        if cur:
            self.x("INSERT INTO overrides(target_id,data,updated_at) VALUES(?,?,?) ON CONFLICT(target_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
                   (target_id, json.dumps(cur), now()))
        else:
            self.x("DELETE FROM overrides WHERE target_id=?", (target_id,))
        return cur

    def delete_override(self, target_id):
        self.x("DELETE FROM overrides WHERE target_id=?", (target_id,))

    def manual(self):
        return [dict(json.loads(d), id=i, kind=k, created_at=c, updated_at=u) for i, k, d, c, u in self.q("SELECT id, kind, data, created_at, updated_at FROM manual")]

    def upsert_manual(self, kind, data, mid=None):
        if kind not in ("app", "device"):
            raise ValueError("kind must be app or device")
        allowed = {"name", "icon", "category", "purpose", "ip", "mac", "vlan", "urls", "notes", "location", "role", "vendor", "dependencies"}
        data = {k: _clean(k, v) for k, v in data.items() if k in allowed}
        if not data.get("name"):
            raise ValueError("name is required")
        if mid:
            if not self.q("SELECT 1 FROM manual WHERE id=?", (mid,)):
                raise KeyError(mid)
            self.x("UPDATE manual SET data=?, updated_at=? WHERE id=?", (json.dumps(data), now(), mid))
        else:
            mid = f"manual:{kind}:{uuid.uuid4().hex[:8]}"
            self.x("INSERT INTO manual(id,kind,data,created_at,updated_at) VALUES(?,?,?,?,?)", (mid, kind, json.dumps(data), now(), now()))
        return mid

    def delete_manual(self, mid):
        self.x("DELETE FROM manual WHERE id=?", (mid,))

    # ------------------------------------------------------------- health state
    def endpoint_states(self):
        out = {}
        for url, st, summ, last, ok_at, ch_at, http_at, http, fails, checked in self.q(
                "SELECT url,status,summary,last,last_ok_at,last_change_at,last_http_at,last_http,fail_count,checked_at FROM endpoint_state"):
            out[url] = dict(status=st, summary=summ, last=json.loads(last) if last else None, last_ok_at=ok_at,
                            last_change_at=ch_at, last_http_at=http_at, last_http=json.loads(http) if http else None,
                            fail_count=fails, checked_at=checked)
        return out

    def record_check(self, url, res, name):
        """Store a check result, emit an event on status transitions."""
        prev = self.endpoint_states().get(url)
        ok = res["status"] in ("up", "auth", "reachable")
        changed = not prev or prev["status"] != res["status"]
        http = res.get("http") if res.get("http_requested") else None
        self.x("""INSERT INTO endpoint_state(url,status,summary,last,last_ok_at,last_change_at,last_http_at,last_http,fail_count,checked_at)
                  VALUES(?,?,?,?,?,?,?,?,?,?)
                  ON CONFLICT(url) DO UPDATE SET status=excluded.status, summary=excluded.summary, last=excluded.last,
                    last_ok_at=COALESCE(excluded.last_ok_at, endpoint_state.last_ok_at),
                    last_change_at=CASE WHEN endpoint_state.status IS excluded.status THEN endpoint_state.last_change_at ELSE excluded.last_change_at END,
                    last_http_at=COALESCE(excluded.last_http_at, endpoint_state.last_http_at),
                    last_http=COALESCE(excluded.last_http, endpoint_state.last_http),
                    fail_count=CASE WHEN ? THEN 0 ELSE endpoint_state.fail_count + 1 END,
                    checked_at=excluded.checked_at""",
               (url, res["status"], res.get("summary"), json.dumps(res), res["at"] if ok else None, res["at"],
                time.time() if http else None, json.dumps(http) if http else None, 0 if ok else 1, res["at"], 1 if ok else 0))
        self.x("INSERT INTO checks(url,at,status,summary,ms) VALUES(?,?,?,?,?)",
               (url, res["at"], res["status"], res.get("summary"), (res.get("http") or res.get("tcp") or {}).get("ms")))
        if prev and changed:
            good = {"up", "auth", "reachable"}
            if prev["status"] in good and res["status"] not in good:
                typ, sev = "health-down", "high" if res["status"] == "down" else "medium"
            elif prev["status"] not in good and res["status"] in good:
                typ, sev = "health-recovered", "info"
            else:
                typ, sev = "health-change", "low"
            self.event(typ, url, sev, f"{name}: {prev['status']} → {res['status']}",
                       dict(url=url, before=prev["status"], after=res["status"], summary=res.get("summary"),
                            hypothesis=res.get("hypothesis"), collector=res.get("collector")))
        return changed

    def history(self, url, limit=200):
        return [dict(at=a, status=s, summary=m, ms=ms) for a, s, m, ms in
                self.q("SELECT at,status,summary,ms FROM checks WHERE url=? ORDER BY id DESC LIMIT ?", (url, limit))]

    def prune(self):
        days = self.settings()["check_history_days"]
        cutoff = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - days * 86400))
        self.x("DELETE FROM checks WHERE at < ?", (cutoff,))
        self.x("DELETE FROM events WHERE at < ?", (time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 180 * 86400)),))
        self.x("DELETE FROM sessions WHERE expires_at < ?", (time.time(),))

    # ------------------------------------------------------------- events & digests
    def event(self, typ, ref, severity, title, detail=None, at=None):
        self.x("INSERT INTO events(at,type,ref,severity,title,detail) VALUES(?,?,?,?,?,?)",
               (at or now(), typ, ref, severity, title, json.dumps(detail or {})))

    def events(self, since=None, limit=500):
        rows = self.q("SELECT id,at,type,ref,severity,title,detail FROM events WHERE at >= ? ORDER BY id DESC LIMIT ?",
                      (since or "0000", limit))
        return [dict(id=i, at=a, type=t, ref=r, severity=s, title=ti, detail=json.loads(d)) for i, a, t, r, s, ti, d in rows]

    def save_digest(self, kind, data):
        return self.x("INSERT INTO digests(at,kind,data) VALUES(?,?,?)", (data["generated_at"], kind, json.dumps(data)))

    def digests(self, limit=30):
        return [dict(id=i, at=a, kind=k, summary=json.loads(d).get("headline")) for i, a, k, d in
                self.q("SELECT id,at,kind,data FROM digests ORDER BY id DESC LIMIT ?", (limit,))]

    def digest(self, did=None):
        r = self.q("SELECT id,at,kind,data FROM digests WHERE id=?", (did,)) if did else self.q("SELECT id,at,kind,data FROM digests ORDER BY id DESC LIMIT 1")
        return dict(json.loads(r[0][3]), id=r[0][0], kind=r[0][2]) if r else None

    def last_digest_at(self, kind):
        r = self.q("SELECT at FROM digests WHERE kind=? ORDER BY id DESC LIMIT 1", (kind,))
        return r[0][0] if r else None

    # ------------------------------------------------------------- sessions
    def new_session(self, ttl=12 * 3600):
        token = uuid.uuid4().hex + uuid.uuid4().hex
        self.x("INSERT INTO sessions VALUES(?,?,?)", (hashlib.sha256(token.encode()).hexdigest(), time.time(), time.time() + ttl))
        return token

    def valid_session(self, token):
        if not token:
            return False
        r = self.q("SELECT expires_at FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))
        return bool(r and r[0][0] > time.time())

    def end_session(self, token):
        if token:
            self.x("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))


def _clean(k, v):
    """Bound user-supplied values; URLs must be http(s)."""
    if k in ("hidden", "disabled", "favorite", "check_disabled"):
        return bool(v)
    if k == "order":
        return int(v)
    if k in ("tags", "dependencies", "dependencies_user"):
        return [str(t)[:60] for t in (v if isinstance(v, list) else str(v).split(","))][:30]
    if k in ("extra_endpoints", "urls"):
        vals = v if isinstance(v, list) else [x.strip() for x in str(v).splitlines() if x.strip()]
        out = []
        for u in vals[:20]:
            u = str(u).strip()
            if not re.match(r"^https?://[^\s/]+(/[^\s]*)?$", u):
                raise ValueError(f"not an http(s) URL: {u[:80]}")
            out.append(u[:300])
        return out
    if k == "preferred_url":
        u = str(v).strip()
        if not (u.startswith("ep:") or re.match(r"^https?://[^\s/]+(/[^\s]*)?$", u)):
            raise ValueError("preferred_url must be an endpoint id or http(s) URL")
        return u[:300]
    if k == "access":
        if v not in ("lan", "vpn", "external", "unknown"):
            raise ValueError("access must be lan, vpn, external or unknown")
        return v
    if k == "icon":
        s = str(v).strip()
        if not re.match(r"^([a-z0-9-]{1,60}|https?://\S{1,300}|.{1,4})$", s):
            raise ValueError("icon must be a slug, an http(s) image URL, or an emoji")
        return s
    return str(v)[:2000] if k in ("notes", "notes_user", "purpose") else str(v)[:120]
