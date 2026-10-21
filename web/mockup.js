/* Mockup of the redesigned dashboard, rendered from the live /api/inventory. Read-only. */
"use strict";
const $ = (s, e = document) => e.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const CDN = "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/";
const ic = (slug, name) => {
  const L = esc((name || "?").replace(/[^A-Za-z0-9 ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase());
  return slug ? `<span class="ic"><img alt="" src="${CDN}svg/${esc(slug)}.svg" data-l="${L}"></span>` : `<span class="ic">${L}</span>`;
};
document.addEventListener("error", (e) => {
  const i = e.target; if (i.tagName !== "IMG" || !i.dataset.l) return;
  if (i.src.includes("/svg/")) { i.src = i.src.replace("/svg/", "/png/").replace(/\.svg$/, ".png"); return; }
  i.parentElement.textContent = i.dataset.l;
}, true);

let D, V = { tab: "services", group: "host", show: "all", q: "", unk: true };

const HEALTH = { up: ["ok", "Responds"], auth: ["ok", "Responds (login)"], reachable: ["ok", "Reachable"], degraded: ["warn", "Answers with an error"],
  down: ["bad", "Not responding"], "dns-fail": ["bad", "No DNS name"], unreachable: ["na", "Can't reach from dashboard"], unverified: ["na", "Not checked"] };

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

function stCell(s) {
  if (s === "running") return '<span class="st run">Running</span>';
  if (["exited", "dead", "stopped", "created"].includes(s)) return '<span class="st stop">Stopped</span>';
  if (s === "restarting") return '<span class="st bad">Restarting</span>';
  return '<span class="st warn">Unknown</span>';
}
function hCell(h, url) {
  if (!url) return '<span class="hl na">No web page</span>';
  const [c, t] = HEALTH[h] || ["na", "Not checked"];
  return `<span class="hl ${c}">${t}</span>`;
}
function match(r) {
  if (V.show === "running" && r.state !== "running") return false;
  if (V.show === "stopped" && r.state === "running") return false;
  if (V.show === "problems" && !(r.state === "restarting" || ["down", "dns-fail", "degraded"].includes(r.health) || (r.state !== "running" && r.url))) return false;
  if (!V.q) return true;
  const q = V.q.toLowerCase();
  return [r.name, r.cname, r.image, r.url, r.addr, r.compose, r.host?.name, r.host?.ip, r.vlan, r.host?.node].some((x) => x && String(x).toLowerCase().includes(q));
}
function table(rows, showHost) {
  return `<table><thead><tr><th>Service</th><th>State</th><th>Open</th><th class="hide-m">IP : port</th>${showHost ? '<th class="hide-m">Runs on</th>' : '<th class="hide-m">Stack</th>'}<th class="hide-m">Web check</th></tr></thead><tbody>
  ${rows.map((r) => `<tr><td><div class="nm">${ic(r.icon, r.name)}<div>${esc(r.name)}<div class="sub mono">${esc(r.cname !== r.name ? r.cname : "")}${r.cname && r.image ? " · " : ""}${esc(r.image)}</div></div></div></td>
    <td>${stCell(r.state)}</td>
    <td class="url">${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a>` : '<span class="muted">—</span>'}</td>
    <td class="hide-m mono">${esc(r.addr)}</td>
    <td class="hide-m sideinfo">${showHost ? `${esc(r.host.kind)} ${esc(r.host.id)} ${esc(r.host.name)} · ${esc(r.host.node)}` : esc(r.compose || "—")}</td>
    <td class="hide-m">${hCell(r.health, r.url)}</td></tr>`).join("")}</tbody></table>`;
}
function hostHeader(h) {
  const facts = [["Node", h.node], ["IP", h.ips.join(", ") || "—"], ["VLAN", h.vlan || "—"], h.mem != null ? ["Memory", h.mem + "%"] : null].filter(Boolean);
  return `<div class="gh">${h.kind !== "DEVICE" ? `<span class="kind">${h.kind} ${esc(h.id)}</span>` : '<span class="kind">PHYSICAL</span>'}<span class="t">${esc(h.name)}</span>
    ${stCell(h.status === "running" ? "running" : "stopped")}<span class="count">${h.running}/${h.rows.length} running</span>
    <div class="facts">${facts.map(([k, v]) => `<span class="f">${k} <b class="mono">${esc(v)}</b></span>`).join("")}</div>
    <div class="links">${h.portainer ? `<a class="lnk" href="${esc(h.portainer)}" target="_blank">Portainer ↗</a>` : ""}${h.traefik ? `<a class="lnk" href="${esc(h.traefik)}" target="_blank">Traefik ↗</a>` : ""}</div></div>`;
}
function vServices(m) {
  const all = m.rows, run = all.filter((r) => r.state === "running").length, stop = all.filter((r) => r.state !== "running" && r.state !== "unknown").length;
  const prob = all.filter((r) => r.state === "restarting" || ["down", "dns-fail", "degraded"].includes(r.health) || (r.state !== "running" && r.url)).length;
  const sum = `<div class="sum">
    <div class="sc" data-show="all"><div class="k">Services & containers</div><div class="v">${all.length}</div><div class="s">on ${m.hosts.length} hosts</div></div>
    <div class="sc" data-show="running"><div class="k">Running</div><div class="v" style="color:var(--ok)">${run}</div><div class="s">containers + services</div></div>
    <div class="sc" data-show="stopped"><div class="k">Stopped</div><div class="v">${stop}</div><div class="s">exited or guest off</div></div>
    <div class="sc bad" data-show="problems"><div class="k">Need attention</div><div class="v">${prob}</div><div class="s">restarting, down, no DNS</div></div>
    <div class="sc warn" data-jump="unk"><div class="k">Unconfirmed</div><div class="v">${m.unk.length}</div><div class="s">not found in Proxmox</div></div></div>`;
  const tool = `<div class="tool"><span class="lbl">Group by</span><div class="seg">${[["host", "VM / LXC"], ["vlan", "VLAN"], ["flat", "One list"]].map(([k, l]) => `<button data-group="${k}" class="${V.group === k ? "on" : ""}">${l}</button>`).join("")}</div>
    <span class="lbl">Show</span><div class="seg">${[["all", "All"], ["running", "Running"], ["stopped", "Stopped"], ["problems", "Problems"]].map(([k, l]) => `<button data-show2="${k}" class="${V.show === k ? "on" : ""}">${l}</button>`).join("")}</div></div>`;
  let body = "";
  if (V.group === "host") {
    body = m.hosts.map((h) => {
      const rs = h.rows.filter(match);
      if (!rs.length && (V.q || V.show !== "all")) return "";
      return `<section class="grp">${hostHeader(h)}${rs.length ? table(rs, false) : `<div style="padding:14px 16px" class="muted">${esc(h.note || "Nothing found inside.")}</div>`}</section>`;
    }).join("");
  } else if (V.group === "vlan") {
    const by = {};
    m.rows.filter(match).forEach((r) => (by[r.vlan || "unknown"] = by[r.vlan || "unknown"] || []).push(r));
    body = Object.keys(by).sort((a, b) => (+a || 999) - (+b || 999)).map((k) => `<section class="grp"><div class="gh"><span class="kind">VLAN</span><span class="t">${esc(k)}</span><span class="count">${by[k].length} services</span></div>${table(by[k], true)}</section>`).join("");
  } else {
    body = `<section class="grp">${table(m.rows.filter(match).sort((a, b) => a.name.localeCompare(b.name)), true)}</section>`;
  }
  const unk = m.unk.filter((u) => !V.q || [u.name, u.ip, u.url].some((x) => x && x.toLowerCase().includes(V.q.toLowerCase())));
  const unkHtml = `<section class="grp unk" id="unk"><div class="gh"><span class="tag-unk">⚠ UNCONFIRMED</span><span class="t">Found on the network, not in Proxmox</span>
    <span class="muted" style="font-size:12.5px">These come from UniFi device names, DNS records or proxy configs. Confirm, fix, or hide each one in Admin.</span></div>
    <table><thead><tr><th>Name</th><th>Why it's here</th><th>Address</th><th class="hide-m">Web check</th><th></th></tr></thead><tbody>
    ${unk.map((u) => `<tr><td><div class="nm">${ic(u.icon, u.name)}${esc(u.name)}</div></td><td class="why">${esc(u.why)}</td>
      <td class="mono">${u.url ? `<a href="${esc(u.url)}" target="_blank">${esc(u.url.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a>` : esc(u.ip || "—")}</td>
      <td class="hide-m">${hCell(u.health, u.url)}</td><td><div class="act"><button title="Mockup">Confirm</button><button title="Mockup">Hide</button></div></td></tr>`).join("")}</tbody></table></section>`;
  return sum + tool + body + unkHtml;
}

function vAdmin() {
  const src = (n) => (D.sources || []).find((s) => (s.name || "").startsWith(n)) || {};
  const pve = src("Proxmox API"), port = src("Portainer API"), ha = src("Home Assistant");
  const conn = (icon, title, s, gives, how, placeholder) => `<div class="card conn">${ic(icon, title)}<div><h3>${title}</h3>
    <ul class="gives">${gives.map((g) => `<li>${g}</li>`).join("")}</ul>
    <details class="how"><summary>How do I get this?</summary><ol>${how.map((h) => `<li>${h}</li>`).join("")}</ol></details>
    <div class="field"><input type="password" placeholder="${esc(placeholder)}" disabled><button class="btn" disabled>Test</button><button class="btn p" disabled>Save</button></div></div>
    <div>${s.status === "ok" ? `<span class="pillok">Connected · ${esc(s.detail || "")}</span>` : '<span class="pilloff">Not connected</span>'}</div></div>`;
  return `<div class="adm"><nav class="anav">${["Connections", "Services", "Hosts & devices", "Categories & icons", "Checks & schedule", "Backup / import"].map((x, i) => `<button class="${i === 0 ? "on" : ""}">${x}</button>`).join("")}</nav><div>
  <div class="card"><h3>Mode</h3><div class="mode"><label><input type="radio" name="m" checked disabled> Live — use the API connections below</label><label><input type="radio" name="m" disabled> Offline — use the last imported scan only</label></div>
    <p class="muted" style="margin:8px 0 0;font-size:12.5px">Every connection is optional. Without one, the dashboard uses the last scan you uploaded (Backup / import → upload <span class="mono">collect-proxmox.sh</span> result) and shows its date.</p></div>
  ${conn("proxmox", "Proxmox VE (read-only)", pve, ["All VMs and LXCs on both nodes, running or stopped", "IPs, VLANs, memory and CPU — refreshed live", "Cannot start, stop or change anything (PVEAuditor role)"],
    ["In Proxmox: Datacenter → Permissions → Users → Add: <code>dashboard</code>, realm <code>pve</code>", "Datacenter → Permissions → Add → User permission: path <code>/</code>, user <code>dashboard@pve</code>, role <code>PVEAuditor</code>", "Datacenter → Permissions → API Tokens → Add: user <code>dashboard@pve</code>, token ID <code>dash</code>, untick <i>Privilege Separation</i>", "Copy the secret shown once and paste it here as <code>dashboard@pve!dash=secret</code>"],
    "dashboard@pve!dash=xxxxxxxx-xxxx-…")}
  ${conn("portainer", "Portainer (read-only, optional)", port, ["Every container in every Portainer, live: running / stopped / restarting", "Traefik routes from container labels — no script needed any more", "One token per Portainer server"],
    ["Open Portainer → Users → Add user <code>dashboard</code> (Business: role <i>Read-only user</i>)", "Log in as <code>dashboard</code> → My account → Access tokens → Add access token", "Paste it here with the Portainer address, e.g. <code>10.10.30.30:9443</code>", "Repeat for each Portainer (Arr-Stack, Ubuntu-Media, Frigate…)"],
    "10.10.30.30:9443 = ptr_xxxxxxxx…")}
  ${conn("ubiquiti-unifi", "UniFi (read-only, optional)", {}, ["Real network and VLAN names, DHCP reservations", "Your local DNS records — shows exactly which to fix", "Offline and previously seen devices"],
    ["UniFi Network → Settings → Control Plane → Integrations → Create API key", "Paste it here"], "UniFi API key")}
  ${conn("home-assistant", "Home Assistant (optional)", ha, ["Add-ons and their state", "Network clients seen by Home Assistant"], ["HA → your profile → Security → Long-lived access tokens → Create", "Paste it here"], "eyJhbGciOi…")}
  </div></div>`;
}

function render() {
  const m = build();
  $("#app").innerHTML = `<div class="banner">MOCKUP for discussion — real live data from your homelab; buttons in Admin are not wired yet.</div>
  <header class="top"><div class="topin"><div class="logo"><img src="icon.svg" alt="">Homelab</div>
    <nav class="tabs"><button data-tab="services" class="${V.tab === "services" ? "on" : ""}">My services</button><button data-tab="admin" class="${V.tab === "admin" ? "on" : ""}">Admin</button></nav>
    <div class="search"><input id="q" placeholder="Find a container, app, IP, VLAN, VM…" value="${esc(V.q)}"></div></div></header>
  <main>${V.tab === "services" ? vServices(m) : vAdmin()}</main>`;
  document.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { V.tab = b.dataset.tab; render(); });
  document.querySelectorAll("[data-group]").forEach((b) => b.onclick = () => { V.group = b.dataset.group; render(); });
  document.querySelectorAll("[data-show2]").forEach((b) => b.onclick = () => { V.show = b.dataset.show2; render(); });
  document.querySelectorAll("[data-show]").forEach((b) => b.onclick = () => { V.show = b.dataset.show; render(); });
  document.querySelectorAll("[data-jump]").forEach((b) => b.onclick = () => $("#unk").scrollIntoView({ behavior: "smooth" }));
  const q = $("#q"); if (q) q.oninput = () => { V.q = q.value; const p = q.selectionStart; render(); const n = $("#q"); n.focus(); n.setSelectionRange(p, p); };
}
fetch("/api/inventory").then((r) => r.json()).then((d) => { D = d; render(); });
