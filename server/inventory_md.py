"""Render the exported inventory JSON as a readable Markdown report.

python3 -m server.inventory_md docs/inventory/inventory.json > docs/inventory/INVENTORY.md
"""
import json
import sys


def cell(v):
    return str(v if v not in (None, "") else "—").replace("|", "\\|").replace("\n", " ")


def main(path):
    d = json.load(open(path))
    out = [f"# Homelab inventory\n",
           f"Generated **{d['generated_at']}** by collector `{d['collector']}`. "
           "Endpoint status: **verified** = answered a check from this collector; **configured** = in DNS/proxy config; "
           "**discovered** = listening port seen; **inferred** = convention only. Health **unreachable** = this collector "
           "could not connect (firewall), which is *not* the same as down.\n",
           "## Sources\n", "| Source | Status | Detail | When |", "|---|---|---|---|"]
    for s in d["sources"]:
        out.append(f"| {cell(s['name'])} | {cell(s['status'])} | {cell(s.get('detail') or s.get('error'))} | {cell(s.get('at'))} |")
    out += ["\n## Proxmox\n", "| Node | IP | Cluster | Verified | Status |", "|---|---|---|---|---|"]
    for n in d["nodes"]:
        out.append(f"| {cell(n['name'])} | {cell(n.get('ip'))} | {cell(n.get('cluster'))} | {'yes' if n.get('verified') else 'no — last-known only'} | {cell(n.get('status'))} |")
    if d["workloads"]:
        out += ["\n| VMID | Type | Name | Node | Status | IPs | VLAN |", "|---|---|---|---|---|---|---|"]
        for w in sorted(d["workloads"], key=lambda w: w["vmid"]):
            out.append(f"| {w['vmid']} | {w['kind']} | {cell(w.get('name'))} | {cell(w.get('node'))} | {cell(w.get('status'))} | {cell(', '.join(w.get('ips') or []))} | {cell(', '.join(w.get('vlans') or []))} |")
    else:
        out.append("\n_No VM/LXC data yet: run `collect-proxmox.sh` on both nodes._")
    out += ["\n## Applications\n", "| Application | Category | Status | Preferred domain URL | Direct IP URL | Location | VLAN | Confidence | Endpoints (url · how known · health) |",
            "|---|---|---|---|---|---|---|---|---|"]
    for a in sorted(d["apps"], key=lambda a: ((a.get("category") or "zz"), a["name"].lower())):
        eps = {e["id"]: e for e in a["endpoints"]}
        dom = eps.get(a.get("preferred_domain"), {}).get("url")
        ip = eps.get(a.get("preferred_ip"), {}).get("url")
        loc = a.get("location") or {}
        eps_txt = "<br>".join(f"`{e['url']}` · {e['status']} · {e.get('health') or 'unchecked'}" for e in a["endpoints"]) or "none known"
        name = a["name"] + (" _(hidden)_" if a.get("hidden") else "")
        out.append(f"| {cell(name)} | {cell(a.get('category'))} | {cell(a['status'])} | {cell(dom)} | {cell(ip or a.get('direct_ip_note'))} | "
                   f"{cell(loc.get('host_label'))} {cell(loc.get('host_ip'))} | {cell(a.get('vlan'))} | {cell(a.get('confidence'))} | {eps_txt} |")
    out += ["\n## DNS names\n", "| Name | Resolves to | Kind |", "|---|---|---|"]
    for x in sorted(d["domains"], key=lambda x: x["name"]):
        out.append(f"| {x['name']} | {cell(', '.join(x.get('addresses') or []) or x.get('error'))} | {cell(x.get('kind') or ('via proxy' if x.get('note') else 'record'))} |")
    out += ["\n## Proxy routes\n"]
    if d["routes"]:
        out += ["| Host | Path | Proxy | Upstream | Backend match |", "|---|---|---|---|---|"]
        for r in d["routes"]:
            out.append(f"| {cell(', '.join(r.get('hosts') or []))} | {cell(', '.join(r.get('paths') or []))} | {cell(r.get('proxy'))} | {cell(', '.join(r.get('upstreams') or []) or r.get('target'))} | {cell(r.get('upstream_status'))} |")
    else:
        out.append("_No proxy configuration collected yet (Caddy at 50.50.50.10)._")
    out += ["\n## Devices\n", "| Name | IP | VLAN | Role (inferred) | Vendor | State |", "|---|---|---|---|---|---|"]
    def ipk(x):
        ip = x.get("ip") or ""
        return [int(p) for p in ip.split(".")] if ip.count(".") == 3 else [999]
    for x in sorted(d["devices"], key=ipk):
        out.append(f"| {cell(x.get('name') or x.get('hostname'))} | {cell(x.get('ip'))} | {cell(x.get('vlan'))} | {cell(x.get('role'))} | {cell(x.get('vendor'))} | {'online' if x.get('online') else 'offline / previously seen' if x.get('online') is False else '—'} |")
    out += ["\n## Issues\n", "| Severity | Issue | Evidence | Next step | Hypothesis |", "|---|---|---|---|---|"]
    order = {"high": 0, "medium": 1, "low": 2, "info": 3}
    for i in sorted(d["issues"], key=lambda i: order.get(i["severity"], 9)):
        out.append(f"| {i['severity']} | {cell(i['title'])} | {cell('; '.join((i.get('evidence') or [])[:4]))} | {cell(i.get('suggestion'))} | {cell(i.get('hypothesis'))} |")
    print("\n".join(out))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "docs/inventory/inventory.json")
