"""Parse collector output folders into normalized evidence.

Every parser is defensive: missing files, timeouts and odd formats yield
fewer facts, never exceptions. Each fact carries a `source` string so the UI
can show where it came from.
"""
import json
import os
import re

MAC_RE = re.compile(r"([0-9a-f]{2}(?::[0-9a-f]{2}){5})", re.I)


def _read(d, name):
    p = os.path.join(d, name + ".txt")
    try:
        with open(p, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return ""


def _json(text):
    text = (text or "").strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except ValueError:
        # Some commands print a prefix line; try from the first bracket.
        for ch in "[{":
            i = text.find(ch)
            if i >= 0:
                try:
                    return json.loads(text[i:])
                except ValueError:
                    pass
    return None


def meta(d):
    out = {}
    for line in _read(d, "_meta").splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def manifest(d):
    rows = []
    try:
        with open(os.path.join(d, "manifest.tsv")) as f:
            next(f, None)
            for line in f:
                parts = line.rstrip("\n").split("\t")
                if len(parts) >= 3:
                    rows.append(dict(name=parts[0], exit=parts[1], seconds=parts[2]))
    except OSError:
        pass
    return rows


# ---------------------------------------------------------------- network basics

def ips_from_ip_json(text):
    data = _json(text) or []
    out = []
    for itf in data if isinstance(data, list) else []:
        name = itf.get("ifname", "")
        if name == "lo" or name.startswith(("docker", "br-", "veth", "virbr", "tap", "fwbr", "fwpr", "fwln")):
            continue
        for a in itf.get("addr_info", []):
            if a.get("family") == "inet":
                out.append(dict(ifname=name, ip=a.get("local"), prefix=a.get("prefixlen"), mac=itf.get("address")))
    return out


def ips_from_ip_brief(text):
    out = []
    for line in (text or "").splitlines():
        parts = line.split()
        if len(parts) < 3 or parts[0] == "lo" or parts[0].startswith(("docker", "br-", "veth")):
            continue
        for p in parts[2:]:
            m = re.match(r"^(\d+\.\d+\.\d+\.\d+)/(\d+)$", p)
            if m:
                out.append(dict(ifname=parts[0].split("@")[0], ip=m.group(1), prefix=int(m.group(2))))
    return out


SS_RE = re.compile(r"^(tcp|udp)\s+\S+\s+\d+\s+\d+\s+(\S+):(\d+)\s+\S+\s*(.*)$")


def listeners(text):
    """Parse `ss -H -tulpn` output into listening sockets."""
    out, seen = [], set()
    for line in (text or "").splitlines():
        m = SS_RE.match(line.strip())
        if not m:
            continue
        proto, bind, port, rest = m.group(1), m.group(2).strip("[]"), int(m.group(3)), m.group(4)
        if proto == "udp" and port not in (53, 67, 123):
            continue
        if bind.startswith("127.") or bind in ("::1",) or bind.startswith("%lo"):
            continue  # loopback-only: not reachable as a web interface
        pm = re.search(r'users:\(\("([^"]+)"', rest)
        proc = pm.group(1) if pm else None
        key = (proto, port, proc)
        if key in seen:
            continue
        seen.add(key)
        out.append(dict(proto=proto, bind=bind, port=port, process=proc))
    return out


def systemd_units(text):
    units = []
    for line in (text or "").splitlines():
        parts = line.split()
        if parts and parts[0].endswith(".service"):
            units.append(parts[0][:-8])
    return units


# ---------------------------------------------------------------- containers

def _labels(raw):
    if isinstance(raw, dict):
        return raw
    out = {}
    # Split only on commas that start a new key=value (values may contain commas).
    for part in re.split(r",(?=[A-Za-z0-9_.\-/]+=)", raw or ""):
        if "=" in part:
            k, v = part.split("=", 1)
            out[k.strip()] = v.strip()
    return out


PORT_RE = re.compile(r"(?:(\[?[\d.:a-f]*\]?):)?(\d+)(?:-(\d+))?->(\d+)(?:-\d+)?/(tcp|udp)")


def _ports(raw):
    out, seen = [], set()
    for m in PORT_RE.finditer(raw or ""):
        host_ip, hp, _, cp, proto = m.groups()
        key = (int(hp), int(cp), proto)
        if key in seen:
            continue
        seen.add(key)
        out.append(dict(host_ip=(host_ip or "0.0.0.0").strip("[]"), host_port=int(hp), container_port=int(cp), proto=proto))
    return out


def containers(ps_text, engine):
    out = []
    for line in (ps_text or "").splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            c = json.loads(line)
        except ValueError:
            continue
        labels = _labels(c.get("Labels"))
        names = c.get("Names") or c.get("Name") or ""
        if isinstance(names, list):
            names = names[0] if names else ""
        ports = c.get("Ports")
        if isinstance(ports, list):  # podman
            ports = ", ".join(f"{p.get('host_ip') or '0.0.0.0'}:{p.get('host_port')}->{p.get('container_port')}/{p.get('protocol','tcp')}" for p in ports)
        out.append(dict(
            engine=engine, name=names.lstrip("/"), image=c.get("Image", ""),
            state=(c.get("State") or "").lower(), status=c.get("Status", ""),
            ports=_ports(ports or ""),
            networks=c.get("Networks", ""),
            compose_project=labels.get("com.docker.compose.project") or labels.get("io.podman.compose.project"),
            compose_service=labels.get("com.docker.compose.service"),
            compose_file=labels.get("com.docker.compose.project.config_files"),
            proxy_labels={k: v for k, v in labels.items() if k.startswith(("traefik.", "caddy"))},
            traefik_routes=traefik_label_routes(labels),
            network=c.get("Networks", ""),
        ))
    return out


def inspect_extra(text):
    """Map container name -> {started_at, restarts, health} from the inspect lines."""
    out = {}
    for line in (text or "").splitlines():
        parts = line.split("|")
        if len(parts) < 6:
            continue
        try:
            name = json.loads(parts[0]).lstrip("/")
            started = json.loads(parts[3])
            restarts = json.loads(parts[4])
            health = json.loads(parts[5])
        except ValueError:
            continue
        out[name] = dict(started_at=started, restarts=restarts,
                         health=(health or {}).get("Status") if isinstance(health, dict) else None)
    return out


# ---------------------------------------------------------------- reverse proxies

def caddy_json_routes(cfg):
    """Walk Caddy's JSON config (admin API /config/) into flat routes."""
    routes = []
    if not isinstance(cfg, dict):
        return routes
    servers = (((cfg.get("apps") or {}).get("http") or {}).get("servers") or {})

    def walk(route_list, hosts, paths, server_name, listen):
        for r in route_list or []:
            h2, p2 = list(hosts), list(paths)
            for m in r.get("match") or []:
                if m.get("host"):
                    h2 = m["host"]
                if m.get("path"):
                    p2 = m["path"]
            for h in r.get("handle") or []:
                hd = h.get("handler")
                if hd == "subroute":
                    walk(h.get("routes"), h2, p2, server_name, listen)
                elif hd == "reverse_proxy":
                    ups = [u.get("dial") for u in h.get("upstreams") or [] if u.get("dial")]
                    tls = bool((h.get("transport") or {}).get("tls") is not None)
                    routes.append(dict(hosts=h2 or ["*"], paths=p2 or ["/*"], action="reverse_proxy",
                                       upstreams=ups, upstream_tls=tls, server=server_name, listen=listen))
                elif hd == "static_response" and (h.get("headers") or {}).get("Location"):
                    routes.append(dict(hosts=h2 or ["*"], paths=p2 or ["/*"], action="redirect",
                                       target=(h["headers"]["Location"] or [""])[0], server=server_name, listen=listen))
                elif hd == "file_server":
                    routes.append(dict(hosts=h2 or ["*"], paths=p2 or ["/*"], action="file_server",
                                       server=server_name, listen=listen))
    for sname, s in servers.items():
        walk(s.get("routes"), [], [], sname, s.get("listen"))
    return routes


def caddyfile_routes(text):
    """Small Caddyfile reader: site blocks, snippets/imports, handle/handle_path/route
    path scopes, reverse_proxy and redir. Good enough for typical homelab files; the
    runtime JSON config is preferred whenever the collector could read it."""
    files = {}
    cur = None
    for line in (text or "").splitlines():
        if line.startswith("### "):
            cur = line[4:].strip(); files[cur] = []
        elif cur:
            files[cur].append(line)
    if not files:
        files = {"Caddyfile": (text or "").splitlines()}
    src = "\n".join("\n".join(v) for v in files.values())
    # strip comments
    src = "\n".join(re.sub(r"(^|\s)#.*$", "", l) for l in src.splitlines())
    # collect snippets
    snippets = {}
    for m in re.finditer(r"^\((\w[\w-]*)\)\s*\{", src, re.M):
        body, end = _block(src, m.end())
        snippets[m.group(1)] = body
    routes = []

    def scan(body, hosts, path):
        i = 0
        lines = body.split("\n")
        while i < len(lines):
            l = lines[i].strip()
            i += 1
            if not l:
                continue
            m = re.match(r"^import\s+(\S+)", l)
            if m and m.group(1) in snippets:
                scan(snippets[m.group(1)], hosts, path)
                continue
            m = re.match(r"^(handle_path|handle|route)\s*(\S*)\s*\{$", l)
            if m:
                inner, consumed = _lines_block(lines, i)
                i += consumed
                scan("\n".join(inner), hosts, m.group(2) or path)
                continue
            m = re.match(r"^reverse_proxy\s+(.*?)\s*\{?$", l)
            if m:
                args = m.group(1).split()
                p = path
                if args and (args[0].startswith("/") or args[0].startswith("@")):
                    p = args[0] if args[0].startswith("/") else path; args = args[1:]
                ups = [a for a in args if a != "{"]
                if l.endswith("{"):
                    inner, consumed = _lines_block(lines, i); i += consumed
                    for il in inner:
                        mm = re.match(r"^\s*to\s+(.*)$", il)
                        if mm:
                            ups += mm.group(1).split()
                    tls = any("tls" in il for il in inner)
                else:
                    tls = False
                ups = [re.sub(r"^https?://", "", u) for u in ups]
                routes.append(dict(hosts=hosts, paths=[p or "/*"], action="reverse_proxy", upstreams=ups,
                                   upstream_tls=tls or any(u.startswith("https") for u in m.group(1).split())))
                continue
            m = re.match(r"^redir\s+(\S+)(?:\s+(\S+))?", l)
            if m:
                tgt = m.group(2) or m.group(1)
                routes.append(dict(hosts=hosts, paths=[path or "/*"], action="redirect", target=tgt))
                continue
            if l.endswith("{"):  # unrelated nested block (tls, header, log…): skip it
                _, consumed = _lines_block(lines, i); i += consumed

    pos = 0
    for m in re.finditer(r"^([^\s(#{][^{\n]*)\{\s*$", src, re.M):
        if m.start() < pos:
            continue
        addrs = [a.strip().rstrip(",") for a in re.split(r"[,\s]+", m.group(1).strip()) if a.strip()]
        body, end = _block(src, m.end())
        pos = end
        if not addrs or addrs[0].startswith("@"):
            continue
        hosts = [re.sub(r"^https?://", "", a).split("/")[0] for a in addrs]
        if hosts == [""]:
            continue
        scan(body, hosts, None)
    return routes


def _block(src, start):
    depth, i = 1, start
    while i < len(src) and depth:
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
        i += 1
    return src[start:i - 1], i


def _lines_block(lines, i):
    depth, out, j = 1, [], i
    while j < len(lines) and depth:
        l = lines[j]
        depth += l.count("{") - l.count("}")
        if depth > 0:
            out.append(l)
        j += 1
    return out, j - i


def nginx_routes(text):
    routes = []
    src = "\n".join(re.sub(r"#.*$", "", l) for l in (text or "").splitlines())
    for m in re.finditer(r"\bserver\s*\{", src):
        body, _ = _block(src, m.end())
        names = re.findall(r"server_name\s+([^;]+);", body)
        hosts = names[0].split() if names else ["_"]
        listen = re.findall(r"listen\s+([^;]+);", body)
        for lm in re.finditer(r"location\s+(?:[=~^*]+\s*)?(\S+)\s*\{", body):
            lb, _ = _block(body, lm.end())
            pp = re.search(r"proxy_pass\s+([^;]+);", lb)
            if pp:
                up = pp.group(1).strip()
                routes.append(dict(hosts=hosts, paths=[lm.group(1)], action="reverse_proxy",
                                   upstreams=[re.sub(r"^https?://", "", up).rstrip("/")],
                                   upstream_tls=up.startswith("https"), listen=listen))
            rr = re.search(r"return\s+30[12178]\s+([^;]+);", lb)
            if rr:
                routes.append(dict(hosts=hosts, paths=[lm.group(1)], action="redirect", target=rr.group(1)))
    return routes


def traefik_routes(text):
    routes = []
    parts = [p for p in re.split(r"\n(?=\[)", (text or "").strip()) if p.strip()]
    routers, services = [], {}
    for p in parts:
        data = _json(p)
        if not isinstance(data, list):
            continue
        for item in data:
            if "rule" in item:
                routers.append(item)
            elif "loadBalancer" in item:
                services[item.get("name")] = [s.get("url") for s in item["loadBalancer"].get("servers", [])]
    for r in routers:
        rule = r.get("rule", "")
        hosts = re.findall(r"Host\(`([^`]+)`\)", rule) or ["*"]
        paths = re.findall(r"PathPrefix\(`([^`]+)`\)", rule) or ["/"]
        svc = r.get("service", "")
        ups = services.get(svc) or services.get(svc + "@" + (r.get("provider") or "")) or []
        routes.append(dict(hosts=hosts, paths=paths, action="reverse_proxy",
                           upstreams=[re.sub(r"^https?://", "", u or "") for u in ups], service=svc))
    return routes


# ---------------------------------------------------------------- Proxmox

def kv_config(text):
    out = {}
    for line in (text or "").splitlines():
        if ":" in line and not line.startswith("#"):
            k, v = line.split(":", 1)
            out[k.strip()] = v.strip()
    return out


def guest_nics(cfg):
    nics = []
    for k, v in cfg.items():
        if not re.match(r"^net\d+$", k):
            continue
        opts = dict(p.split("=", 1) for p in v.split(",") if "=" in p)
        mac = None
        for key in ("hwaddr", "virtio", "e1000", "vmxnet3", "rtl8139"):
            if key in opts and MAC_RE.match(opts[key]):
                mac = opts[key].lower()
        ip = opts.get("ip")
        nics.append(dict(nic=k, mac=mac, bridge=opts.get("bridge"), vlan=opts.get("tag"),
                         ip=ip.split("/")[0] if ip and ip not in ("dhcp", "manual") else None,
                         ip_mode=ip, firewall=opts.get("firewall")))
    return nics


def agent_ips(text):
    data = _json(text)
    out = []
    if isinstance(data, dict):
        data = data.get("result", [])
    for itf in data or []:
        if not isinstance(itf, dict) or itf.get("name") in ("lo", "lo0") or str(itf.get("name", "")).startswith(("docker", "br-", "veth")):
            continue
        for a in itf.get("ip-addresses", []):
            if a.get("ip-address-type") == "ipv4" and not a["ip-address"].startswith("127."):
                out.append(dict(ifname=itf.get("name"), ip=a["ip-address"], mac=(itf.get("hardware-address") or "").lower()))
    return out


def sections(text):
    out, cur = {}, None
    for line in (text or "").splitlines():
        if line.startswith("## "):
            cur = line[3:].strip(); out[cur] = []
        elif cur is not None:
            out[cur].append(line)
    return {k: "\n".join(v) for k, v in out.items()}


def traefik_label_routes(labels):
    """Traefik docker-provider labels -> [(router, hosts, paths, port)]."""
    if str(labels.get("traefik.enable", "true")).lower() == "false":
        return []
    routers = {}
    for k, v in labels.items():
        m = re.match(r"^traefik\.http\.routers\.([^.]+)\.rule$", k)
        if m:
            routers[m.group(1)] = v
    ports = {m.group(1): v for k, v in labels.items() if (m := re.match(r"^traefik\.http\.services\.([^.]+)\.loadbalancer\.server\.port$", k))}
    out, seen = [], set()
    for name, rule in routers.items():
        hosts = re.findall(r"Host\(`([^`]+)`\)", rule)
        paths = re.findall(r"PathPrefix\(`([^`]+)`\)", rule) or ["/"]
        svc = labels.get(f"traefik.http.routers.{name}.service")
        port = ports.get(svc) if svc else (next(iter(ports.values())) if len(ports) == 1 else None)
        key = (tuple(hosts), tuple(paths))
        if hosts and key not in seen:
            seen.add(key)
            out.append(dict(router=name, hosts=hosts, paths=paths, port=port))
    return out
