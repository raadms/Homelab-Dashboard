"""Read-time merge of discovered facts + user overrides + manual entries + health,
plus snapshot diffs and the digest."""
import hashlib
import re
import time
from datetime import datetime, timedelta, timezone

from .discovery import ep_id, slug

GOOD = {"up", "auth", "reachable"}
STATUS_RANK = ["disabled", "stopped", "down", "dns-fail", "degraded", "unreachable", "unverified", "reachable", "auth", "up"]


def _ep_from_url(url, source, status="configured"):
    m = re.match(r"^(\w+)://([^/:]+)(?::(\d+))?(/.*)?$", url)
    if not m:
        return None
    scheme, host, port, path = m.group(1), m.group(2), m.group(3), m.group(4) or "/"
    port = int(port) if port else (443 if scheme == "https" else 80)
    kind = "ip" if re.match(r"^\d+\.\d+\.\d+\.\d+$", host) else "domain"
    return dict(id=ep_id(url), url=url, kind=kind, scheme=scheme, host=host, port=port, path=path,
                status=status, sources=[source], access="unknown", ip=host if kind == "ip" else None, manual=True)


def merged(store, inv):
    """Return the inventory as the UI shows it. Discovered objects are copied, never mutated in the DB."""
    if not inv:
        inv = dict(generated_at=None, apps=[], devices=[], nodes=[], workloads=[], containers=[], domains=[], routes=[],
                   issues=[], sources=[], networks=[])
    ov = store.overrides()
    states = store.endpoint_states()
    settings = store.settings()
    apps, devices = [], []
    alias_ov = {}
    for a in inv["apps"]:
        for al in a.get("aliases", [a["id"]]):
            if al in ov:
                alias_ov.setdefault(a["id"], {}).update(ov[al])
    for m in store.manual():
        if m["kind"] == "app":
            a = dict(id=m["id"], aliases=[m["id"]], name=m["name"], category=m.get("category") or "Other", icon=m.get("icon"),
                     purpose=m.get("purpose"), endpoints=[], sources=["manual entry"], notes=[m["notes"]] if m.get("notes") else [],
                     dependencies=m.get("dependencies") or [], mgmt_links=[], location=dict(host_label=m.get("location"), host_ip=m.get("ip")),
                     runtime={}, confidence="manual", manual=True)
            for u in m.get("urls") or []:
                e = _ep_from_url(u, "manual entry")
                if e:
                    a["endpoints"].append(e)
            inv_apps = inv["apps"] + [a]
            inv = dict(inv, apps=inv_apps)
        else:
            devices.append(dict(id=m["id"], name=m["name"], ip=m.get("ip"), mac=m.get("mac"), vlan=m.get("vlan"),
                                role=m.get("role") or "manual", vendor=m.get("vendor"), notes=m.get("notes"),
                                online=None, sources=["manual entry"], manual=True, location=m.get("location")))
    for a0 in inv["apps"]:
        a = dict(a0)
        o = dict(alias_ov.get(a["id"], {}), **ov.get(a["id"], {}))
        a["override"] = o
        a["discovered_name"] = a0.get("name")
        for k in ("name", "icon", "category", "purpose", "order", "tags", "access"):
            if o.get(k) is not None:
                a[k] = o[k]
        a["hidden"] = o.get("hidden", a0.get("default_hidden", False))
        a["disabled"] = o.get("disabled", False)
        a["favorite"] = o.get("favorite", False)
        a["notes_user"] = o.get("notes_user")
        eps = [dict(e) for e in a0.get("endpoints", [])]
        for u in o.get("extra_endpoints", []):
            if not any(e["url"] == u for e in eps):
                e = _ep_from_url(u, "added by you")
                if e:
                    eps.append(e)
        for e in eps:
            st = states.get(e["url"])
            e["health"] = st["status"] if st else None
            e["health_summary"] = st["summary"] if st else None
            e["checked_at"] = st["checked_at"] if st else None
            e["last_ok_at"] = st["last_ok_at"] if st else None
            e["since"] = st["last_change_at"] if st else None
            last = (st or {}).get("last") or {}
            e["tls"] = last.get("tls")
            e["http"] = last.get("http")
            e["hypothesis"] = last.get("hypothesis")
            e["collector"] = last.get("collector")
            e["check_disabled"] = bool(o.get("check_disabled")) or a["disabled"]
            if st and st["status"] in GOOD and e["status"] != "verified":
                e["discovery_status"] = e["status"]
                e["status"] = "verified"
            e["sensitive"] = bool(a0.get("sensitive"))
        a["endpoints"] = eps
        # preferred endpoints
        pref = o.get("preferred_url")
        a["preferred_domain"] = a0.get("preferred_domain")
        a["preferred_ip"] = a0.get("preferred_ip")
        if pref:
            pe = next((e for e in eps if e["id"] == pref or e["url"] == pref), None)
            if pe:
                if pe["kind"] == "domain":
                    a["preferred_domain"] = pe["id"]
                else:
                    a["preferred_ip"] = pe["id"]
                a["preferred_override"] = pe["id"]
        if not a.get("preferred_domain"):
            d = [e for e in eps if e["kind"] == "domain"]
            a["preferred_domain"] = d[0]["id"] if d else None
        if not a.get("preferred_ip"):
            d = [e for e in eps if e["kind"] == "ip"]
            a["preferred_ip"] = d[0]["id"] if d else None
        a["status"] = app_status(a)
        apps.append(a)
    apps.sort(key=lambda a: (a.get("order", 1000), (a.get("category") or "zz").lower(), (a.get("name") or "").lower()))
    for d0 in inv["devices"]:
        d = dict(d0)
        o = ov.get(d["id"], {})
        d["override"] = o
        for k in ("name", "icon", "category", "notes_user", "tags"):
            if o.get(k) is not None:
                d[k] = o[k]
        d["hidden"] = o.get("hidden", False)
        devices.append(d)
    workloads = []
    for w0 in inv["workloads"]:
        w = dict(w0)
        o = ov.get(w["id"], {})
        w["override"] = o
        w["disabled"] = o.get("disabled", False)
        if o.get("name"):
            w["display_name"] = o["name"]
        workloads.append(w)
    out = dict(inv, apps=apps, devices=devices, workloads=workloads, settings_public=dict(
        default_access_mode=settings["default_access_mode"], categories_order=settings["categories_order"],
        check_interval_min=settings["check_interval_min"], discovery_interval_min=settings["discovery_interval_min"],
        cert_warn_days=settings["cert_warn_days"]))
    out["issues"] = list(inv.get("issues", [])) + health_issues(apps, settings)
    ids = {a["id"] for a in apps} | {al for a in apps for al in a.get("aliases", [])} | {d["id"] for d in devices} | {w["id"] for w in workloads} | {n["id"] for n in inv.get("nodes", [])}
    out["orphan_overrides"] = [k for k in ov if k not in ids]
    out["summary"] = summary(out)
    return out


