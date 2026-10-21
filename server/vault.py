"""Connection secrets entered in Admin → Connections.

Stored in <data>/secrets.json (mode 600), separate from settings and edits so
that config exports, inventory exports and backups-by-export never include
them. The API never returns a secret: only whether it is set and its last
four characters. Values in token files (~/.config/homelab-dash/…) still work
as a fallback for installs configured before the admin UI existed.
"""
import json
import os
import re
import threading

FIELDS = {
    "proxmox": {"token": r"^[\w.@-]+![\w.-]+=[0-9a-f-]{36}$", "hosts": r"^[\w.:\-, ]{0,300}$"},
    "portainer": {"servers": None},  # list of {host, token}
    "unifi": {"host": r"^[\w.:\-]{1,120}$", "key": r"^[\w\-]{8,200}$", "site": r"^[\w\-]{1,40}$"},
    "agents": {"servers": None},  # list of {host, key}
    "homeassistant": {"url": r"^https?://[\w.:\-/]{3,200}$", "token": r"^[\w.\-]{20,400}$"},
}
SECRET_KEYS = {"token", "key"}
HINT = {
    "proxmox": "dashboard@pve!dash=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "portainer": "10.10.30.30:9443 + ptr_…",
    "unifi": "UniFi API key",
    "homeassistant": "long-lived access token",
}


class Vault:
    def __init__(self, data_dir):
        self.path = os.path.join(data_dir, "secrets.json")
        self.lock = threading.Lock()

    def _load(self):
        try:
            with open(self.path) as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}

    def _save(self, d):
        tmp = self.path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(d, f, indent=1)
        os.chmod(tmp, 0o600)
        os.replace(tmp, self.path)

    def get(self, name):
        return self._load().get(name) or {}

    def set(self, name, values):
        if name not in FIELDS:
            raise KeyError(name)
        cur = self.get(name)
        if name in ("portainer", "agents"):
            sk, label, eg = ("token", "Portainer", "10.10.30.30:9443") if name == "portainer" else ("key", "Docker agent", "10.10.30.30:9180")
            servers = []
            for s in values.get("servers") or []:
                host = str(s.get("host", "")).strip()
                tok = str(s.get(sk, "")).strip()
                if not re.match(r"^[\w.\-]+(:\d+)?$", host):
                    raise ValueError(f"{label} address must look like {eg} (got {host[:40]})")
                old = next((o for o in cur.get("servers", []) if o["host"] == host), None)
                if not tok and old:
                    tok = old[sk]  # unchanged: the UI never receives the stored secret
                rx = r"^[\w.\-=]{10,300}$" if name == "portainer" else r"^[0-9a-f]{32,128}$"
                if not re.match(rx, tok):
                    raise ValueError(f"{label} {'token' if name == 'portainer' else 'key'} for {host} looks wrong")
                servers.append({"host": host, sk: tok})
            new = dict(servers=servers)
        else:
            new = dict(cur)
            for k, rx in FIELDS[name].items():
                if k not in values:
                    continue
                v = str(values[k] or "").strip()
                if k in SECRET_KEYS and not v:
                    continue  # empty secret field = keep the stored one
                if v and rx and not re.match(rx, v):
                    raise ValueError(f"{name} {k} has the wrong format" + (f" (expected e.g. {HINT[name]})" if k in SECRET_KEYS else ""))
                new[k] = v
        with self.lock:
            d = self._load()
            d[name] = new
            self._save(d)

    def delete(self, name):
        with self.lock:
            d = self._load()
            d.pop(name, None)
            self._save(d)

    def public(self):
        """What the browser may see: which fields are set, never the values."""
        d = self._load()
        out = {}
        for name in FIELDS:
            v = d.get(name) or {}
            if name in ("portainer", "agents"):
                sk = "token" if name == "portainer" else "key"
                out[name] = dict(configured=bool(v.get("servers")), servers=[dict(host=s["host"], hint="…" + s[sk][-4:]) for s in v.get("servers", [])])
            else:
                req = SECRET_KEYS & set(FIELDS[name])
                out[name] = dict(configured=all(v.get(k) for k in req) and bool(v),
                                 **{k: (("…" + v[k][-4:]) if k in SECRET_KEYS else v[k]) for k in v if v.get(k)})
        return out
