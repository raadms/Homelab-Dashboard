"""Live read-only API sources: Proxmox VE (PVEAuditor token) and Portainer
(read-only user access tokens).

Tokens live in files outside the project (see README). They are read by the
backend only, sent only to the host they belong to, and never stored in a
snapshot, an export or a log line.

Both produce the same shapes the collector-script parsers produce, so the
inventory builder treats live and script evidence the same way. Live data
wins where both exist because it is fresher; script-only facts (inside-guest
listeners, Caddy config) are kept.
"""
import json
import os
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request

from . import parsers

TOKEN_DIR = os.path.expanduser(os.environ.get("DASH_TOKEN_DIR", "~/.config/homelab-dash"))


def now():
    return time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())


def _read(name):
    try:
        with open(os.path.join(TOKEN_DIR, name)) as f:
            return f.read().strip()
    except OSError:
        return None


def _ctx():
    # Proxmox and Portainer ship self-signed certificates on the LAN. We do not
    # verify the chain, but we only ever send a token to the host it was issued for.
    c = ssl.create_default_context()
    c.check_hostname = False
    c.verify_mode = ssl.CERT_NONE
    return c


def _get(url, headers, timeout=12):
    req = urllib.request.Request(url, headers=dict(headers, Accept="application/json"))
    with urllib.request.urlopen(req, timeout=timeout, context=_ctx()) as r:
        return json.load(r)


def _err(e):
    if isinstance(e, urllib.error.HTTPError):
        return f"HTTP {e.code}" + (" (token lacks permission)" if e.code in (401, 403) else "")
    return type(e).__name__ + ": " + str(getattr(e, "reason", e))[:120]


# ======================================================================= Proxmox

def proxmox(node_ips, token=None):
    """Return (status dict, [runs]) where each run looks like a collect-proxmox run."""
    tok = token or _read("pve_token")
    if not tok:
        return dict(name="Proxmox API", status="not-configured", detail="No Proxmox token saved yet (Admin → Connections)"), []
    if not re.match(r"^[\w.@-]+![\w.-]+=[0-9a-f-]{36}$", tok):
        return dict(name="Proxmox API", status="error", error="The token must look like dashboard@pve!dash=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"), []
    hdr = {"Authorization": "PVEAPIToken=" + tok}
    last_err = None
    for ip in node_ips:
        base = f"https://{ip}:8006/api2/json"
        try:
            res = _get(base + "/cluster/resources", hdr)["data"]
            status = _get(base + "/cluster/status", hdr)["data"]
            break
        except Exception as e:  # noqa: BLE001
            last_err = f"{ip}: {_err(e)}"
    else:
        return dict(name="Proxmox API", status="error", error=last_err), []
    at = now()
    runs = {}
    for n in [r for r in res if r.get("type") == "node"]:
        runs[n["node"]] = dict(collector="proxmox", hostname=n["node"], at=at, live=True, cluster_resources=res,
                               cluster_status=status, guests={}, listeners=[], containers=[], proxy_routes=[], failed=[])
    errors = 0
    for g in [r for r in res if r.get("type") in ("qemu", "lxc") and r.get("node") in runs]:
        node, vmid, kind = g["node"], g["vmid"], g["type"]
        try:
            cfg = _get(f"{base}/nodes/{node}/{kind}/{vmid}/config", hdr)["data"]
        except Exception:  # noqa: BLE001
            cfg, errors = {}, errors + 1
        cfgs = {k: str(v) for k, v in cfg.items() if not re.search(r"pass|key|secret|token", k, re.I)}
        entry = dict(vmid=vmid, type=kind, config_name=cfgs.get("name") or cfgs.get("hostname"),
                     nics=parsers.guest_nics(cfgs), tags=[t for t in re.split(r"[;, ]", cfgs.get("tags", "")) if t],
                     onboot=cfgs.get("onboot") == "1", cores=cfgs.get("cores"), memory=cfgs.get("memory"),
                     template=cfgs.get("template") == "1", ostype=cfgs.get("ostype"), agent_ips=[])
        if g.get("status") == "running":
            try:
                if kind == "lxc":
                    for itf in _get(f"{base}/nodes/{node}/lxc/{vmid}/interfaces", hdr)["data"] or []:
                        if itf.get("inet") and not re.match(r"^(lo|docker|br-|veth|virbr|tailscale|wg)", itf.get("name") or ""):
                            entry["agent_ips"].append(dict(ifname=itf["name"], ip=itf["inet"].split("/")[0], mac=(itf.get("hwaddr") or "").lower()))
                elif cfgs.get("agent", "").startswith("1"):
                    entry["agent_enabled"] = True
                    data = _get(f"{base}/nodes/{node}/qemu/{vmid}/agent/network-get-interfaces", hdr, timeout=6)["data"]
                    entry["agent_ips"] = parsers.agent_ips(json.dumps(data))
            except Exception:  # noqa: BLE001  (agent not running, or no VM.GuestAgent.Audit)
                pass
        runs[node]["guests"][vmid] = entry
    st = dict(name="Proxmox API (PVEAuditor)", status="ok", at=at,
              detail=f"{len(runs)} nodes, {sum(len(r['guests']) for r in runs.values())} guests" + (f", {errors} configs unreadable" if errors else ""))
    return st, list(runs.values())


