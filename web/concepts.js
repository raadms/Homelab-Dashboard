/* Two design concepts rendered from the live /api/inventory (read-only). */
"use strict";
const $ = (s, e = document) => e.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const CDN = "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/";
const ic = (slug, name) => {
  const L = esc((name || "?").replace(/[^A-Za-z0-9 ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase());
  return slug ? `<span class="ico"><img alt="" src="${CDN}svg/${esc(slug)}.svg" data-l="${L}"></span>` : `<span class="ico">${L}</span>`;
};
document.addEventListener("error", (e) => {
  const i = e.target; if (i.tagName !== "IMG" || !i.dataset.l) return;
  if (i.src.includes("/svg/")) { i.src = i.src.replace("/svg/", "/png/").replace(/\.svg$/, ".png"); return; }
  i.parentElement.textContent = i.dataset.l;
}, true);
let D, M, style = new URLSearchParams(location.search).get("s") || "A", q = "", show = "all";
const BAD = ["down", "dns-fail", "degraded"];
const cls = (r) => r.state === "restarting" || (r.state === "running" && BAD.includes(r.health)) ? "bad" : r.state === "running" ? "run" : "stop";
const short = (u) => (u || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
const ring = (p, size, stroke, color, track) => {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${track}" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c * p} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`;
};
const hit = (r) => (!q || [r.name, r.cname, r.image, r.url, r.addr, r.compose, r.host?.name, r.host?.ip, r.vlan].some((x) => x && String(x).toLowerCase().includes(q)))
  && (show === "all" || (show === "run" ? r.state === "running" : show === "stop" ? r.state !== "running" : cls(r) === "bad"));
function build() {
  const appsByCt = new Map(), appsByWl = new Map();
  for (const a of D.apps) {
    const L = a.location || {};
    if (L.container_id) appsByCt.set(L.container_id, a);
    else if (L.workload_id) (appsByWl.get(L.workload_id) || appsByWl.set(L.workload_id, []).get(L.workload_id)).push(a);
  }
  const node = (id) => D.nodes.find((n) => n.id === id) || {};
  const prefUrl = (a) => {
    if (!a) return null;
    const ep = a.endpoints.find((e) => e.id === a.preferred_domain) || a.endpoints.find((e) => e.id === a.preferred_ip);
    return ep || null;
  };
  const rows = [];
  const hosts = [];
  for (const w of [...D.workloads].sort((x, y) => (x.node + x.vmid).localeCompare(y.node + y.vmid, undefined, { numeric: true }))) {
    const cts = D.containers.filter((c) => c.host_id === w.id);
    const portainer = D.apps.find((a) => a.location?.workload_id === w.id && a.catalog_key === "portainer" && a.runtime?.state === "running");
    const traefik = D.apps.find((a) => a.location?.workload_id === w.id && a.catalog_key === "traefik");
    const h = { kind: w.kind === "vm" ? "VM" : "LXC", id: w.vmid, name: w.name, node: w.node, ip: (w.ips || [])[0], ips: w.ips || [], vlan: (w.vlans || []).join(", "),
      status: w.status, mem: w.maxmem ? Math.round((w.mem / w.maxmem) * 100) : null, rows: [], via: w.guest_collected_via,
      portainer: prefUrl(portainer)?.url, traefik: traefik && prefUrl(traefik)?.kind === "domain" ? prefUrl(traefik).url : null,
      note: w.status !== "running" ? "Guest is stopped" : (w.kind === "vm" && !w.guest_collected_at ? "No guest agent — can't see inside this VM" : null) };
    for (const c of cts) {
      const a = appsByCt.get(c.id), ep = prefUrl(a);
      const pub = c.ports.map((p) => `${c.host_ip}:${p.host_port}`);
      const tr = (c.traefik_routes || []).filter((r) => r.hosts.some((x) => x.includes(".")));
      h.rows.push({ type: "container", name: a ? a.name.replace(/ · .*$/, "").replace(/ \(.*\)$/, "") : c.name, cname: c.name, icon: a?.icon, image: c.image,
        state: c.state, url: ep?.url, health: ep?.health, addr: pub.length ? pub.join(", ") : tr.length ? `via Traefik → :${tr[0].port || "?"}` : "internal only",
        compose: c.compose_project, vlan: h.vlan, host: h, app: a });
    }
    for (const a of appsByWl.get(w.id) || []) {
      const ep = prefUrl(a);
      h.rows.push({ type: "service", name: a.name.replace(/ \(.*\)$/, ""), cname: a.runtime?.process || "", icon: a.icon, image: "installed on the guest",
        state: a.runtime?.state === "running" || ep?.health ? (["up", "auth", "reachable", "degraded"].includes(ep?.health) || a.runtime?.state === "running" ? "running" : "unknown") : "unknown",
        url: ep?.url, health: ep?.health, addr: a.endpoints.filter((e) => e.kind === "ip").map((e) => `${e.host}:${e.port}`).join(", ") || "—", compose: null, vlan: h.vlan, host: h, app: a });
    }
    h.running = h.rows.filter((r) => r.state === "running").length;
    hosts.push(h); rows.push(...h.rows);
  }
  // Outside Proxmox but confirmed by a system that manages it (Home Assistant add-ons)
  const haApps = D.apps.filter((a) => a.kind === "addon" || a.id === "app:ha:main");
  const ha = { kind: "DEVICE", id: "", name: "Home Assistant Yellow", node: "physical", ip: "10.10.1.10", ips: ["10.10.1.10"], vlan: "1", status: "running", rows: [], outside: true };
  for (const a of haApps) {
    const ep = prefUrl(a);
    ha.rows.push({ type: a.kind === "addon" ? "add-on" : "service", name: a.name.replace(/ · .*$/, ""), cname: a.location?.addon || "core", icon: a.icon, image: a.runtime?.version ? "v" + a.runtime.version : "",
      state: a.runtime?.state === "stopped" ? "exited" : a.runtime?.state === "running" ? "running" : "unknown", url: ep?.url, health: ep?.health, addr: "—", vlan: "1", host: ha, app: a });
  }
  ha.running = ha.rows.filter((r) => r.state === "running").length;
  hosts.push(ha); rows.push(...ha.rows);
  // Unconfirmed: only network evidence (UniFi client name, DNS name, convention) — nothing from Proxmox or a manager confirms it
  const placed = new Set(rows.map((r) => r.app?.id).filter(Boolean));
  const unk = D.apps.filter((a) => !placed.has(a.id) && !a.location?.workload_id && !a.location?.node_id).map((a) => {
    const ep = prefUrl(a);
    const why = a.sources.some((s) => s.startsWith("DNS")) ? "Only a DNS name points here — no running app found behind it"
      : a.sources.some((s) => s.startsWith("UniFi")) ? `Guessed from the UniFi device name “${a.location?.host_label || ""}”`
      : a.sources.some((s) => s.includes("route")) ? "Only a proxy route mentions it" : "Not seen in Proxmox";
    return { name: a.name, icon: a.icon, url: ep?.url, health: ep?.health, ip: a.location?.host_ip, why, vlan: a.vlan, app: a };
  });
  return { hosts, rows, unk };
}

function A() {
  const all = M.rows, run = all.filter((r) => r.state === "running").length, bad = all.filter((r) => cls(r) === "bad").length;
  const hr = new Date().getHours(), hi = hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
  const app = (r) => `<a class="app ${cls(r)}" ${r.url ? `href="${esc(r.url)}" target="_blank" rel="noopener"` : ""}>${ic(r.icon, r.name)}<div class="n">${esc(r.name)}</div><div class="p">${esc(r.addr === "internal only" ? "internal" : r.addr.split(",")[0])}</div>
    <div class="tip"><b>${esc(r.name)}</b><div>${esc(r.state === "running" ? "Running" : r.state)} · ${esc(r.image)}</div>${r.url ? `<div>↗ ${esc(short(r.url))}</div>` : ""}<div>${esc(r.addr)}</div>${r.compose ? `<div>stack: ${esc(r.compose)}</div>` : ""}</div></a>`;
  const rooms = M.hosts.map((h) => {
    const rs = h.rows.filter(hit); if (!rs.length && (q || show !== "all")) return "";
    const p = h.rows.length ? h.running / h.rows.length : 0;
    return `<section class="room"><div class="room-h"><span class="badge">${h.kind === "DEVICE" ? "DEVICE" : h.kind + " " + h.id}</span><div><h2>${esc(h.name)}</h2>
      <div class="meta"><b class="mono">${esc(h.ip || "—")}</b> · VLAN <b>${esc(h.vlan || "—")}</b> · ${esc(h.node)}</div></div>
      <div class="run">${ring(p, 44, 5, h.status === "running" ? "#34d399" : "#64748b", "rgba(255,255,255,.1)")}</div></div>
      <div class="links">${h.portainer ? `<a href="${esc(h.portainer)}" target="_blank">Portainer ↗</a>` : ""}${h.traefik ? `<a href="${esc(h.traefik)}" target="_blank">Traefik ↗</a>` : ""}<span>${h.running}/${h.rows.length} running</span>${h.status !== "running" ? "<span>guest stopped</span>" : ""}</div>
      ${rs.length ? `<div class="apps">${rs.map(app).join("")}</div>` : `<div class="meta" style="padding:6px 4px;color:#8f97bf">${esc(h.note || "Nothing inside")}</div>`}</section>`;
  }).join("");
  const unk = `<section class="room unk"><div class="room-h"><span class="badge">UNCONFIRMED</span><div><h2>Seen on the network, not in Proxmox</h2><div class="meta">Guessed from UniFi names or DNS — confirm or hide in Admin</div></div></div>
    <div class="apps">${M.unk.map((u) => `<a class="app" ${u.url ? `href="${esc(u.url)}" target="_blank"` : ""}>${ic(u.icon, u.name)}<div class="n">${esc(u.name)}</div><div class="p">${esc(u.ip || "")}</div><div class="tip"><b>${esc(u.name)}</b><div>${esc(u.why)}</div></div></a>`).join("")}</div></section>`;
  return `<div class="sky"><i></i><i></i><i></i></div><div class="wrap">
    <div class="head"><div><div class="hello">${hi}, Raed</div><h1>Your homelab is <span>${Math.round((run / all.length) * 100)}% running</span></h1></div>
      <div class="stats"><div class="stat ok"><b>${run}</b><small>running</small></div><div class="stat"><b>${all.length - run}</b><small>stopped</small></div><div class="stat bad"><b>${bad}</b><small>need a look</small></div><div class="stat warn"><b>${M.unk.length}</b><small>unconfirmed</small></div><div class="stat"><b>${M.hosts.length}</b><small>VMs, LXCs & devices</small></div></div></div>
    <div class="search"><input id="q" placeholder="Search anything — app, container, IP, VLAN, VM…" value="${esc(q)}"><div class="chipbar">${[["all", "All"], ["run", "Running"], ["stop", "Stopped"], ["bad", "Problems"]].map(([k, l]) => `<button data-show="${k}" class="${show === k ? "on" : ""}">${l}</button>`).join("")}</div></div>
    <div class="rooms">${rooms}${unk}</div></div>`;
}

function B() {
  const all = M.rows, run = all.filter((r) => r.state === "running").length, bad = all.filter((r) => cls(r) === "bad").length, stop = all.length - run;
  const donut = (() => {
    const size = 170, st = 18, r = (size - st) / 2, c = 2 * Math.PI * r; let off = 0;
    const seg = [[run - bad, "#34d399"], [bad, "#fb7185"], [stop, "rgba(255,255,255,.22)"]];
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${seg.map(([n, col]) => { const len = (n / all.length) * c; const s = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="${st}" stroke-dasharray="${Math.max(len - 3, 0)} ${c}" stroke-dashoffset="${-off}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`; off += len; return s; }).join("")}
      <text x="50%" y="48%" text-anchor="middle" fill="#fff" font-size="40" font-weight="800" font-family="Plus Jakarta Sans">${run}</text><text x="50%" y="64%" text-anchor="middle" fill="#c4b5fd" font-size="13" font-weight="700" font-family="Plus Jakarta Sans">running</text></svg>`;
  })();
  const gauge = (lbl, p, color) => `<div class="g">${ring(p, 76, 9, color, "rgba(127,127,140,.15)").replace("</svg>", `<text x="50%" y="56%" text-anchor="middle" font-size="17" font-weight="800" fill="currentColor" font-family="Plus Jakarta Sans">${Math.round(p * 100)}%</text></svg>`)}${lbl}</div>`;
  const nodes = D.nodes.map((n) => {
    const wl = D.workloads.filter((w) => w.node_id === n.id);
    return `<div class="c node"><div><div class="k">Proxmox node</div><h3>${esc(n.name)}</h3><div class="facts" style="margin-top:8px"><span>${esc(n.ip)}</span><span>${wl.filter((w) => w.status === "running").length}/${wl.length} guests</span><span>${n.maxcpu || "?"} cores</span></div></div>
      <div class="gauges" style="justify-self:end">${gauge("CPU", n.cpu || 0, "#6366f1")}${gauge("Memory", n.maxmem ? n.mem / n.maxmem : 0, "#0ea5e9")}${gauge("Disk", n.maxdisk ? n.disk / n.maxdisk : 0, "#a855f7")}</div></div>`;
  }).join("");
  const vms = M.hosts.map((h) => {
    const rs = h.rows.filter(hit); if (!rs.length && (q || show !== "all")) return "";
    const wide = h.rows.length > 12 ? " wide" : "";
    return `<div class="c vm${wide}"><div class="vm-h"><span class="id">${h.kind === "DEVICE" ? "HW" : h.kind + " " + h.id}</span><h3>${esc(h.name)}</h3><span class="st ${h.status === "running" ? "" : "off"}">● ${h.running}/${h.rows.length}</span></div>
      <div class="facts"><span>${esc(h.ip || "no IP")}</span><span>VLAN ${esc(h.vlan || "—")}</span><span>${esc(h.node)}</span>${h.portainer ? `<a href="${esc(h.portainer)}" target="_blank">Portainer ↗</a>` : ""}${h.traefik ? `<a href="${esc(h.traefik)}" target="_blank">Traefik ↗</a>` : ""}</div>
      ${rs.length ? `<div class="mosaic">${rs.map((r) => `<a class="tile ${cls(r)}" ${r.url ? `href="${esc(r.url)}" target="_blank"` : ""}>${ic(r.icon, r.name)}<i></i><span class="lbl">${esc(r.name)} · ${esc(r.state)}${r.url ? " · " + esc(short(r.url)) : ""}</span></a>`).join("")}</div>` : `<div class="k" style="text-transform:none;letter-spacing:0">${esc(h.note || "Nothing inside")}</div>`}</div>`;
  }).join("");
  const probs = all.filter((r) => cls(r) === "bad").slice(0, 6);
  return `<div class="wrap"><div class="top"><h1>Homelab</h1><input class="q" id="q" placeholder="Search apps, IPs, VLANs, VMs…" value="${esc(q)}"></div>
    <div class="bento">
      <div class="c hero"><div><div class="k">Everything you run</div><div class="big">${all.length}</div><div style="font-weight:700;margin-top:6px">services on ${M.hosts.length} hosts</div>
        <div class="legend"><span><i style="background:#34d399"></i>${run - bad} healthy</span><span><i style="background:#fb7185"></i>${bad} need a look</span><span><i style="background:rgba(255,255,255,.3)"></i>${stop} stopped</span></div></div>${donut}</div>
      ${nodes}
      <div class="c alert"><div class="k">Needs attention</div><div class="big">${bad}</div><div class="list" style="margin-top:10px">${probs.map((r) => `<div>${esc(r.name)}<span class="u">${esc(r.host.name)}</span></div>`).join("")}</div></div>
      <div class="c unk"><div class="k">Unconfirmed</div><div class="big">${M.unk.length}</div><div class="list" style="margin-top:10px">${M.unk.slice(0, 6).map((u) => `<div>${esc(u.name)}<span class="u">${esc(u.ip || "")}</span></div>`).join("")}</div></div>
      ${vms}
    </div></div>`;
}

function render() {
  document.body.className = style;
  M = build();
  $("#app").innerHTML = (style === "A" ? A() : B()) + `<div class="switch">${[["A", "A · Aurora"], ["B", "B · Bento"]].map(([k, l]) => `<button data-s="${k}" class="${style === k ? "on" : ""}">${l}</button>`).join("")}</div>`;
  document.querySelectorAll("[data-s]").forEach((b) => b.onclick = () => { style = b.dataset.s; history.replaceState(null, "", "?s=" + style); render(); });
  document.querySelectorAll("[data-show]").forEach((b) => b.onclick = () => { show = b.dataset.show; render(); });
  const i = $("#q"); i.oninput = () => { q = i.value.toLowerCase(); const p = i.selectionStart; render(); const n = $("#q"); n.focus(); n.setSelectionRange(p, p); };
}
fetch("/api/inventory").then((r) => r.json()).then((d) => { D = d; render(); });
