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
        if name == "portainer":
            servers = []
            for s in values.get("servers") or []:
                host = str(s.get("host", "")).strip()
                tok = str(s.get("token", "")).strip()
                if not re.match(r"^[\w.\-]+(:\d+)?$", host):
                    raise ValueError(f"Portainer address must look like 10.10.30.30:9443 (got {host[:40]})")
                old = next((o for o in cur.get("servers", []) if o["host"] == host), None)
                if not tok and old:
                    tok = old["token"]  # unchanged: the UI never receives the stored token
                if not re.match(r"^[\w.\-=]{10,300}$", tok):
                    raise ValueError(f"Portainer token for {host} looks wrong")
                servers.append(dict(host=host, token=tok))
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
            if name == "portainer":
                out[name] = dict(configured=bool(v.get("servers")), servers=[dict(host=s["host"], hint="…" + s["token"][-4:]) for s in v.get("servers", [])])
            else:
                out[name] = dict(configured=all(v.get(k) for k in SECRET_KEYS & set(FIELDS[name])) and bool(v),
                                 **{k: (("…" + v[k][-4:]) if k in SECRET_KEYS else v[k]) for k in v if v.get(k)})
        return out
