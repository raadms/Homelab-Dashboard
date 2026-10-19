"""Build the discovered inventory from every available source.

Output is *facts only*. User overrides live in a different table and are
merged at read time (see store.merged_inventory), so rediscovery can never
overwrite a manual edit and hiding an entry never touches infrastructure.

Endpoint status vocabulary (strongest first):
  verified    – set later by the health checker after a real response
  configured  – present in DNS or proxy configuration
  discovered  – a listening socket / published container port was observed
  inferred    – only a well-known convention (e.g. Proxmox on 8006); never trusted
"""
import glob
import hashlib
import ipaddress
import json
import os
import re
import socket
import ssl
import tarfile
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from . import catalog, parsers

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")


def eid(*parts):
    return ":".join(str(p) for p in parts)


def ep_id(url):
    return "ep:" + hashlib.sha1(url.encode()).hexdigest()[:12]


def ip_in(ip, subnet):
    try:
        return ipaddress.ip_address(ip) in ipaddress.ip_network(subnet, strict=False)
    except ValueError:
        return False


# ======================================================================= sources

def source_home_assistant(cfg):
    """Read-only GETs to Home Assistant: UniFi clients (via its UniFi integration),
    add-ons (via update/running entities) and integration entries."""
    url, token = cfg.get("ha_url"), cfg.get("ha_token")
    if not url or not token:
        return dict(status="not-configured")
    ctx = ssl.create_default_context()

    def get(path):
        req = urllib.request.Request(url.rstrip("/") + path, headers={"Authorization": "Bearer " + token})
        with urllib.request.urlopen(req, timeout=20, context=ctx) as r:
            return json.load(r)
    try:
        states = get("/api/states")
        conf = get("/api/config")
        entries = get("/api/config/config_entries/entry")
    except Exception as e:  # noqa: BLE001 - reported to the UI
        return dict(status="error", error=type(e).__name__ + ": " + str(e)[:200])
    clients, addons, running = [], [], {}
    for x in states:
        a, e = x["attributes"], x["entity_id"]
        if e.startswith("device_tracker.") and a.get("source_type") == "router":
            nm = (a.get("name") or a.get("friendly_name") or "").strip()
            half = nm[: len(nm) // 2].strip()
            if half and nm == f"{half} {half}":
                nm = half  # HA friendly_name repeats the device name
            clients.append(dict(
                mac=(a.get("mac") or "").lower() or None, ip=a.get("ip"), hostname=a.get("host_name") or None,
                name=nm or None, vendor=a.get("oui") or None,
                vlan=a.get("vlan"), essid=a.get("essid"), wired=not a.get("essid"),
                online=x["state"] == "home", last_changed=x["last_changed"], ha_entity=e))
        elif e.startswith("binary_sensor.") and e.endswith("_running"):
            running[e[len("binary_sensor."):-len("_running")]] = x["state"]
        elif e.startswith("update.") and str(a.get("entity_picture") or "").startswith("/api/hassio/addons/"):
            addons.append(dict(slug=a["entity_picture"].split("/")[4], title=a.get("title"),
                               installed=a.get("installed_version"), latest=a.get("latest_version"),
                               update_available=x["state"] == "on", entity=e))
        elif e in ("update.home_assistant_core_update", "update.home_assistant_operating_system_update"):
            addons.append(dict(slug="_core" if "core" in e else "_os", title=a.get("title"),
                               installed=a.get("installed_version"), latest=a.get("latest_version"),
                               update_available=x["state"] == "on", entity=e))
    for ad in addons:
        k = slug(ad["title"] or "").replace("-", "_")
        ad["running"] = running.get(k)
    ents = [dict(domain=e.get("domain"), title=e.get("title"), state=e.get("state")) for e in entries]
    return dict(status="ok", at=now(), clients=clients, addons=addons, entries=ents,
                internal_url=conf.get("internal_url"), external_url=conf.get("external_url"),
                version=conf.get("version"))


def resolve(name, timeout=3.0):
    """A/AAAA + CNAME via the system resolver. Returns dict or error."""
    socket.setdefaulttimeout(timeout)
    try:
        canon, aliases, addrs = socket.gethostbyname_ex(name)
        return dict(name=name, ok=True, addresses=sorted(set(addrs)),
                    cname=canon if canon != name else None)
    except socket.gaierror as e:
        return dict(name=name, ok=False, error="NXDOMAIN" if e.errno in (socket.EAI_NONAME, -2) else str(e))
    except OSError as e:
        return dict(name=name, ok=False, error=str(e))


def source_dns(names):
    names = sorted(set(n.lower().rstrip(".") for n in names if n and "." in n and "*" not in n))
    with ThreadPoolExecutor(16) as ex:
        res = list(ex.map(resolve, names))
    return dict(status="ok", at=now(), records={r["name"]: r for r in res})


def extract_incoming(incoming, extracted):
    """Unpack collector tarballs (safely) into collected/extracted/."""
    os.makedirs(extracted, exist_ok=True)
    for tgz in sorted(glob.glob(os.path.join(incoming, "*.tar.gz"))):
        try:
            with tarfile.open(tgz) as t:
                members = [m for m in t.getmembers()
                           if m.isreg() or m.isdir()]
                for m in members:
                    if m.name.startswith("/") or ".." in m.name.split("/"):
                        raise ValueError("unsafe path in archive")
                t.extractall(extracted, members=members, filter="data")
        except (tarfile.TarError, ValueError, OSError):
            continue
    return sorted(d for d in glob.glob(os.path.join(extracted, "*")) if os.path.isdir(d))


def source_collected(extracted_dirs):
    """Parse every collector folder. Newest run per (collector, host) wins."""
    latest = {}
    for d in extracted_dirs:
        m = parsers.meta(d)
        key = (m.get("collector"), m.get("hostname"))
        if not m.get("collector"):
            continue
        if key not in latest or m.get("collected_at_utc", "") > latest[key][0].get("collected_at_utc", ""):
            latest[key] = (m, d)
    runs = []
    for (collector, host), (m, d) in sorted(latest.items(), key=lambda kv: str(kv[0])):
        run = dict(collector=collector, hostname=host, at=m.get("collected_at_utc"), dir=os.path.basename(d),
                   failed=[r["name"] for r in parsers.manifest(d) if r["exit"] not in ("0",)])
        R = lambda n: parsers._read(d, n)  # noqa: E731
        if collector in ("guest", "proxmox"):
            run["ips"] = parsers.ips_from_ip_json(R("ip_addr_json")) or parsers.ips_from_ip_brief(R("ip_addr"))
            run["listeners"] = parsers.listeners(R("listening"))
            run["services"] = parsers.systemd_units(R("systemd_running"))
            run["failed_units"] = parsers.systemd_units(R("systemd_failed"))
            run["os"] = (re.search(r'PRETTY_NAME="([^"]+)"', R("os_release")) or [None, None])[1]
            run["containers"] = []
            for eng in ("docker", "podman"):
                cs = parsers.containers(R(f"{eng}_ps"), eng)
                extra = parsers.inspect_extra(R(f"{eng}_inspect"))
                for c in cs:
                    c.update(extra.get(c["name"], {}))
                run["containers"] += cs
            run["proxy_routes"] = []
            caddy_rt = parsers._json(R("caddy_runtime_config"))
            if caddy_rt:
                run["proxy_routes"] += [dict(r, proxy="caddy", proxy_source="caddy admin API (runtime)") for r in parsers.caddy_json_routes(caddy_rt)]
            elif R("caddy_caddyfile").strip():
                run["proxy_routes"] += [dict(r, proxy="caddy", proxy_source="Caddyfile") for r in parsers.caddyfile_routes(R("caddy_caddyfile"))]
            if R("nginx_config").strip():
                run["proxy_routes"] += [dict(r, proxy="nginx", proxy_source="nginx -T") for r in parsers.nginx_routes(R("nginx_config"))]
            if R("traefik_api").strip():
                run["proxy_routes"] += [dict(r, proxy="traefik", proxy_source="traefik API") for r in parsers.traefik_routes(R("traefik_api"))]
            for f in glob.glob(os.path.join(d, "proxy_*.txt")):
                txt = open(f, encoding="utf-8", errors="replace").read()
                cj = parsers._json(txt[txt.find("{\"apps\""):] if "{\"apps\"" in txt else "")
                if cj:
                    run["proxy_routes"] += [dict(r, proxy="caddy", proxy_source="caddy in container (runtime)") for r in parsers.caddy_json_routes(cj)]
                else:
                    run["proxy_routes"] += [dict(r, proxy="caddy", proxy_source="Caddyfile in container") for r in parsers.caddyfile_routes(txt)]
                    run["proxy_routes"] += [dict(r, proxy="nginx", proxy_source="nginx in container") for r in parsers.nginx_routes(txt)]
        if collector == "proxmox":
            res = parsers._json(R("cluster_resources")) or []
            run["cluster_resources"] = res if isinstance(res, list) else []
            st = parsers._json(R("cluster_status")) or []
            run["cluster_status"] = st if isinstance(st, list) else []
            run["pveversion"] = (R("pveversion").splitlines() or [""])[0]
            run["guests"] = {}
            for f in glob.glob(os.path.join(d, "*_config.txt")):
                b = os.path.basename(f)
                mm = re.match(r"^(qm|pct)_(\d+)_config\.txt$", b)
                if not mm:
                    continue
                kind, vmid = mm.group(1), int(mm.group(2))
                cfgd = parsers.kv_config(R(f"{kind}_{vmid}_config"))
                g = dict(vmid=vmid, type="qemu" if kind == "qm" else "lxc", config_name=cfgd.get("name") or cfgd.get("hostname"),
                         nics=parsers.guest_nics(cfgd), tags=[t for t in re.split(r"[;, ]", cfgd.get("tags", "")) if t],
                         onboot=cfgd.get("onboot") == "1", cores=cfgd.get("cores"), memory=cfgd.get("memory"),
                         template=cfgd.get("template") == "1", ostype=cfgd.get("ostype"))
                if kind == "qm":
                    g["agent_ips"] = parsers.agent_ips(R(f"qm_{vmid}_agent_net"))
                    g["agent_enabled"] = cfgd.get("agent", "").startswith("1")
                    ge = parsers._json(R(f"qm_{vmid}_inside")) or {}
                    inside = parsers.sections(ge.get("out-data", "") if isinstance(ge, dict) else "")
                else:
                    inside = parsers.sections(R(f"pct_{vmid}_inside"))
                if inside is not None:
                    if inside:
                        g["inside"] = dict(
                            ips=parsers.ips_from_ip_brief(inside.get("ip", "")),
                            listeners=parsers.listeners(inside.get("listening", "")),
                            services=parsers.systemd_units(inside.get("services", "")),
                            containers=parsers.containers(inside.get("docker ps", ""), "docker") + parsers.containers(inside.get("podman ps", ""), "podman"),
                            proxy_routes=[dict(r, proxy="caddy", proxy_source="Caddyfile (in LXC)") for r in parsers.caddyfile_routes(inside.get("caddy", ""))]
                                         + [dict(r, proxy="nginx", proxy_source="nginx -T (in LXC)") for r in parsers.nginx_routes(inside.get("nginx", ""))])
                        cj = parsers._json(inside.get("caddy", "")[inside.get("caddy", "").find("{\"apps\""):]) if "{\"apps\"" in inside.get("caddy", "") else None
                        if cj:
                            g["inside"]["proxy_routes"] = [dict(r, proxy="caddy", proxy_source="caddy admin API (in LXC)") for r in parsers.caddy_json_routes(cj)]
                run["guests"][vmid] = g
        if collector == "unifi":
            run["unifi"] = {n: parsers._json(R(n)) for n in (
                "api_rest_networkconf", "api_stat_sta", "api_rest_user", "api_stat_device", "api_rest_portforward",
                "v2_static_dns", "v2_clients_history", "v2_clients_active", "api_stat_sysinfo")}
        if collector and collector.startswith("endpoints"):
            run["location"] = collector.split("-", 1)[1] if "-" in collector else "lan"
            run["public_ip"] = R("public_ip").strip()[:64]
            run["checks"] = []
            for f in sorted(glob.glob(os.path.join(d, "t*_http.txt"))):
                n = os.path.basename(f)[:-9]
                kv = dict(l.split("=", 1) for l in R(n + "_http").splitlines() if "=" in l)
                tls = R(n + "_tls")
                exp = re.search(r"expire date:\s*(.+)", tls)
                run["checks"].append(dict(url=kv.get("url"), code=kv.get("code"), final=kv.get("final"),
                                          ip=kv.get("ip"), redirects=kv.get("redirects"),
                                          tls_expires=exp.group(1).strip() if exp else None,
                                          dns=R(n + "_dns").strip().splitlines()[1:]))
        runs.append(run)
    return dict(status="ok" if runs else "none", runs=runs)


# ======================================================================= build

class Builder:
    def __init__(self, seed):
        self.seed = seed
        self.nodes, self.workloads, self.containers, self.devices = {}, {}, {}, {}
        self.apps, self.domains, self.routes, self.issues = {}, {}, [], []
        self.networks = [dict(n, source="observed client VLANs (names inferred)") for n in seed.get("networks", [])]
        self.dhcp_names = set()
        self.ip_index = {}   # ip -> {"device":id, "workload":id, "node":id}
        self.sources = []

    # ---------------------------------------------------------------- helpers
    def vlan_of(self, ip):
        for n in self.networks:
            if ip and ip_in(ip, n["subnet"]):
                return n.get("vlan")
        return None

    def index_ip(self, ip, **refs):
        if not ip:
            return
        self.ip_index.setdefault(ip, {}).update({k: v for k, v in refs.items() if v})

    def app(self, aid, **kw):
        a = self.apps.get(aid)
        if not a:
            a = dict(id=aid, aliases=[aid], endpoints=[], sources=[], notes=[], dependencies=[], mgmt_links=[],
                     location={}, runtime={}, confidence="low")
            self.apps[aid] = a
        for k, v in kw.items():
            if v is None:
                continue
            if k in ("sources", "notes", "dependencies", "aliases"):
                for x in (v if isinstance(v, list) else [v]):
                    if x not in a[k]:
                        a[k].append(x)
            elif k == "location":
                a["location"].update({kk: vv for kk, vv in v.items() if vv})
            elif k == "runtime":
                a["runtime"].update(v)
            elif not a.get(k) or k in ("confidence",):
                a[k] = v
        return a

    def endpoint(self, a, url, kind, status, source, **kw):
        rank = dict(inferred=0, discovered=1, configured=2, verified=3)
        for e in a["endpoints"]:
            if e["url"] == url:
                if rank[status] > rank[e["status"]]:
                    e["status"] = status
                if source not in e["sources"]:
                    e["sources"].append(source)
                for k, v in kw.items():
                    if v is not None and not e.get(k):
                        e[k] = v
                return e
        m = re.match(r"^(\w+)://([^/:]+)(?::(\d+))?(/.*)?$", url)
        scheme, host, port, path = (m.group(1), m.group(2), m.group(3), m.group(4) or "/") if m else (None, None, None, "/")
        port = int(port) if port else (443 if scheme == "https" else 80 if scheme == "http" else None)
        e = dict(id=ep_id(url), url=url, kind=kind, scheme=scheme, host=host, port=port, path=path,
                 status=status, sources=[source], access="unknown", ip=kw.pop("ip", None))
        e.update({k: v for k, v in kw.items() if v is not None})
        if kind == "ip" and not e.get("ip"):
            e["ip"] = host
        e["vlan"] = self.vlan_of(e.get("ip"))
        a["endpoints"].append(e)
        return e

    def issue(self, severity, type_, title, evidence, suggestion, ref=None, hypothesis=None):
        iid = "iss:" + hashlib.sha1((type_ + "|" + (ref or title)).encode()).hexdigest()[:10]
        if any(i["id"] == iid for i in self.issues):
            return
        self.issues.append(dict(id=iid, severity=severity, type=type_, title=title, evidence=evidence,
                                suggestion=suggestion, ref=ref, hypothesis=hypothesis))

    # ---------------------------------------------------------------- devices
    def add_unifi_clients(self, clients, source):
        for c in clients:
            key = c.get("mac") or c.get("ip") or c.get("hostname")
            if not key:
                continue
            did = eid("dev", key)
            d = self.devices.get(did) or dict(id=did, sources=[])
            for k in ("mac", "ip", "hostname", "name", "vendor", "essid", "wired", "online", "last_changed", "ha_entity", "first_seen", "last_seen", "fixed_ip", "note", "network"):
                if c.get(k) is not None and d.get(k) in (None, ""):
                    d[k] = c[k]
            if c.get("online"):
                d["online"] = True
            d["vlan"] = c.get("vlan") if c.get("vlan") is not None else d.get("vlan") or self.vlan_of(d.get("ip"))
            if source not in d["sources"]:
                d["sources"].append(source)
            ip_ok = d.get("ip") and re.match(r"^\d+\.\d+\.\d+\.\d+$", d["ip"])
            if d.get("ip") and not ip_ok:
                d["ipv6_only"] = True
            self.devices[did] = d
            if ip_ok:
                self.index_ip(d["ip"], device=did)

    def classify_devices(self):
        """Give devices a role from vendor/name evidence (labelled as inference)."""
        for d in self.devices.values():
            txt = " ".join(str(d.get(k) or "") for k in ("name", "hostname", "vendor"))
            role = None
            if re.search(r"Proxmox Server Solutions", d.get("vendor") or ""):
                role = "proxmox-guest"  # MAC prefix BC:24:11 is assigned to Proxmox virtual NICs
            if re.search(r"USW|U6|U7|UCG|Cloud Gateway|UA Hub|Doorbell|g6-instant|UniFi", txt, re.I):
                role = "unifi-device"
            elif re.search(r"Hikvision", txt, re.I):
                role = "camera"
            elif re.search(r"GREE|Zhuhai Ewpe", txt, re.I):
                role = "iot-climate"
            elif re.search(r"iPhone|iPad|Watch|Mac|Laptop|AppleTV|HomePod|LG", txt) and role != "proxmox-guest":
                role = "client"
            elif re.search(r"idrac", txt, re.I):
                role = "server-oob"
            elif re.search(r"pikvm", txt, re.I):
                role = "kvm"
            elif re.search(r"Raspberry Pi", txt, re.I):
                role = "raspberry-pi"
            elif re.search(r"Espressif|athom|wled|meross|yeelink|SLZB", txt, re.I):
                role = "iot"
            d["role"] = d.get("role") or role or "unknown"

    # ---------------------------------------------------------------- proxmox
    def add_seed_nodes(self):
        for n in self.seed.get("proxmox_nodes", []):
            nid = eid("node", n["name"])
            self.nodes[nid] = dict(id=nid, name=n["name"], ip=n["ip"], kind="proxmox", cluster=self.seed.get("cluster"),
                                   status="unknown", sources=["user-provided (last known)"], verified=False)
            self.index_ip(n["ip"], node=nid)

    def add_proxmox_run(self, run):
        src = f"collect-proxmox@{run['hostname']} {run['at']}"
        res = run.get("cluster_resources") or []
        for r in res:
            if r.get("type") == "node":
                nid = eid("node", r["node"])
                n = self.nodes.setdefault(nid, dict(id=nid, name=r["node"], kind="proxmox", sources=[]))
                n.update(status=r.get("status"), cpu=r.get("cpu"), maxcpu=r.get("maxcpu"), mem=r.get("mem"),
                         maxmem=r.get("maxmem"), disk=r.get("disk"), maxdisk=r.get("maxdisk"), uptime=r.get("uptime"),
                         verified=True)
                if src not in n["sources"]:
                    n["sources"].append(src)
            elif r.get("type") in ("qemu", "lxc"):
                wid = eid("wl", r["node"], r["vmid"])
                w = self.workloads.setdefault(wid, dict(id=wid, sources=[]))
                w.update(kind="vm" if r["type"] == "qemu" else "lxc", vmid=r["vmid"], name=r.get("name"),
                         node=r["node"], node_id=eid("node", r["node"]), status=r.get("status"),
                         uptime=r.get("uptime"), cpu=r.get("cpu"), maxcpu=r.get("maxcpu"), mem=r.get("mem"),
                         maxmem=r.get("maxmem"), template=bool(r.get("template")), tags=r.get("tags"), hastate=r.get("hastate"))
                if src not in w["sources"]:
                    w["sources"].append(src)
            elif r.get("type") == "storage":
                pass
        for s in run.get("cluster_status") or []:
            if s.get("type") == "cluster":
                for n in self.nodes.values():
                    n["cluster"] = s.get("name")
                    n["quorate"] = s.get("quorate")
            if s.get("type") == "node":
                nid = eid("node", s["name"])
                if nid in self.nodes:
                    self.nodes[nid]["ip"] = s.get("ip") or self.nodes[nid].get("ip")
                    self.nodes[nid]["online"] = bool(s.get("online"))
                    self.index_ip(self.nodes[nid]["ip"], node=nid)
        # local host facts (listeners, containers on the host itself)
        local = next((n for n in self.nodes.values() if n["name"] == run["hostname"] or n["name"] == run["hostname"].split(".")[0]), None)
        if local:
            local.update(pveversion=run.get("pveversion"), os=run.get("os"), host_services=run.get("services"),
                         failed_units=run.get("failed_units"))
            self.add_host_runtime(run, host_ref=dict(node=local["id"]), host_ip=local.get("ip"), src=src, label=local["name"])
        # guest configs (present on the node that owns them)
        for vmid, g in (run.get("guests") or {}).items():
            w = next((w for w in self.workloads.values() if w.get("vmid") == vmid), None)
            if not w:
                wid = eid("wl", run["hostname"], vmid)
                w = self.workloads.setdefault(wid, dict(id=wid, vmid=vmid, node=run["hostname"], node_id=eid("node", run["hostname"]),
                                                         kind="vm" if g["type"] == "qemu" else "lxc", status="unknown", sources=[src]))
            w.update(nics=g["nics"], onboot=g["onboot"], cores=g.get("cores"), memory=g.get("memory"),
                     config_name=g.get("config_name"), ostype=g.get("ostype"), agent_enabled=g.get("agent_enabled"))
            ips = [n["ip"] for n in g["nics"] if n.get("ip")] + [a["ip"] for a in g.get("agent_ips", [])]
            if g.get("inside"):
                ips += [i["ip"] for i in g["inside"]["ips"]]
            w["ips"] = sorted(set(ips))
            for ip in w["ips"]:
                self.index_ip(ip, workload=w["id"])
            if g.get("inside"):
                fake = dict(listeners=g["inside"]["listeners"], containers=g["inside"]["containers"],
                            proxy_routes=g["inside"]["proxy_routes"], services=g["inside"]["services"])
                w["services"] = g["inside"]["services"]
                self.add_host_runtime(fake, host_ref=dict(workload=w["id"], node=w["node_id"]),
                                      host_ip=(w["ips"] or [None])[0], src=src + f" (pct exec {vmid})", label=w.get("name"))

    def link_workloads_to_devices(self):
        mac_to_dev = {d.get("mac"): d for d in self.devices.values() if d.get("mac")}
        for w in self.workloads.values():
            for n in w.get("nics", []):
                d = mac_to_dev.get(n.get("mac"))
                if d:
                    d["workload_id"] = w["id"]
                    w.setdefault("device_ids", []).append(d["id"])
                    if d.get("ip") and d["ip"] not in w.setdefault("ips", []):
                        w["ips"].append(d["ip"])
                        self.index_ip(d["ip"], workload=w["id"])
                    if n.get("vlan") is None and d.get("vlan") is not None:
                        n["vlan_observed"] = d["vlan"]
            w["vlans"] = sorted({str(n.get("vlan") or n.get("vlan_observed") or "") for n in w.get("nics", [])} - {""})
            if not w["vlans"] and w.get("ips"):
                w["vlans"] = sorted({str(self.vlan_of(i)) for i in w["ips"] if self.vlan_of(i) is not None})
        for n in self.nodes.values():
            d = next((d for d in self.devices.values() if d.get("ip") == n.get("ip")), None)
            if d:
                d["node_id"] = n["id"]
                n["device_id"] = d["id"]
                n.setdefault("vendor", d.get("vendor"))
                n["seen_by_unifi"] = d.get("online")

    # ---------------------------------------------------------------- runtime on a host
    def add_guest_run(self, run):
        src = f"collect-guest@{run['hostname']} {run['at']}"
        ips = [i["ip"] for i in run.get("ips", [])]
        ref = {}
        for ip in ips:
            r = self.ip_index.get(ip, {})
            ref.update({k: v for k, v in r.items() if k in ("workload", "node", "device")})
        if not ref:
            # A host we do not otherwise know: register as a standalone device
            did = eid("dev", "host", slug(run["hostname"]))
            self.devices[did] = dict(id=did, name=run["hostname"], hostname=run["hostname"], ip=(ips or [None])[0],
                                     role="server", online=True, sources=[src], vlan=self.vlan_of((ips or [None])[0]))
            ref = dict(device=did)
        target = self.workloads.get(ref.get("workload")) or self.devices.get(ref.get("device"))
        if target is not None:
            target.update(os=run.get("os"), services=run.get("services"), failed_units=run.get("failed_units"),
                          guest_collected_at=run["at"], guest_hostname=run["hostname"])
        self.add_host_runtime(run, host_ref=ref, host_ip=(ips or [None])[0], src=src, label=run["hostname"])

    def add_host_runtime(self, run, host_ref, host_ip, src, label):
        host_key = host_ref.get("workload") or host_ref.get("device") or host_ref.get("node")
        loc = dict(node_id=host_ref.get("node"), workload_id=host_ref.get("workload"), device_id=host_ref.get("device"), host_ip=host_ip, host_label=label)
        if host_ref.get("workload") and host_ref["workload"] in self.workloads:
            loc["node_id"] = self.workloads[host_ref["workload"]].get("node_id")
        published = {}
        for c in run.get("containers") or []:
            cid = eid("ct", host_key, c["name"])
            self.containers[cid] = dict(c, id=cid, host_id=host_key, host_ip=host_ip, host_label=label, sources=[src])
            key = catalog.match(catalog.IMAGE_PATTERNS, c["image"]) or catalog.match(catalog.IMAGE_PATTERNS, c["name"])
            inf = catalog.info(key) if key else None
            web_ports = [p for p in c["ports"] if p["proto"] == "tcp" and p["host_port"] not in catalog.NON_HTTP_PORTS]
            if not inf and not web_ports:
                continue  # sidecar / db / worker: shown under the container, not as an app
            aid = eid("app", "ct", host_key, c["name"])
            a = self.app(aid, name=(inf or {}).get("name") or c["name"], category=(inf or {}).get("category") or "Other",
                         icon=(inf or {}).get("icon"), purpose=(inf or {}).get("purpose"), catalog_key=key,
                         location=dict(loc, container_id=cid, compose_project=c.get("compose_project"), compose_service=c.get("compose_service")),
                         runtime=dict(state=c["state"], status=c.get("status"), restarts=c.get("restarts"), started_at=c.get("started_at"), health=c.get("health")),
                         sources=src, confidence="high" if inf else "medium", sensitive=(inf or {}).get("sensitive", False))
            for p in web_ports:
                published[p["host_port"]] = aid
                if host_ip:
                    scheme = (inf or {}).get("scheme") if (inf and inf.get("port") == p["container_port"]) else None
                    path = (inf or {}).get("path") if scheme else "/"
                    scheme = scheme or ("https" if p["container_port"] in (443, 8443, 9443, 10443) else "http")
                    url = f"{scheme}://{host_ip}:{p['host_port']}{path or '/'}"
                    self.endpoint(a, url, "ip", "discovered", src + " (published port)", ip=host_ip,
                                  container_port=p["container_port"], scheme_guessed=True)
        for l in run.get("listeners") or []:
            if l["proto"] != "tcp" or l["port"] in catalog.NON_HTTP_PORTS:
                continue
            if l["port"] in published:
                continue
            if l["process"] in ("docker-proxy", "rootlessport", "conmon"):
                continue
            key = catalog.match(catalog.PROCESS_PATTERNS, l["process"] or "")
            if not key:
                continue  # unknown process on an unknown port: not assumed to be a web app
            inf = catalog.info(key)
            aid = eid("app", "svc", host_key, key)
            a = self.app(aid, name=inf["name"], category=inf["category"], icon=inf["icon"], purpose=inf["purpose"],
                         catalog_key=key, location=loc, runtime=dict(state="running", process=l["process"]),
                         sources=src, confidence="high", sensitive=inf["sensitive"])
            if host_ip and inf["scheme"]:
                scheme = inf["scheme"] if l["port"] == inf["port"] else ("https" if l["port"] in (443, 8443, 8006, 8007, 9443) else "http")
                self.endpoint(a, f"{scheme}://{host_ip}:{l['port']}{inf['path'] if l['port'] == inf['port'] else '/'}",
                              "ip", "discovered", src + f" (listening, {l['process']})", ip=host_ip, scheme_guessed=l["port"] != inf["port"])
        for r in run.get("proxy_routes") or []:
            self.routes.append(dict(r, proxy_host_id=host_key, proxy_ip=host_ip, proxy_label=label, source=src))

    # ---------------------------------------------------------------- HA
    def add_home_assistant(self, ha):
        if ha.get("status") != "ok":
            return
        src = f"home-assistant API {ha['at']}"
        dev = self.ip_index.get("10.10.1.10", {}).get("device")
        ha_url = ha.get("internal_url")
        aid = eid("app", "ha", "main")
        a = self.app(aid, name="Home Assistant", category="Home", icon="home-assistant", purpose="Home automation (Home Assistant Yellow)",
                     catalog_key="homeassistant", location=dict(device_id=dev, host_ip="10.10.1.10", host_label="Home Assistant Yellow"),
                     runtime=dict(state="running", version=ha.get("version")), sources=src, confidence="high")
        if ha_url:
            self.endpoint(a, ha_url.rstrip("/") + "/", "domain", "configured", src + " (internal_url)", ip="10.10.1.10")
        if any(x["slug"] == "core_nginx_proxy" for x in ha["addons"]):
            # The NGINX SSL proxy add-on serves HTTPS on 443 of the HA host; the
            # certificate is issued for the domain, so the IP form shows a name mismatch.
            self.endpoint(a, "https://10.10.1.10/", "ip", "discovered", src + " (NGINX SSL proxy add-on on :443)",
                          ip="10.10.1.10", note="Certificate is for ha.safrani.co; the browser will warn on the IP URL")
        a["notes"].append("Nabu Casa remote access is configured in HA; external access through it is not tested by this collector.")
        core = next((x for x in ha["addons"] if x["slug"] == "_core"), None)
        if core and core["update_available"]:
            a["runtime"]["update"] = f"{core['installed']} → {core['latest']}"
        ingress = {"45df7312_zigbee2mqtt": ("zigbee2mqtt", "Zigbee2MQTT", "Home"),
                   "09e60fb6_scrypted": ("scrypted", "Scrypted", "Security"),
                   "d5369777_music_assistant": ("music-assistant", "Music Assistant", "Media"),
                   "core_configurator": ("home-assistant", "File editor (HA)", "Home"),
                   "core_ssh": ("home-assistant", "Terminal & SSH (HA)", "Home")}
        for ad in ha["addons"]:
            if ad["slug"].startswith("_"):
                continue
            k = ingress.get(ad["slug"])
            no_ui = ad["slug"] in ("core_silabs_flasher", "81bc2df9_sonoff_dongle_flasher_for_ihost", "cb646a50_get", "core_letsencrypt")
            sub = self.app(eid("app", "ha-addon", ad["slug"]), name=k[1] if k else ad["title"], category=k[2] if k else "Home",
                           icon=(k[0] if k else "home-assistant"), purpose="Home Assistant add-on",
                           location=dict(device_id=dev, host_ip="10.10.1.10", host_label="Home Assistant Yellow", addon=ad["slug"]),
                           runtime=dict(state={"on": "running", "off": "stopped"}.get(ad.get("running"), "unknown"),
                                        version=ad["installed"], update=(f"{ad['installed']} → {ad['latest']}" if ad["update_available"] else None)),
                           sources=src, confidence="high", dependencies=[aid], kind="addon", default_hidden=no_ui)
            if k and ha_url:
                # HA 2026.x serves add-on UIs at /app/<slug> (the old /hassio/ingress/ path returns 404).
                self.endpoint(sub, f"{ha_url.rstrip('/')}/app/{ad['slug']}", "domain", "configured",
                              src + " (HA add-on panel; needs HA login)", ip="10.10.1.10", auth="ha-login")
            if ha_url:
                sub["mgmt_links"].append(dict(label="Add-on settings in HA", url=f"{ha_url.rstrip('/')}/config/app/{ad['slug']}/info"))
            if ad.get("running") is None and k is None:
                sub["notes"].append("Running state not exposed by HA for this add-on.")
        broken = [e for e in ha["entries"] if e["state"] in ("setup_retry", "setup_error", "failed_unload")]
        for e in broken:
            self.issue("medium", "integration-failing", f"HA integration '{e['title'] or e['domain']}' is in {e['state']}",
                       [f"config entry {e['domain']} state={e['state']} ({src})"],
                       "Open HA → Settings → Devices & services and check the integration's error. The device may be offline or moved.",
                       ref="ha-entry:" + (e["title"] or e["domain"]),
                       hypothesis="The device it talks to is likely powered off or changed IP (not confirmed).")
        frig = next((e for e in ha["entries"] if e["domain"] == "frigate"), None)
        if frig:
            self.extra_domains.add(frig["title"])
            a["dependencies"].append("frigate:" + frig["title"])

    # ---------------------------------------------------------------- standalone devices → apps
    def device_apps(self):
        """Management/web apps on standalone devices. URL is *inferred* unless
        DNS/proxy/listener evidence upgrades it."""
        rules = [
            (r"^Proxmox$|WIN-T89U51RJ547", None),  # handled by node logic
            (r"idrac", "idrac"), (r"pikvm", "pikvm"), (r"NAS|Truenas", "truenas"), (r"wled", "wled"),
            (r"SLZB", "slzb"), (r"Home Assistant QA", "homeassistant"), (r"Caddy-Proxy|^proxy$", "caddy"),
            (r"thread-route-manager", "otbr"), (r"Arr-Stack|^arr$", None), (r"Mediaserver", None),
        ]
        for d in self.devices.values():
            txt = f"{d.get('name') or ''} {d.get('hostname') or ''}"
            for rx, key in rules:
                if not re.search(rx, txt, re.I) or not key:
                    continue
                inf = catalog.info(key)
                if not d.get("ip") or d.get("ipv6_only"):
                    continue
                where = self.ip_index.get(d["ip"], {})
                aid = eid("app", "dev", d["id"].split(":", 1)[1], key)
                nm = inf["name"] if key not in ("truenas", "homeassistant", "caddy") else f"{inf['name']} ({d.get('name') or d.get('hostname')})"
                a = self.app(aid, name=nm, category=inf["category"], icon=inf["icon"], purpose=inf["purpose"], catalog_key=key,
                             location=dict(device_id=d["id"], workload_id=where.get("workload"), host_ip=d["ip"], host_label=d.get("name")),
                             runtime=dict(state="device-online" if d.get("online") else "device-offline"),
                             sources=d["sources"][0] + " (device name/vendor; URL by convention)", confidence="low",
                             sensitive=inf["sensitive"])
                if inf["scheme"]:
                    port = "" if inf["port"] in (80, 443) else f":{inf['port']}"
                    self.endpoint(a, f"{inf['scheme']}://{d['ip']}{port}{inf['path']}", "ip", "inferred",
                                  "convention for " + inf["name"], ip=d["ip"])
                break
        gw = next((d for d in self.devices.values() if re.search(r"Cloud Gateway", d.get("name") or "")), None)
        if gw:
            gw["role"] = "gateway"
            gw["lan_ips"] = [n["subnet"].rsplit(".", 1)[0] + ".1" for n in self.networks if n.get("subnet", "").startswith("10.10.")]
            for ip in gw["lan_ips"]:
                self.index_ip(ip, device=gw["id"])
            a = self.app(eid("app", "unifi", "gateway"), name="UniFi Network", category="Network", icon="ubiquiti-unifi",
                         purpose="Cloud Gateway Fiber: network, Protect, Access", catalog_key="unifi",
                         location=dict(device_id=gw["id"], host_ip="10.10.1.1", host_label="Cloud Gateway Fiber"),
                         runtime=dict(state="device-online" if gw.get("online") else "unknown"),
                         sources=gw["sources"][0], confidence="medium", sensitive=True)
            self.endpoint(a, "https://10.10.1.1/", "ip", "inferred", "UniFi OS console on the default LAN gateway", ip="10.10.1.1")
            self.endpoint(a, "https://10.10.1.1/protect/", "ip", "inferred", "UniFi Protect path on the console", ip="10.10.1.1")
            a["notes"].append("The gateway answers on 8443/9443 from VLAN 35 but refuses 443 there; use it from VLAN 1 or via unifi.safrani.co.")
        for n in self.nodes.values():
            aid = eid("app", "pve", n["name"])
            a = self.app(aid, name=f"Proxmox VE — {n['name']}", category="Infrastructure", icon="proxmox",
                         purpose="Hypervisor web UI", catalog_key="proxmox",
                         location=dict(node_id=n["id"], host_ip=n.get("ip"), host_label=n["name"]),
                         runtime=dict(state=n.get("status") or "unknown"), sources=n["sources"][0],
                         confidence="high" if n.get("verified") else "medium", sensitive=True)
            if n.get("ip"):
                st = "discovered" if any(l.get("process") == "pveproxy" for l in (n.get("listeners") or [])) else "inferred"
                self.endpoint(a, f"https://{n['ip']}:8006/", "ip", st, "Proxmox default port 8006", ip=n["ip"])

    # ---------------------------------------------------------------- DNS + routes
    def attach_routes(self):
        """Route domain → proxy → upstream onto the app behind the upstream."""
        by_upstream = {}
        for a in self.apps.values():
            for e in a["endpoints"]:
                if e.get("kind") == "ip" and e.get("ip") and e.get("port"):
                    by_upstream[f"{e['ip']}:{e['port']}"] = a
        for r in self.routes:
            r["id"] = "rt:" + hashlib.sha1(json.dumps([r.get("hosts"), r.get("paths"), r.get("upstreams"), r.get("proxy_ip")]).encode()).hexdigest()[:10]
            r["upstream_status"] = "unknown"
            for up in r.get("upstreams") or []:
                hostport = up.split("/")[0]
                if ":" not in hostport:
                    hostport += ":80"
                h, p = hostport.rsplit(":", 1)
                if h in ("localhost", "127.0.0.1"):
                    h = r.get("proxy_ip") or h
                target = by_upstream.get(f"{h}:{p}")
                if not target:
                    # container-name upstream on the proxy's own docker network
                    target = next((a for a in self.apps.values() if a["location"].get("container_id", "").endswith(":" + h)), None)
                r["upstream_app"] = target["id"] if target else None
                r["upstream_status"] = "matched" if target else ("unmatched-unknown-host" if h not in self.ip_index else "unmatched-no-listener")
            for host in r.get("hosts") or []:
                if host in ("*", "_", "") or host.startswith(":"):
                    continue
                self.extra_domains.add(host.lstrip("*."))
                path = (r.get("paths") or ["/"])[0].rstrip("*") or "/"
                url = f"https://{host}{path if path.endswith('/') else path + '/'}" if r.get("action") != "redirect" else f"https://{host}{path}"
                if r.get("action") == "reverse_proxy":
                    a = self.apps.get(r.get("upstream_app")) if r.get("upstream_app") else None
                    if not a:
                        key = catalog.match(catalog.HOSTNAME_PATTERNS, host.split(".")[0])
                        inf = catalog.info(key) if key else None
                        a = self.app(eid("app", "dom", host), name=(inf or {}).get("name") or host.split(".")[0].title(),
                                     category=(inf or {}).get("category") or "Other", icon=(inf or {}).get("icon"),
                                     purpose=(inf or {}).get("purpose"), catalog_key=key,
                                     location=dict(host_label="behind " + (r.get("proxy_label") or "proxy")),
                                     sources=r["source"], confidence="medium")
                    a["aliases"].append(eid("app", "dom", host)) if eid("app", "dom", host) not in a["aliases"] else None
                    self.endpoint(a, url, "domain", "configured", f"{r['proxy']} route ({r['proxy_source']})",
                                  proxy=r["proxy"], proxy_ip=r.get("proxy_ip"), upstream=", ".join(r.get("upstreams") or []),
                                  route_id=r["id"], path_based=path != "/")
                    r["app_id"] = a["id"]

    def add_dns(self, dns):
        for name, rec in dns.get("records", {}).items():
            self.domains[name] = dict(rec, id=eid("dom", name), source=f"DNS via collector resolver {dns['at']}")
        # attach domain endpoints to apps by IP when not already via a proxy route
        for name, rec in self.domains.items():
            if not rec.get("ok"):
                continue
            ips = rec["addresses"]
            via_proxy = any(name in (r.get("hosts") or []) for r in self.routes)
            rec["proxy_route"] = via_proxy
            for ip in ips:
                where = self.ip_index.get(ip, {})
                rec.setdefault("targets", []).append(dict(ip=ip, **where))
            if via_proxy:
                continue
            # Same IP as the HA internal URL etc.
            existing = [a for a in self.apps.values() if any(e["url"].startswith(f"https://{name}/") for e in a["endpoints"])]
            if existing:
                continue
            ip = ips[0]
            where = self.ip_index.get(ip, {})
            proxy_dev = next((d for d in self.devices.values() if d.get("ip") == ip and re.search(r"caddy|proxy", f"{d.get('name')} {d.get('hostname')}", re.I)), None)
            cands = [a for a in self.apps.values()
                     if (a["location"].get("host_ip") == ip or (where.get("device") and a["location"].get("device_id") == where.get("device")))
                     and a.get("kind") != "addon" and a.get("catalog_key") != "caddy"]
            key = catalog.match(catalog.HOSTNAME_PATTERNS, name.split(".")[0])
            if name in self.dhcp_names:
                # UniFi registers client hostnames in DNS automatically. That is
                # not evidence of a website: attach only to an app already known there.
                rec["kind"] = "dhcp-hostname"
                if len(cands) == 1:
                    self.endpoint(cands[0], f"https://{name}/", "domain", "discovered", rec["source"] + " (DHCP hostname record)",
                                  ip=ip, scheme_guessed=True, dhcp_name=True)
                continue
            if proxy_dev:
                rec["note"] = "Points at the reverse proxy; the route is not known until the Caddy config is collected."
            target = None
            if not proxy_dev:
                same = [a for a in cands if key and a.get("catalog_key") == key]
                target = same[0] if same else None
            elif key == "caddy":
                # the proxy's own name (proxy.safrani.co): it is the Caddy host itself
                target = next((a for a in self.apps.values() if a["location"].get("device_id") == proxy_dev["id"] and a.get("catalog_key") == "caddy"), None)
            if target is None:
                inf = catalog.info(key) if key else None
                dev = self.devices.get(where.get("device")) or {}
                target = self.app(eid("app", "dom", name), name=(inf or {}).get("name") or name.split(".")[0].title(),
                                  category=(inf or {}).get("category") or "Other", icon=(inf or {}).get("icon"),
                                  purpose=(inf or {}).get("purpose"), catalog_key=key,
                                  location=dict(host_ip=ip, device_id=where.get("device"), workload_id=where.get("workload"),
                                                host_label=dev.get("name") or dev.get("hostname")),
                                  sources=rec["source"], confidence="low")
                if proxy_dev:
                    target["location"]["host_label"] = "behind Caddy-Proxy (backend unknown)"
                    target["location"]["proxy_device_id"] = proxy_dev["id"]
            self.endpoint(target, f"https://{name}/", "domain", "configured", rec["source"], ip=ip,
                          proxy="caddy (presumed)" if proxy_dev else None, scheme_guessed=True)

    # ---------------------------------------------------------------- reconciliation
    def reconcile(self, dns, ha):
        known = {d.get("ip") for d in self.devices.values()} | {n.get("ip") for n in self.nodes.values()} | set(self.ip_index)
        for name, rec in self.domains.items():
            if not rec.get("ok") or rec.get("kind") == "dhcp-hostname":
                continue
            for ip in rec["addresses"]:
                inside = any(ip_in(ip, n["subnet"]) for n in self.networks)
                dev = next((d for d in self.devices.values() if d.get("ip") == ip), None)
                if not inside and not ipaddress.ip_address(ip).is_global:
                    self.issue("high", "stale-dns", f"{name} points to {ip}, outside every known network",
                               [f"DNS {name} → {ip} ({rec['source']})", "No UniFi network/VLAN contains this address"],
                               "Check the local DNS record in UniFi (Settings → Routing → DNS) and update or delete it.",
                               ref="dns:" + name, hypothesis="Left over from an older network layout (192.168.50.x).")
                elif dev and not dev.get("online"):
                    self.issue("medium", "dns-to-offline", f"{name} points to {ip}, which UniFi shows offline",
                               [f"DNS {name} → {ip}", f"UniFi client {dev.get('name') or dev.get('mac')} last changed {dev.get('last_changed')} (offline)"],
                               "If the service moved (e.g. to frigate-gtx), point this name at the new host or remove it.",
                               ref="dns:" + name, hypothesis="Workload was replaced or is stopped (not confirmed).")
                elif inside and ip not in known:
                    self.issue("low", "dns-unknown-target", f"{name} → {ip} is not a known client",
                               [f"DNS {name} → {ip}", "Not present in UniFi client data from HA"],
                               "Confirm the target exists; collect UniFi data for offline clients.", ref="dns:" + name)
        for r in self.routes:
            if r.get("action") == "reverse_proxy" and r.get("upstream_status", "").startswith("unmatched"):
                self.issue("medium", "proxy-backend-unverified", f"Route {', '.join(r['hosts'])}{(r.get('paths') or [''])[0]} → {', '.join(r.get('upstreams') or [])} has no matching backend",
                           [f"{r['proxy']} route from {r['source']}", f"upstream status: {r['upstream_status']}"],
                           "Collect the backend host (collect-guest.sh) or fix the upstream address if the service moved.",
                           ref="route:" + r["id"], hypothesis="Backend not collected yet, or the route is orphaned.")
        for w in self.workloads.values():
            if w.get("status") == "stopped" and not w.get("template"):
                self.issue("low" if not w.get("onboot") else "medium", "stopped-workload",
                           f"{w['kind'].upper()} {w['vmid']} {w.get('name')} is stopped" + (" (onboot=1)" if w.get("onboot") else ""),
                           [f"pvesh cluster/resources status=stopped ({w['sources'][0]})"],
                           "Start it if it should run, or mark it intentionally disabled in the dashboard.", ref=w["id"])
        for c in self.containers.values():
            if c["state"] in ("exited", "dead", "restarting") or (c.get("restarts") or 0) > 5:
                self.issue("medium" if c["state"] != "exited" else "low", "container-state",
                           f"Container {c['name']} on {c['host_label']} is {c['state']}" + (f", {c['restarts']} restarts" if c.get("restarts") else ""),
                           [f"{c['engine']} ps ({c['sources'][0]}): {c.get('status')}"],
                           "Check its logs on the host (docker logs).", ref=c["id"])
        for d in self.devices.values():
            if d.get("role") in ("server-oob", "kvm") and not d.get("online"):
                self.issue("low", "device-offline", f"{d.get('name')} ({d.get('ip')}) is offline in UniFi",
                           [f"UniFi client state offline, last change {d.get('last_changed')}"],
                           "Expected if the server is powered off; otherwise check its cable/port.", ref=d["id"])
        for n in self.nodes.values():
            if not n.get("verified"):
                self.issue("info", "unverified-node", f"Proxmox node {n['name']} ({n['ip']}) not yet verified",
                           ["Only the last-known address you supplied", f"UniFi sees the IP: {'online' if n.get('seen_by_unifi') else 'no/offline'}",
                            "TCP 8006/22 are filtered from the collector at 10.10.35.6"],
                           "Run collectors/dist/collect-proxmox.sh on the node and import the result.", ref=n["id"])
        # duplicate apps (same catalog key + same domain)
        seen = {}
        for a in self.apps.values():
            for e in a["endpoints"]:
                if e["kind"] == "domain":
                    seen.setdefault(e["url"], []).append(a["id"])
        for url, ids in seen.items():
            if len(set(ids)) > 1:
                self.issue("low", "duplicate", f"{url} is attached to {len(set(ids))} entries", ids,
                           "Merge or hide the duplicate in Admin.", ref="dup:" + url)
        unnamed = [d for d in self.devices.values() if not d.get("name") and not d.get("hostname")]
        if unnamed:
            self.issue("info", "unnamed-clients", f"{len(unnamed)} UniFi clients have no name or hostname",
                       [f"{d.get('ip') or '-'} {d.get('vendor') or ''} ({'online' if d.get('online') else 'offline'})" for d in unnamed][:20],
                       "Name them in UniFi so they're identifiable here; Proxmox-vendor ones are VMs/LXCs.", ref="unnamed")

    def finalize(self):
        by_host = {}
        for a in self.apps.values():
            for e in a["endpoints"]:
                if e["kind"] == "domain":
                    by_host.setdefault(e["host"], a["id"])
        for a in self.apps.values():
            a["dependencies"] = [by_host.get(d.split(":", 1)[1], d) if d.startswith("frigate:") else d for d in a["dependencies"]]
        for a in self.apps.values():
            eps = a["endpoints"]
            rank = dict(verified=3, configured=2, discovered=1, inferred=0)
            dom = sorted([e for e in eps if e["kind"] == "domain"], key=lambda e: (-rank[e["status"]], e.get("path_based", False), len(e["url"])))
            ip = sorted([e for e in eps if e["kind"] == "ip"], key=lambda e: (-rank[e["status"]], len(e["url"])))
            a["preferred_domain"] = dom[0]["id"] if dom else None
            a["preferred_ip"] = ip[0]["id"] if ip else None
            if not ip and dom:
                a["direct_ip_note"] = "No direct IP endpoint known" + (" — served through a reverse proxy; direct access needs the backend port" if any(e.get("proxy") for e in dom) else "")
            hl = a["location"]
            a["vlan"] = self.vlan_of(hl.get("host_ip"))
            if a.get("catalog_key") == "proxmox" and hl.get("node_id"):
                a["mgmt_links"].append(dict(label="Proxmox node", url=f"https://{hl.get('host_ip')}:8006/#v1:0:=node%2F{self.nodes.get(hl['node_id'], {}).get('name')}"))
            if hl.get("workload_id") and hl["workload_id"] in self.workloads:
                w = self.workloads[hl["workload_id"]]
                n = self.nodes.get(w.get("node_id"), {})
                if n.get("ip"):
                    a["mgmt_links"].append(dict(label=f"{w['kind'].upper()} {w['vmid']} in Proxmox",
                                                url=f"https://{n['ip']}:8006/#v1:0:={'qemu' if w['kind']=='vm' else 'lxc'}%2F{w['vmid']}"))
            a["name"] = a.get("name") or a["id"]
        return self


def build(cfg, data_dir):
    with open(os.path.join(ROOT, "config", "seed.json")) as f:
        seed = json.load(f)
    b = Builder(seed)
    b.extra_domains = set(seed.get("known_domains", []))
    suffix = seed.get("domain_suffix")
    started = now()

    ha = source_home_assistant(cfg)
    b.sources.append(dict(name="Home Assistant (UniFi integration, add-ons)", status=ha.get("status"), at=ha.get("at") or started, error=ha.get("error"),
                          detail=f"{len(ha.get('clients', []))} clients, {len(ha.get('addons', []))} add-ons" if ha.get("status") == "ok" else None))
    if ha.get("status") == "ok":
        b.add_unifi_clients(ha["clients"], f"UniFi via Home Assistant {ha['at']}")

    extracted = extract_incoming(os.path.join(data_dir, "incoming"), os.path.join(data_dir, "extracted"))
    col = source_collected(extracted)
    unifi_runs = [r for r in col["runs"] if r["collector"] == "unifi"]
    for r in unifi_runs:
        u = r["unifi"]
        nets = (u.get("api_rest_networkconf") or {}).get("data") or []
        if nets:
            b.networks = [dict(vlan=n.get("vlan") or (1 if n.get("purpose") == "corporate" and not n.get("vlan_enabled") else None),
                               subnet=n.get("ip_subnet"), name=n.get("name"), purpose=n.get("purpose"),
                               dhcp=n.get("dhcpd_enabled"), domain=n.get("domain_name"), source="UniFi networkconf")
                          for n in nets if n.get("ip_subnet")]
        users = (u.get("api_rest_user") or {}).get("data") or []
        active = {(c.get("mac") or "").lower(): c for c in ((u.get("api_stat_sta") or {}).get("data") or [])}
        b.add_unifi_clients([dict(mac=(x.get("mac") or "").lower(), ip=(active.get(x.get("mac"), {}) or {}).get("ip") or x.get("fixed_ip") or x.get("last_ip"),
                                  hostname=x.get("hostname"), name=x.get("name"), vendor=x.get("oui"), online=x.get("mac") in active,
                                  fixed_ip=x.get("fixed_ip") if x.get("use_fixedip") else None, note=x.get("note"),
                                  first_seen=x.get("first_seen"), last_seen=x.get("last_seen"),
                                  vlan=(active.get(x.get("mac")) or {}).get("vlan"))
                             for x in users], f"collect-unifi {r['at']}")
        for rec in (u.get("v2_static_dns") or []) if isinstance(u.get("v2_static_dns"), list) else []:
            if rec.get("key"):
                b.extra_domains.add(rec["key"])
                b.unifi_dns = getattr(b, "unifi_dns", []) + [dict(name=rec["key"], type=rec.get("record_type"), value=rec.get("value"), enabled=rec.get("enabled"))]
    b.sources.append(dict(name="Collector results (imported)", status=col["status"], at=started,
                          detail=f"{len(col['runs'])} runs: " + ", ".join(f"{r['collector']}@{r['hostname']}" for r in col["runs"])))
    b.add_seed_nodes()
    for r in col["runs"]:
        if r["collector"] == "proxmox":
            b.add_proxmox_run(r)
    b.classify_devices()
    b.link_workloads_to_devices()
    for r in col["runs"]:
        if r["collector"] == "guest":
            b.add_guest_run(r)
    b.add_home_assistant(ha)
    b.device_apps()
    b.attach_routes()
    names = set(b.extra_domains) | {f"{c}.{suffix}" for c in seed.get("candidate_names", [])}
    b.dhcp_names = {f"{d['hostname'].lower()}.{suffix}" for d in b.devices.values() if d.get("hostname") and re.match(r"^[a-z0-9-]+$", d["hostname"], re.I)}
    b.dhcp_names -= set(b.extra_domains) | {f"{c}.{suffix}" for c in seed.get("candidate_names", [])}
    names |= b.dhcp_names
    dns = source_dns(names)
    # keep only names that resolved, plus every name that was explicitly configured somewhere
    configured = set(b.extra_domains)
    dns["records"] = {k: v for k, v in dns["records"].items() if v["ok"] or k in configured}
    b.sources.append(dict(name="DNS (collector's resolver)", status="ok", at=dns["at"],
                          detail=f"{len(names)} names looked up, {sum(1 for v in dns['records'].values() if v['ok'])} resolved"))
    b.add_dns(dns)
    b.reconcile(dns, ha)
    b.finalize()
    endpoint_runs = [r for r in col["runs"] if r["collector"].startswith("endpoints")]
    return dict(
        generated_at=now(), collector=cfg.get("collector_label", "dashboard backend"),
        sources=b.sources, networks=b.networks, nodes=list(b.nodes.values()), workloads=list(b.workloads.values()),
        containers=list(b.containers.values()), devices=list(b.devices.values()), apps=list(b.apps.values()),
        domains=list(b.domains.values()), routes=b.routes, issues=b.issues,
        unifi_dns=getattr(b, "unifi_dns", None), external_checks=endpoint_runs,
        collected_runs=[{k: v for k, v in r.items() if k in ("collector", "hostname", "at", "failed", "dir")} for r in col["runs"]],
        ha_addons=ha.get("addons", []) if ha.get("status") == "ok" else [],
    )