def app_status(a):
    if a.get("disabled"):
        return "disabled"
    rt = (a.get("runtime") or {}).get("state")
    if rt in ("exited", "stopped", "dead", "created"):
        return "stopped"
    hs = [e["health"] for e in a["endpoints"] if e.get("health") and not e.get("check_disabled")]
    if not hs:
        return "unverified"
    # The app is as healthy as its best endpoint; issues on other endpoints are shown per endpoint.
    return max(hs, key=lambda s: STATUS_RANK.index(s) if s in STATUS_RANK else 0)


def health_issues(apps, settings):
    out = []
    warn = settings["cert_warn_days"]
    for a in apps:
        if a.get("disabled"):
            continue
        for e in a["endpoints"]:
            if e.get("check_disabled"):
                continue
            t = e.get("tls") or {}
            if t.get("days_left") is not None and t["days_left"] <= warn and e["kind"] == "domain":
                out.append(dict(id="iss:cert:" + e["id"], severity="high" if t["days_left"] <= 7 else "medium", type="cert-expiry",
                                title=f"TLS certificate for {e['host']} expires in {t['days_left']} days",
                                evidence=[f"expires {t.get('expires')} (issuer {t.get('issuer')})", f"checked {e.get('checked_at')} from {e.get('collector')}"],
                                suggestion="Check the ACME renewal on the proxy/app that serves this name.", ref=e["id"]))
            if t and t.get("verified") is False and e["kind"] == "domain":
                out.append(dict(id="iss:tlsv:" + e["id"], severity="medium", type="tls-invalid",
                                title=f"TLS certificate for {e['host']} does not validate",
                                evidence=[t.get("verify_error") or "verification failed"], suggestion="Check the certificate's names and chain.", ref=e["id"]))
            if e.get("health") in ("down", "dns-fail") or (e.get("health") == "degraded" and (e.get("http") or {}).get("code") == 404):
                out.append(dict(id="iss:ep:" + e["id"], severity="high" if e["health"] == "down" else "medium", type="broken-link",
                                title=f"{a['name']}: {e['url']} is {e['health']}",
                                evidence=[e.get("health_summary") or "", f"since {e.get('since')}", f"last OK {e.get('last_ok_at') or 'never (by this collector)'}"],
                                suggestion="Open the details view and run diagnostics.", ref=e["id"], hypothesis=e.get("hypothesis")))
    return out