# ======================================================================= Portainer

def _port_str(ports):
    out = []
    for p in ports or []:
        if p.get("PublicPort"):
            out.append(f"{p.get('IP') or '0.0.0.0'}:{p['PublicPort']}->{p['PrivatePort']}/{p.get('Type', 'tcp')}")
    return ", ".join(out)


def portainer(servers=None):
    """Return (status dict, {host_ip: dict(at, containers, source)})."""
    raw = "\n".join(f"{x['host']}={x['token']}" for x in servers) if servers else _read("portainer_tokens")
    if not raw:
        return dict(name="Portainer API", status="not-configured", detail="No Portainer servers saved yet (Admin → Connections)"), {}
    hosts, errs, at = {}, [], now()
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        pip, token = (x.strip() for x in line.split("=", 1))
        base = f"https://{pip}:9443/api" if ":" not in pip else f"https://{pip}/api"
        hdr = {"X-API-Key": token}
        try:
            eps = _get(base + "/endpoints", hdr)
        except Exception as e:  # noqa: BLE001
            errs.append(f"{pip}: {_err(e)}")
            continue
        for ep in eps:
            url = ep.get("URL") or ""
            m = re.match(r"^(?:tcp|https?)://([^:/]+)", url)
            host_ip = m.group(1) if m else pip.split(":")[0]  # unix:// socket = the Portainer host itself
            try:
                cs = _get(f"{base}/endpoints/{ep['Id']}/docker/containers/json?all=1", hdr)
            except Exception as e:  # noqa: BLE001
                errs.append(f"{pip} env {ep.get('Name')}: {_err(e)}")
                continue
            lines = [json.dumps(dict(Names=(c.get("Names") or [""])[0], Image=c.get("Image"), State=c.get("State"),
                                     Status=c.get("Status"), Ports=_port_str(c.get("Ports")), Labels=c.get("Labels") or {},
                                     Networks=",".join(((c.get("NetworkSettings") or {}).get("Networks") or {}).keys())))
                     for c in cs]
            parsed = parsers.containers("\n".join(lines), "docker")
            for c, rawc in zip(parsed, cs):
                c["started_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(rawc["Created"])) if rawc.get("Created") else None
            hosts[host_ip] = dict(at=at, containers=parsed, source=f"Portainer API {pip} env '{ep.get('Name')}' {at}")
    status = "ok" if hosts and not errs else ("partial" if hosts else "error")
    return dict(name="Portainer API (read-only)", status=status, at=at, error="; ".join(errs)[:400] or None,
                detail=f"{len(hosts)} Docker hosts, {sum(len(h['containers']) for h in hosts.values())} containers"), hosts


def merge_runs(script_runs, api_runs, docker_hosts):
    """Combine collector-script runs with live API data.

    - A live Proxmox run replaces the script run for the same node, but keeps
      the script's inside-guest data and host listeners/proxy config.
    - Live Portainer containers replace script containers for the same host IP.
    """
    by_node = {r["hostname"]: r for r in script_runs if r["collector"] == "proxmox"}
    out = [r for r in script_runs if r["collector"] != "proxmox" or r["hostname"] not in {a["hostname"] for a in api_runs}]
    for a in api_runs:
        s = by_node.get(a["hostname"])
        if s:
            for k in ("listeners", "containers", "proxy_routes", "services", "failed_units", "os", "pveversion", "ips"):
                if s.get(k) and not a.get(k):
                    a[k] = s[k]
            for vmid, g in a["guests"].items():
                sg = (s.get("guests") or {}).get(vmid)
                if sg and sg.get("inside"):
                    g["inside"] = sg["inside"]
                    g["inside_at"] = s["at"]
        out.append(a)
    used = set()
    for r in out:
        for g in (r.get("guests") or {}).values():
            ips = {i["ip"] for i in g.get("agent_ips", [])} | {n["ip"] for n in g.get("nics", []) if n.get("ip")}
            if g.get("inside"):
                ips |= {i["ip"] for i in g["inside"].get("ips", [])}
            for ip in ips & set(docker_hosts):
                g.setdefault("inside", dict(ips=[dict(ip=ip)], listeners=[], services=[], proxy_routes=[], containers=[]))
                g["inside"]["containers"] = docker_hosts[ip]["containers"]
                g["containers_source"] = docker_hosts[ip]["source"]
                used.add(ip)
    for ip, h in docker_hosts.items():
        if ip not in used:  # a Docker host that is not a Proxmox guest we know
            out.append(dict(collector="guest", hostname=ip, at=h["at"], ips=[dict(ip=ip)], containers=h["containers"],
                            listeners=[], services=[], proxy_routes=[], failed=[], live=True))
    return out


# ======================================================================= UniFi

def unifi(host, key, site="default"):
    """Read-only UniFi Network API (X-API-KEY). Returns (status, run-like dict for discovery)."""
    if not key:
        return dict(name="UniFi API", status="not-configured", detail="no API key"), None
    host = host or "10.10.1.1"
    base = f"https://{host}/proxy/network"
    hdr = {"X-API-KEY": key}
    out, errs = {}, []
    for name, path in (("api_rest_networkconf", f"/api/s/{site}/rest/networkconf"), ("api_stat_sta", f"/api/s/{site}/stat/sta"),
                       ("api_rest_user", f"/api/s/{site}/rest/user"), ("v2_static_dns", f"/v2/api/site/{site}/static-dns")):
        try:
            data = _get(base + path, hdr)
            if name == "api_rest_networkconf":  # drop Wi-Fi/VPN secrets before they go anywhere
                for n in data.get("data", []):
                    for k in list(n):
                        if re.search(r"pass|psk|secret|key|x_", k, re.I):
                            n.pop(k)
            out[name] = data
        except Exception as e:  # noqa: BLE001
            errs.append(f"{path.split('/')[-1]}: {_err(e)}")
    if not out:
        return dict(name="UniFi API", status="error", error="; ".join(errs)[:300]), None
    at = now()
    nets = len((out.get("api_rest_networkconf") or {}).get("data") or [])
    users = len((out.get("api_rest_user") or {}).get("data") or [])
    return (dict(name="UniFi API (read-only)", status="ok" if not errs else "partial", at=at, error="; ".join(errs)[:300] or None,
                 detail=f"{nets} networks, {users} known clients"),
            dict(collector="unifi", hostname=host, at=at, live=True, unifi=out, failed=[]))


# ======================================================================= Docker agents

def _sign(key, path):
    import hashlib
    import hmac as _h
    ts = int(time.time())
    return f"HMAC {ts}:" + _h.new(key.encode(), f"{ts}\n{path}".encode(), hashlib.sha256).hexdigest()


def agents(servers):
    """Read-only homelab-dashboard-agent on each Docker host. Returns (status, {host_ip: …})."""
    if not servers:
        return dict(name="Docker agents", status="not-configured", detail="No Docker agents added yet (Admin → Connections)"), {}
    hosts, errs, at = {}, [], now()
    for sv in servers:
        addr = sv["host"] if ":" in sv["host"] else sv["host"] + ":9180"
        path = "/v1/containers"
        try:
            req = urllib.request.Request(f"http://{addr}{path}", headers={"Authorization": _sign(sv["key"], path), "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=10) as r:
                d = json.load(r)
        except Exception as e:  # noqa: BLE001
            errs.append(f"{addr}: {_err(e)}" + (" — the key does not match this agent, or a clock is wrong" if "401" in _err(e) else ""))
            continue
        lines = [json.dumps(dict(Names=(c.get("Names") or [""])[0], Image=c.get("Image"), State=c.get("State"), Status=c.get("Status"),
                                 Ports=_port_str(c.get("Ports")), Labels=c.get("Labels") or {}, Networks=",".join(c.get("Networks") or [])))
                 for c in d.get("containers", [])]
        parsed = parsers.containers("\n".join(lines), "docker")
        for c, raw in zip(parsed, d.get("containers", [])):
            c["started_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(raw["Created"])) if raw.get("Created") else None
        ip = addr.rsplit(":", 1)[0]
        hosts[ip] = dict(at=at, containers=parsed, source=f"Docker agent {addr} ({d.get('hostname', '?')}) {at}")
    status = "ok" if hosts and not errs else ("partial" if hosts else "error")
    return dict(name="Docker agents (read-only)", status=status, at=at, error="; ".join(errs)[:400] or None,
                detail=f"{len(hosts)} of {len(servers)} hosts, {sum(len(h['containers']) for h in hosts.values())} containers"), hosts