def summary(m):
    apps = [a for a in m["apps"] if not a.get("hidden")]
    by = {}
    for a in apps:
        by[a["status"]] = by.get(a["status"], 0) + 1
    sev = {}
    for i in m["issues"]:
        sev[i["severity"]] = sev.get(i["severity"], 0) + 1
    return dict(apps=len(apps), apps_hidden=len(m["apps"]) - len(apps), by_status=by, issues=sev,
                devices=len(m["devices"]), devices_online=sum(1 for d in m["devices"] if d.get("online")),
                nodes=len(m.get("nodes", [])), nodes_verified=sum(1 for n in m.get("nodes", []) if n.get("verified")),
                workloads=len(m.get("workloads", [])), containers=len(m.get("containers", [])))


# ======================================================================= diffs & digest

def diff(old, new):
    """Changes between two discovery snapshots. Only claims what the evidence shows."""
    ch = []
    if not old or not new:
        return ch

    def idx(lst, key="id"):
        return {x[key]: x for x in lst or []}
    oa, na = idx(old["apps"]), idx(new["apps"])
    for k in na.keys() - oa.keys():
        ch.append(dict(type="app-new", severity="info", ref=k, title=f"New: {na[k]['name']}", detail=dict(sources=na[k].get("sources"))))
    for k in oa.keys() - na.keys():
        ch.append(dict(type="app-missing", severity="medium", ref=k, title=f"No longer discovered: {oa[k]['name']}",
                       detail=dict(last_sources=oa[k].get("sources")), hypothesis="Removed, renamed, or its source was not collected this run."))
    for k in na.keys() & oa.keys():
        ou = {e["url"] for e in oa[k]["endpoints"]}
        nu = {e["url"] for e in na[k]["endpoints"]}
        for u in nu - ou:
            ch.append(dict(type="endpoint-new", severity="info", ref=k, title=f"{na[k]['name']}: new URL {u}"))
        for u in ou - nu:
            ch.append(dict(type="endpoint-removed", severity="low", ref=k, title=f"{na[k]['name']}: URL gone {u}"))
        ors, nrs = (oa[k].get("runtime") or {}), (na[k].get("runtime") or {})
        if ors.get("started_at") and nrs.get("started_at") and ors["started_at"] != nrs["started_at"]:
            ch.append(dict(type="restart", severity="low", ref=k, title=f"{na[k]['name']} restarted (container start time changed)",
                           detail=dict(before=ors["started_at"], after=nrs["started_at"])))
        if ors.get("state") != nrs.get("state") and ors.get("state") and nrs.get("state"):
            ch.append(dict(type="runtime-change", severity="medium" if nrs["state"] in ("exited", "stopped", "device-offline") else "info",
                           ref=k, title=f"{na[k]['name']}: {ors['state']} → {nrs['state']}"))
    od, nd = idx(old["devices"]), idx(new["devices"])
    for k in nd.keys() - od.keys():
        d = nd[k]
        ch.append(dict(type="device-new", severity="info", ref=k, title=f"New device: {d.get('name') or d.get('hostname') or d.get('ip') or k}",
                       detail=dict(ip=d.get("ip"), vendor=d.get("vendor"))))
    for k in od.keys() - nd.keys():
        d = od[k]
        ch.append(dict(type="device-missing", severity="low", ref=k, title=f"Device no longer listed: {d.get('name') or d.get('ip') or k}"))
    for k in nd.keys() & od.keys():
        o, n = od[k], nd[k]
        nm = n.get("name") or n.get("hostname") or k
        if o.get("ip") and n.get("ip") and o["ip"] != n["ip"]:
            ch.append(dict(type="ip-change", severity="medium", ref=k, title=f"{nm}: IP {o['ip']} → {n['ip']}"))
        if o.get("online") != n.get("online") and n.get("role") not in ("client",):
            ch.append(dict(type="device-online" if n.get("online") else "device-offline", severity="info" if n.get("online") else "low",
                           ref=k, title=f"{nm} is now {'online' if n.get('online') else 'offline'}"))
    ow, nw = idx(old["workloads"]), idx(new["workloads"])
    for k in nw.keys() & ow.keys():
        o, n = ow[k], nw[k]
        if o.get("status") != n.get("status"):
            ch.append(dict(type="workload-" + ("stopped" if n.get("status") == "stopped" else "started"),
                           severity="medium" if n.get("status") == "stopped" else "info", ref=k,
                           title=f"{n['kind'].upper()} {n['vmid']} {n.get('name')}: {o.get('status')} → {n.get('status')}"))
        elif n.get("uptime") is not None and o.get("uptime") is not None and n["uptime"] < o["uptime"] and n.get("status") == "running":
            ch.append(dict(type="restart", severity="low", ref=k, title=f"{n['kind'].upper()} {n['vmid']} {n.get('name')} restarted (uptime went down)",
                           detail=dict(uptime_before=o["uptime"], uptime_after=n["uptime"])))
    for k in nw.keys() - ow.keys():
        ch.append(dict(type="workload-new", severity="info", ref=k, title=f"New {nw[k]['kind'].upper()} {nw[k]['vmid']} {nw[k].get('name')}"))
    for k in ow.keys() - nw.keys():
        ch.append(dict(type="workload-missing", severity="medium", ref=k, title=f"{ow[k]['kind'].upper()} {ow[k]['vmid']} {ow[k].get('name')} no longer listed"))
    odm, ndm = idx(old["domains"], "name"), idx(new["domains"], "name")
    for k in ndm.keys() & odm.keys():
        if odm[k].get("addresses") != ndm[k].get("addresses"):
            ch.append(dict(type="dns-change", severity="medium", ref="dom:" + k, title=f"DNS {k}: {odm[k].get('addresses') or odm[k].get('error')} → {ndm[k].get('addresses') or ndm[k].get('error')}"))
    for k in ndm.keys() - odm.keys():
        if ndm[k].get("ok"):
            ch.append(dict(type="dns-new", severity="info", ref="dom:" + k, title=f"DNS name appeared: {k} → {ndm[k].get('addresses')}"))
    for k in odm.keys() - ndm.keys():
        ch.append(dict(type="dns-gone", severity="low", ref="dom:" + k, title=f"DNS name no longer resolves/listed: {k}"))
    rk = lambda r: (tuple(r.get("hosts") or []), tuple(r.get("paths") or []))  # noqa: E731
    orr = {rk(r): r for r in old.get("routes", [])}
    nrr = {rk(r): r for r in new.get("routes", [])}
    for k in nrr.keys() - orr.keys():
        ch.append(dict(type="route-new", severity="info", ref=nrr[k].get("id"), title=f"New proxy route {', '.join(k[0])}{k[1][0] if k[1] else ''} → {', '.join(nrr[k].get('upstreams') or [])}"))
    for k in orr.keys() - nrr.keys():
        ch.append(dict(type="route-gone", severity="low", ref=orr[k].get("id"), title=f"Proxy route removed {', '.join(k[0])}"))
    for k in nrr.keys() & orr.keys():
        if orr[k].get("upstreams") != nrr[k].get("upstreams"):
            ch.append(dict(type="route-change", severity="medium", ref=nrr[k].get("id"),
                           title=f"Proxy route {', '.join(k[0])}: {orr[k].get('upstreams')} → {nrr[k].get('upstreams')}"))
    return ch


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def build_digest(store, merged_inv, kind="on-demand", hours=24):
    now = datetime.now(timezone.utc)
    since = iso(now - timedelta(hours=hours))
    n_snap = store.snapshot_count()
    _, cur = store.snapshot(0)
    _, base = store.snapshot_before(since)
    baseline_note = None
    if n_snap <= 1 or base is None:
        _, base = store.snapshot(n_snap - 1) if n_snap > 1 else (None, None)
        baseline_note = ("Baseline only: this is the first discovery run, so no changes can be claimed yet."
                         if n_snap <= 1 else
                         f"History is shorter than {hours} h; changes are compared with the oldest snapshot ({base['generated_at']}).")
    changes = diff(base, cur) if base and cur and base is not cur else []
    events = store.events(since)
    health = [e for e in events if e["type"].startswith("health-")]
    down = [e for e in health if e["type"] == "health-down"]
    rec = [e for e in health if e["type"] == "health-recovered"]
    issues = merged_inv["issues"]
    certs = [i for i in issues if i["type"] == "cert-expiry"]
    broken = [i for i in issues if i["type"] in ("broken-link",)]
    stale = [i for i in issues if i["type"] in ("stale-dns", "dns-to-offline", "proxy-backend-unverified", "duplicate")]
    orphans = merged_inv.get("orphan_overrides", [])
    stopped = [i for i in issues if i["type"] in ("stopped-workload", "container-state")]
    sev_order = {"high": 0, "medium": 1, "low": 2, "info": 3}
    actions = []
    for i in sorted(issues, key=lambda i: sev_order.get(i["severity"], 9)):
        if i["severity"] in ("high", "medium"):
            actions.append(dict(severity=i["severity"], title=i["title"], evidence=i.get("evidence"),
                                next_step=i.get("suggestion"), hypothesis=i.get("hypothesis"), ref=i.get("ref")))
    unver = [a for a in merged_inv["apps"] if not a.get("hidden") and a["status"] == "unverified"]
    unreach = [a for a in merged_inv["apps"] if not a.get("hidden") and a["status"] == "unreachable"]
    if unreach:
        actions.append(dict(severity="low", title=f"{len(unreach)} apps are unreachable from the collector",
                            evidence=[a["name"] for a in unreach][:15],
                            next_step="Run the collector scripts on those networks, or allow the dashboard host to reach them (read-only).",
                            hypothesis="Inter-VLAN firewall rules block the collector; this does not mean the apps are down."))
    c = merged_inv["summary"]
    headline = (f"{c['by_status'].get('up', 0) + c['by_status'].get('auth', 0)} up · "
                f"{c['by_status'].get('down', 0)} down · {c['by_status'].get('unreachable', 0)} unreachable · "
                f"{c['by_status'].get('unverified', 0)} unverified · {sum(1 for a in actions if a['severity'] == 'high')} high-priority actions")
    return dict(generated_at=iso(now), kind=kind, window_hours=hours, since=since, headline=headline,
                baseline_note=baseline_note, compared=dict(base=(base or {}).get("generated_at"), current=(cur or {}).get("generated_at")),
                changes=changes, health_down=down, health_recovered=rec, certificates=certs, broken_links=broken,
                stale=stale, stopped=stopped, orphan_overrides=orphans, actions=actions,
                unverified=[dict(id=a["id"], name=a["name"]) for a in unver],
                collector=merged_inv.get("collector"), sources=merged_inv.get("sources"))
