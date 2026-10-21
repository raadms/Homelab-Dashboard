/* Homelab dashboard — Aurora. Vanilla JS, no build step.
 * Data: /api/inventory (discovered facts merged with your admin edits).
 * Nothing here can change infrastructure; admin calls only edit the dashboard. */
"use strict";

// ------------------------------------------------------------------ utilities
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ls = {
  get(k, d) { try { const v = localStorage.getItem("hd." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("hd." + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const ago = (iso) => {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now"; if (s < 3600) return Math.round(s / 60) + " min ago";
  if (s < 86400) return Math.round(s / 3600) + " h ago"; return Math.round(s / 86400) + " d ago";
};
const fmtTime = (iso) => iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";
const pct = (a, b) => (a && b ? Math.round((a / b) * 100) : 0);
const gb = (b) => (b ? (b / 1073741824).toFixed(1) + " GB" : "—");
const short = (u) => (u || "").replace(/^https?:\/\//, "").replace(/\/$/, "");

async function api(path, opts = {}) {
  const o = { method: opts.method || "GET", headers: { "X-Dashboard": "1" }, credentials: "same-origin" };
  if (opts.body !== undefined) {
    if (opts.raw) { o.body = opts.body; o.headers["Content-Type"] = "application/gzip"; }
    else { o.body = JSON.stringify(opts.body); o.headers["Content-Type"] = "application/json"; }
  }
  const r = await fetch(path, o);
  const t = await r.text();
  let j; try { j = t ? JSON.parse(t) : null; } catch { j = { error: t }; }
  if (!r.ok) throw Object.assign(new Error((j && j.error) || r.statusText), { status: r.status });
  return j;
}
function toast(msg) {
  const t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2800);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast("Copied"); }
  catch {
    const ta = document.createElement("textarea"); ta.value = text; ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast("Copied"); } catch { toast("Copy failed — select and copy manually"); }
    ta.remove();
  }
}

// ------------------------------------------------------------------ icons
const P = {
  home: "M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  tree: "M5 3h6v5H5zM13 16h6v5h-6zM13 9h6v5h-6zM8 8v10.5h5M8 11.5h5",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z",
  dev: "M4 5h16v11H4zM8 20h8M12 16v4",
  digest: "M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7",
  pulse: "M3 12h4l2-6 4 12 2-6h6",
  gear: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h0a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v0a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4",
  star: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z",
  ext: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  copy: "M8 8h11v12H8zM5 16V4h11",
  x: "M6 6l12 12M18 6 6 18",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  ok: "M5 12.5 10 17l9-10", warn: "M12 4 2.5 20h19zM12 10v4M12 17v.5", down: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 8l8 8M16 8l-8 8",
  lock: "M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3", q: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6M12 17v.5",
  cloud: "M7 18a4 4 0 0 1-.5-8 6 6 0 0 1 11.5 1.5A3.5 3.5 0 0 1 17.5 18z", pause: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM10 9v6M14 9v6",
  ban: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM5.6 5.6l12.8 12.8", play: "M7 5v14l11-7z", refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
};
Object.assign(P, {
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  alert: "M12 3 2 21h20zM12 10v5M12 18v.5",
  plug: "M9 7V3M15 7V3M6 7h12v4a6 6 0 0 1-12 0zM12 17v4",
  box: "M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10",
  server: "M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  palette: "M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.5 0-1.2-1-1.5-1-2.5S13.3 15 14.5 15H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8zM7.5 11h.01M10 7h.01M15 7h.01",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
  save: "M5 3h11l3 3v15H5zM8 3v6h8V3M8 21v-7h8v7",
  help: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6M12 17v.5",
  logout: "M15 4h4v16h-4M10 17l5-5-5-5M15 12H3",
  check: "M5 12.5 10 17l9-10", plus: "M12 5v14M5 12h14", trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
});
const svg = (name, cls = "") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[name] || P.q}"/></svg>`;

const STATUS = {
  up: ["Responds", "ok"], auth: ["Responds (login)", "lock"], reachable: ["Reachable", "ok"], degraded: ["Answers with an error", "warn"],
  down: ["Not responding", "down"], "dns-fail": ["No DNS name", "down"], unreachable: ["Can't reach from dashboard", "cloud"],
  unverified: ["Not checked yet", "q"], stopped: ["Stopped", "pause"], disabled: ["Turned off on purpose", "ban"], unsupported: ["Not a web page", "q"],
  verified: ["Verified", "ok"], configured: ["In DNS / proxy config", "globe"], discovered: ["Port seen open", "search"], inferred: ["Guessed", "q"],
  online: ["Online", "ok"], offline: ["Offline", "pause"], unknown: ["Unknown", "q"],
  high: ["High", "warn"], medium: ["Medium", "warn"], low: ["Low", "q"], info: ["Info", "q"],
};
const pill = (st, title = "") => {
  const [label, ic] = STATUS[st] || [st || "—", "q"];
  return `<span class="pill ${esc(st)}" title="${esc(title || label)}">${svg(ic)}${esc(label)}</span>`;
};
const CDN = "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/";
function icon(a, cls = "") {
  const ic = a.icon;
  const L = esc((a.name || "?").replace(/[^A-Za-z0-9 ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?");
  if (ic && /^https?:\/\//.test(ic)) return `<span class="ico ${cls}"><img alt="" src="${esc(ic)}" data-l="${L}" loading="lazy"></span>`;
  if (ic && /^[a-z0-9-]+$/.test(ic)) return `<span class="ico ${cls}"><img alt="" src="${CDN}svg/${esc(ic)}.svg" data-l="${L}" loading="lazy"></span>`;
  if (ic) return `<span class="ico ${cls}" aria-hidden="true">${esc(ic)}</span>`;
  return `<span class="ico ${cls}" aria-hidden="true">${L}</span>`;
}
document.addEventListener("error", (e) => {
  const i = e.target; if (i.tagName !== "IMG" || i.dataset.l === undefined) return;
  if (i.src.includes("/dashboard-icons/svg/")) { i.src = i.src.replace("/svg/", "/png/").replace(/\.svg$/, ".png"); return; }
  i.parentElement.textContent = i.dataset.l;
}, true);
const ring = (p, size, stroke, color, label) => {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(label || Math.round(p * 100) + "%")}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${Math.max(c * p, 0.01)} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    ${label !== undefined ? `<text x="50%" y="55%" text-anchor="middle" font-size="${size * 0.23}" font-weight="800" font-family="Plus Jakarta Sans">${esc(label)}</text>` : ""}</svg>`;
};

// ------------------------------------------------------------------ state
const S = {
  inv: null, me: { admin: false }, mode: ls.get("mode", null), q: "", favs: [], recents: ls.get("recents", []),
  show: "all", group: ls.get("group", "host"), route: "home", sel: null, adminTab: ls.get("adminTab", "connections"),
};
async function load() {
  const [inv, me, favs] = await Promise.all([api("/api/inventory"), api("/api/me"), api("/api/prefs/favorites").catch(() => [])]);
  S.inv = inv; S.me = me; S.favs = favs || [];
  if (!S.mode) S.mode = inv.settings_public?.default_access_mode || "domain";
  index();
}
function index() {
  const inv = S.inv;
  S.nodeById = new Map(inv.nodes.map((n) => [n.id, n]));
  S.wlById = new Map(inv.workloads.map((w) => [w.id, w]));
  S.devById = new Map(inv.devices.map((d) => [d.id, d]));
  S.ctById = new Map(inv.containers.map((c) => [c.id, c]));
  S.appMap = new Map();
  for (const a of inv.apps) { S.appMap.set(a.id, a); for (const al of a.aliases || []) S.appMap.set(al, a); a._fav = a.favorite || S.favs.includes(a.id); }
  S.model = buildModel();
}
const epOf = (a, id) => a && a.endpoints.find((e) => e.id === id);
function preferred(a, mode = S.mode) {
  if (!a) return null;
  const d = epOf(a, a.preferred_domain), i = epOf(a, a.preferred_ip);
  return mode === "ip" ? (i || null) : (d || i || null);
}
function recordOpen(id) { S.recents = [id, ...S.recents.filter((x) => x !== id)].slice(0, 12); ls.set("recents", S.recents); }
async function toggleFav(id) {
  const a = S.appMap.get(id); if (!a) return;
  a._fav = !a._fav;
  S.favs = a._fav ? [...new Set([...S.favs, a.id])] : S.favs.filter((x) => x !== a.id);
  try { await api("/api/prefs/favorites", { method: "PUT", body: { favorites: S.favs } }); } catch (e) { toast("Could not save favorite: " + e.message); }
  render();
}

// ------------------------------------------------------------------ the model: hosts → rows
const BADH = ["down", "dns-fail", "degraded"];
function rowClass(r) {
  if (r.unconfirmed) return "unk";
  if (r.state === "restarting" || (r.state === "running" && BADH.includes(r.health))) return "bad";
  if (r.state === "running") return "run";
  if (r.state === "unknown") return r.health && !BADH.includes(r.health) && r.health !== "unreachable" && r.health !== "unverified" ? "run" : (BADH.includes(r.health) ? "bad" : "unk");
  return "stop";
}
function buildModel() {
  const D = S.inv, hosts = [], unk = [];
  const appsByCt = new Map(), appsByWl = new Map();
  for (const a of D.apps) {
    const L = a.location || {};
    if (L.container_id) appsByCt.set(L.container_id, a);
    else if (L.workload_id) (appsByWl.get(L.workload_id) || appsByWl.set(L.workload_id, []).get(L.workload_id)).push(a);
  }
  const mkRow = (o) => Object.assign({ state: "unknown", addr: "—" }, o);
  for (const w of [...D.workloads].sort((x, y) => (x.status === "running" ? 0 : 1) - (y.status === "running" ? 0 : 1) || (x.node + String(x.vmid).padStart(5)).localeCompare(y.node + String(y.vmid).padStart(5)))) {
    const portainer = D.apps.find((a) => a.location?.workload_id === w.id && a.catalog_key === "portainer" && a.runtime?.state === "running");
    const traefik = D.apps.find((a) => a.location?.workload_id === w.id && a.catalog_key === "traefik" && a.endpoints.some((e) => e.kind === "domain"));
    const h = { key: w.id, kind: w.kind === "vm" ? "VM" : "LXC", id: w.vmid, name: w.display_name || w.name, node: w.node, ips: w.ips || [], vlan: (w.vlans || []).join(", "),
      status: w.disabled ? "disabled" : w.status, mem: w.maxmem ? w.mem / w.maxmem : null, rows: [], wl: w,
      portainer: preferred(portainer, "ip")?.url || preferred(portainer)?.url, traefik: traefik ? preferred(traefik, "domain")?.url : null,
      note: w.status !== "running" ? "This guest is stopped." : (w.kind === "vm" && !w.guest_collected_at ? "No QEMU guest agent, so the apps inside this VM can't be seen. Enable the agent or upload a scan." : null) };
    for (const c of D.containers.filter((c) => c.host_id === w.id)) {
      const a = appsByCt.get(c.id);
      if (a && a.hidden && !S.showHidden) continue;
      const ep = preferred(a);
      const tr = (c.traefik_routes || []).filter((r) => r.hosts.some((x) => x.includes(".")));
      h.rows.push(mkRow({ type: "container", key: a?.id || c.id, name: a ? a.name.replace(/ · .*$/, "").replace(/ \(.*\)$/, "") : c.name, cname: c.name, icon: a?.icon,
        image: c.image, state: c.state, url: ep?.url, health: ep?.health, compose: c.compose_project, app: a, ct: c, host: h, vlan: h.vlan, category: a?.category || "Containers (no web page)",
        addr: c.ports.length ? c.ports.map((p) => `${c.host_ip}:${p.host_port}`).join(", ") : tr.length ? `Traefik → ${tr[0].port ? ":" + tr[0].port : "container"}` : "internal only" }));
    }
    for (const a of appsByWl.get(w.id) || []) {
      if (a.hidden && !S.showHidden) continue;
      const ep = preferred(a);
      const st = a.status === "disabled" ? "disabled" : a.runtime?.state === "running" ? "running" : ["up", "auth", "reachable", "degraded"].includes(ep?.health) ? "running" : w.status !== "running" ? "exited" : "unknown";
      h.rows.push(mkRow({ type: "service", key: a.id, name: a.name.replace(/ \(.*\)$/, ""), cname: a.runtime?.process || "", icon: a.icon, image: "installed on the guest",
        state: st, url: ep?.url, health: ep?.health, app: a, host: h, vlan: h.vlan, category: a.category, addr: a.endpoints.filter((e) => e.kind === "ip").map((e) => `${e.host}:${e.port}`).join(", ") || "—" }));
    }
    h.running = h.rows.filter((r) => rowClass(r) === "run").length;
    hosts.push(h);
  }
  // Outside Proxmox, confirmed by Home Assistant (it manages its add-ons)
  const haApps = D.apps.filter((a) => (a.kind === "addon" || a.id === "app:ha:main") && (!a.hidden || S.showHidden));
  if (haApps.length) {
    const ha = { key: "ha", kind: "DEVICE", id: "", name: "Home Assistant Yellow", node: "physical device", ips: ["10.10.1.10"], vlan: "1", status: "running", rows: [] };
    for (const a of haApps) {
      const ep = preferred(a);
      ha.rows.push(mkRow({ type: a.kind === "addon" ? "add-on" : "service", key: a.id, name: a.name.replace(/ · .*$/, ""), cname: a.location?.addon || "core", icon: a.icon,
        image: a.runtime?.version ? "v" + a.runtime.version : "", state: a.runtime?.state === "stopped" ? "exited" : a.runtime?.state === "running" ? "running" : (ep?.health === "up" ? "running" : "unknown"),
        url: ep?.url, health: ep?.health, app: a, host: ha, vlan: "1", category: a.category }));
    }
    ha.running = ha.rows.filter((r) => rowClass(r) === "run").length;
    hosts.push(ha);
  }
  // Manual entries the admin added
  const man = D.apps.filter((a) => a.manual && (!a.hidden || S.showHidden));
  if (man.length) {
    const mh = { key: "manual", kind: "MANUAL", id: "", name: "Added by you", node: "manual", ips: [], vlan: "", status: "running", rows: [] };
    for (const a of man) { const ep = preferred(a); mh.rows.push(mkRow({ type: "manual", key: a.id, name: a.name, icon: a.icon, state: ["up", "auth"].includes(ep?.health) ? "running" : "unknown", url: ep?.url, health: ep?.health, app: a, host: mh, category: a.category, addr: a.location?.host_ip || "—" })); }
    mh.running = mh.rows.filter((r) => rowClass(r) === "run").length;
    hosts.push(mh);
  }
  const placed = new Set(hosts.flatMap((h) => h.rows.map((r) => r.app?.id)).filter(Boolean));
  for (const a of D.apps) {
    if (placed.has(a.id) || a.location?.workload_id || a.location?.node_id || a.manual || (a.hidden && !S.showHidden)) continue;
    const ep = preferred(a);
    const why = a.sources.some((s) => s.startsWith("DNS")) ? "Only a DNS name points here — no running app was found behind it"
      : a.sources.some((s) => s.startsWith("UniFi")) ? `Guessed from the UniFi device name “${a.location?.host_label || "?"}”`
      : a.sources.some((s) => s.includes("route")) ? "Only a proxy route mentions it" : "Not seen in Proxmox";
    const row = mkRow({ type: "network", key: a.id, name: a.name.replace(/ · .*$/, ""), icon: a.icon, url: ep?.url, health: ep?.health, app: a, why, vlan: a.vlan != null ? String(a.vlan) : "",
      addr: a.location?.host_ip || "—", category: a.category, state: ["up", "auth", "reachable"].includes(ep?.health) ? "running" : "unknown", unconfirmed: !a.confirmed });
    if (a.confirmed) {
      let h = hosts.find((x) => x.key === "confirmed");
      if (!h) { h = { key: "confirmed", kind: "NETWORK", id: "", name: "Other devices & services", node: "outside Proxmox", ips: [], vlan: "", status: "running", rows: [] }; hosts.push(h); }
      row.host = h; h.rows.push(row);
    } else unk.push(row);
  }
  for (const h of hosts) h.running = h.rows.filter((r) => rowClass(r) === "run").length;
  const rows = hosts.flatMap((h) => h.rows);
  return { hosts, rows, unk };
}
function rowMatch(r) {
  const c = rowClass(r);
  if (S.show === "run" && c !== "run") return false;
  if (S.show === "stop" && c !== "stop") return false;
  if (S.show === "bad" && c !== "bad") return false;
  if (S.show === "fav" && !r.app?._fav) return false;
  if (!S.q) return true;
  const q = S.q.toLowerCase();
  return [r.name, r.cname, r.image, r.url, r.addr, r.compose, r.host?.name, r.host?.ips?.join(" "), r.vlan, r.host?.node, r.category, r.app?.discovered_name].some((x) => x && String(x).toLowerCase().includes(q));
}

// ------------------------------------------------------------------ shell
const NAV = [["home", "Home", "home"], ["services", "Services", "list"], ["network", "Network", "globe"], ["issues", "Issues", "alert"], ["admin", "Admin", "gear"]];
function shell(inner) {
  const issues = S.inv.issues.filter((i) => i.severity === "high" || i.severity === "medium").length;
  const title = S.inv.settings_public?.dashboard_title || "Homelab";
  const item = ([k, label, ic]) => `<a href="#/${k}" class="${S.route === k ? "on" : ""}">${svg(ic)}<span>${label}</span>${k === "issues" && issues ? `<span class="badge">${issues}</span>` : ""}</a>`;
  return `<div class="sky" aria-hidden="true"><i></i><i></i><i></i></div><div class="app">
  <header class="top"><div class="topin"><a class="brand" href="#/home"><img src="icon.svg" alt="">${esc(title)}</a><nav class="nav">${NAV.map(item).join("")}</nav>
    <div class="right"><div class="seg" role="group" aria-label="Open links by"><button data-mode="domain" class="${S.mode === "domain" ? "on" : ""}" title="Open apps by their domain name">Domain</button><button data-mode="ip" class="${S.mode === "ip" ? "on" : ""}" title="Open apps by IP address and port">IP</button></div></div></div></header>
  <main>${inner}</main>
  <nav class="tabbar" aria-label="Sections">${NAV.map(([k, label, ic]) => `<a href="#/${k}" class="${S.route === k ? "on" : ""}">${svg(ic)}${label}${k === "issues" && issues ? `<span class="badge">${issues}</span>` : ""}</a>`).join("")}</nav></div>`;
}
function searchBox(ph) {
  return `<div class="search" role="search">${svg("search")}<input id="q" type="search" autocomplete="off" placeholder="${esc(ph)}" aria-label="Search" value="${esc(S.q)}"><kbd>/</kbd></div>`;
}
function filterChips() {
  return `<div class="fchips">${[["all", "All"], ["run", "Running"], ["stop", "Stopped"], ["bad", "Problems"], ["fav", "★ Favorites"]].map(([k, l]) => `<button data-show="${k}" class="${S.show === k ? "on" : ""}">${l}</button>`).join("")}</div>`;
}

// ------------------------------------------------------------------ home
function appTile(r) {
  const c = rowClass(r);
  const a = r.app;
  const tip = `<div class="tip"><b>${esc(r.name)}</b><div>${esc(c === "run" ? "Running" : c === "stop" ? "Stopped" : c === "bad" ? "Has a problem" : "Not confirmed")}${r.image ? " · " + esc(r.image) : ""}</div>
    ${r.url ? `<div>↗ ${esc(short(r.url))}${r.health ? " — " + esc(STATUS[r.health]?.[0] || r.health) : ""}</div>` : "<div>No web page</div>"}<div>${esc(r.addr)}</div>
    ${r.compose ? `<div>Stack: ${esc(r.compose)}</div>` : ""}${r.why ? `<div>${esc(r.why)}</div>` : ""}</div>`;
  const inner = `${icon({ name: r.name, icon: r.icon })}<div class="n">${esc(r.name)}</div><div class="p">${esc(r.addr === "internal only" ? "internal" : String(r.addr).split(",")[0])}</div>
    ${a?._fav ? `<span class="fav">${svg("star")}</span>` : ""}${a ? `<button class="info" data-details="${esc(a.id)}" aria-label="Details for ${esc(r.name)}">${svg("help")}</button>` : ""}${tip}`;
  const label = `${r.name}: ${c === "run" ? "running" : c === "stop" ? "stopped" : c === "bad" ? "problem" : "unconfirmed"}`;
  return r.url
    ? `<a class="app-t ${c}" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" data-open="${esc(r.key)}" aria-label="${esc(label)}">${inner}</a>`
    : `<div class="app-t ${c}" ${a ? `data-details="${esc(a.id)}"` : ""} role="button" tabindex="0" aria-label="${esc(label)}">${inner}</div>`;
}
function room(h, rows) {
  const p = h.rows.length ? h.running / h.rows.length : 0;
  const tag = h.kind === "DEVICE" ? "DEVICE" : h.kind === "MANUAL" ? "MANUAL" : h.kind === "NETWORK" ? "NETWORK" : `${h.kind} ${h.id}`;
  return `<section class="glass room"><div class="room-h"><span class="tag">${esc(tag)}</span><div style="min-width:0"><h2>${esc(h.name)}</h2>
    <div class="meta">${h.ips.length ? `<b class="mono">${esc(h.ips.join(", "))}</b> · ` : ""}${h.vlan ? `VLAN <b>${esc(h.vlan)}</b> · ` : ""}${esc(h.node)}</div></div>
    ${ring(p, 46, 5, h.status === "running" ? "#34d399" : "#64748b", undefined)}</div>
    <div class="links">${h.portainer ? `<a href="${esc(h.portainer)}" target="_blank" rel="noopener">Portainer ↗</a>` : ""}${h.traefik ? `<a href="${esc(h.traefik)}" target="_blank" rel="noopener">Traefik ↗</a>` : ""}
      <span>${h.running}/${h.rows.length} running</span>${h.status === "stopped" ? '<span>guest stopped</span>' : h.status === "disabled" ? "<span>turned off on purpose</span>" : ""}${h.note && h.status === "running" ? `<span class="warn" title="${esc(h.note)}">can't see inside</span>` : ""}</div>
    ${rows.length ? `<div class="apps">${rows.map(appTile).join("")}</div>` : `<div class="nothing">${esc(h.note || "Nothing found inside.")}</div>`}</section>`;
}
function nodeTile(n) {
  const wl = S.inv.workloads.filter((w) => w.node_id === n.id);
  const gauge = (lbl, p, col) => `<div class="gauge">${ring(p || 0, 84, 9, col, Math.round((p || 0) * 100) + "%")}${lbl}</div>`;
  return `<section class="glass nodet"><div><div class="k">Proxmox node</div><h2>${esc(n.name)}</h2>
    <div class="chips"><span class="chip">${esc(n.ip)}</span><span class="chip">${wl.filter((w) => w.status === "running").length}/${wl.length} guests</span>${n.maxcpu ? `<span class="chip">${n.maxcpu} cores</span>` : ""}${n.uptime ? `<span class="chip">up ${Math.round(n.uptime / 86400)} d</span>` : ""}</div></div>
    ${n.verified ? `<div class="gauges">${gauge("CPU", n.cpu, "#818cf8")}${gauge("Memory", n.maxmem ? n.mem / n.maxmem : 0, "#38bdf8")}${gauge("Disk", n.maxdisk ? n.disk / n.maxdisk : 0, "#c084fc")}</div>` : '<div class="muted small">Not connected — add the Proxmox connection in Admin</div>'}</section>`;
}
function vHome() {
  const M = S.model, all = M.rows;
  if (!all.length && !M.unk.length && !S.inv.nodes.some((n) => n.verified)) {
    return `<div class="glass login" style="max-width:640px"><div class="hello">Welcome</div><h1 style="margin:6px 0 10px">Let's find everything you run</h1>
      <p class="muted">Connect Proxmox (read-only) and the dashboard fills itself: every VM, LXC, container, IP and VLAN. Add Portainer, UniFi and Home Assistant for even more. Prefer no API access? Upload a scan instead.</p>
      <div class="row" style="margin-top:16px"><a class="btn primary" href="#/admin" data-goto="connections">${svg("plug")}Connect Proxmox</a><a class="btn" href="#/admin" data-goto="backup">${svg("save")}Upload a scan</a></div></div>`;
  }
  const run = all.filter((r) => rowClass(r) === "run").length, bad = all.filter((r) => rowClass(r) === "bad").length, stop = all.filter((r) => rowClass(r) === "stop").length;
  const hr = new Date().getHours(), hi = hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
  const owner = S.inv.settings_public?.owner_name;
  const stat = (k, n, l, cls) => `<button class="stat ${cls} ${S.show === k ? "on" : ""}" data-show="${k}"><b>${n}</b><small>${l}</small></button>`;
  let body;
  if (S.group === "host") {
    body = M.hosts.map((h) => { const rs = h.rows.filter(rowMatch); return (!rs.length && (S.q || S.show !== "all")) ? "" : room(h, rs); }).join("");
  } else {
    const key = S.group === "vlan" ? (r) => (r.vlan ? "VLAN " + r.vlan : "VLAN unknown") : (r) => r.category || "Other";
    const by = {};
    all.filter(rowMatch).forEach((r) => (by[key(r)] = by[key(r)] || []).push(r));
    const order = S.inv.settings_public?.categories_order || [];
    body = Object.keys(by).sort((a, b) => S.group === "vlan" ? (parseInt(a.slice(5)) || 999) - (parseInt(b.slice(5)) || 999) : ((order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)) || a.localeCompare(b))
      .map((k) => { const rs = by[k]; const h = { kind: "GROUP", id: "", name: k, ips: [], vlan: "", node: `${rs.length} services`, status: "running", rows: rs, running: rs.filter((r) => rowClass(r) === "run").length }; return room(Object.assign(h, { kind: S.group === "vlan" ? "VLAN" : "GROUP" }), rs).replace(/<span class="tag">[^<]*<\/span>/, `<span class="tag">${S.group === "vlan" ? "VLAN" : "CATEGORY"}</span>`); }).join("");
  }
  const unk = M.unk.filter(rowMatch);
  const unkRoom = M.unk.length && (!S.q || unk.length) && S.show !== "stop" ? `<section class="glass room unk" id="unk"><div class="room-h"><span class="tag">⚠ UNCONFIRMED</span><div><h2>Seen on the network, not in Proxmox</h2>
      <div class="meta">Guessed from UniFi device names, DNS records or proxy configs. Confirm or hide each one in Admin → Unconfirmed.</div></div></div>
      <div class="apps">${unk.map(appTile).join("")}</div></section>` : "";
  return `<div class="hero"><div><div class="hello">${hi}${owner ? ", " + esc(owner) : ""}</div><h1>Your homelab is <span>${all.length ? Math.round((run / all.length) * 100) : 0}% running</span></h1>
      <div class="sub">Live from Proxmox ${esc(ago(S.inv.generated_at))} · web checks ${esc(ago(S.inv.engine?.checks?.last))}</div></div>
    <div class="stats">${stat("run", run, "running", "ok")}${stat("stop", stop, "stopped", "")}${stat("bad", bad, "need a look", "bad")}<button class="stat warn" data-jump="unk"><b>${M.unk.length}</b><small>unconfirmed</small></button>${stat("all", all.length, "services", "")}</div></div>
  <div class="nodes">${S.inv.nodes.map(nodeTile).join("")}</div>
  <div class="toolbar">${searchBox("Search anything — app, container, IP, VLAN, VM…")}${filterChips()}</div>
  <div class="grouping">Group by <div class="seg">${[["host", "VM / LXC"], ["vlan", "VLAN"], ["cat", "Category"]].map(([k, l]) => `<button data-group="${k}" class="${S.group === k ? "on" : ""}">${l}</button>`).join("")}</div>
    <span>· Click an app to open it · ${svg("help").replace("<svg", '<svg style="width:13px;height:13px;vertical-align:-2px"')} for details</span></div>
  <div class="rooms">${body || '<div class="glass empty">Nothing matches.</div>'}${unkRoom}</div>`;
}

// ------------------------------------------------------------------ services (one list)
const stCell = (r) => { const c = rowClass(r); return `<span class="st ${c === "run" ? "run" : c === "stop" ? "stop" : c === "bad" ? "bad" : "unk"}">${c === "run" ? "Running" : c === "stop" ? "Stopped" : c === "bad" ? (r.state === "restarting" ? "Restarting" : "Problem") : "Unconfirmed"}</span>`; };
function vServices() {
  const rows = [...S.model.rows, ...S.model.unk].filter(rowMatch).sort((a, b) => a.name.localeCompare(b.name));
  return `<div class="page-head"><div><h1>All services</h1><p>${rows.length} services and containers · every IP, VLAN and host in one list</p></div>
    <div class="row"><a class="btn sm" href="/api/export/inventory.csv">Export CSV</a><a class="btn sm" href="/api/export/inventory.json">Export JSON</a></div></div>
  <div class="toolbar">${searchBox("Filter by name, IP, VLAN, VM, image…")}${filterChips()}</div>
  <div class="glass tbl-wrap"><table class="tbl"><thead><tr><th>Service</th><th>State</th><th>Open</th><th class="hide-m">IP : port</th><th class="hide-m">VLAN</th><th class="hide-m">Runs on</th><th class="hide-m">Web check</th></tr></thead><tbody>
  ${rows.map((r) => `<tr class="click" ${r.app ? `data-details="${esc(r.app.id)}"` : ""}><td><div class="nm">${icon({ name: r.name, icon: r.icon }, "sm")}<div>${esc(r.name)}<div class="s mono">${esc(r.cname && r.cname !== r.name ? r.cname : "")}${r.image && r.cname ? " · " : ""}${esc(r.image || r.why || "")}</div></div></div></td>
    <td>${stCell(r)}</td><td class="mono small">${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener" data-open="${esc(r.key)}" style="color:#c7d2fe">${esc(short(r.url))}</a>` : '<span class="muted">—</span>'}</td>
    <td class="hide-m mono small">${esc(r.addr)}</td><td class="hide-m">${esc(r.vlan || "—")}</td>
    <td class="hide-m small">${r.host ? `${esc(r.host.kind === "VM" || r.host.kind === "LXC" ? r.host.kind + " " + r.host.id + " · " : "")}${esc(r.host.name)}<div class="muted tiny">${esc(r.host.node)}${r.compose ? " · stack " + esc(r.compose) : ""}</div>` : '<span class="muted">not in Proxmox</span>'}</td>
    <td class="hide-m">${r.url ? pill(r.health || "unverified") : '<span class="muted small">no web page</span>'}</td></tr>`).join("")}
  </tbody></table></div>`;
}

// ------------------------------------------------------------------ network
function ipIn(ip, cidr) {
  const [net, bits] = cidr.split("/"), toN = (s) => s.split(".").reduce((a, o) => (a << 8) + +o, 0) >>> 0;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip || "")) return false;
  const mask = bits === "0" ? 0 : (~0 << (32 - +bits)) >>> 0;
  return (toN(ip) & mask) === (toN(net) & mask);
}
function vNetwork() {
  const inv = S.inv, q = S.q.toLowerCase();
  const appFor = (name) => inv.apps.find((a) => a.endpoints.some((e) => e.host === name));
  const doms = inv.domains.filter((d) => d.kind !== "dhcp-hostname" && (!q || d.name.includes(q) || (d.addresses || []).join(" ").includes(q))).sort((a, b) => a.name.localeCompare(b.name));
  const nets = inv.networks.map((n) => {
    const devs = inv.devices.filter((d) => d.vlan == n.vlan || (d.ip && n.subnet && ipIn(d.ip, n.subnet)));
    const guests = inv.workloads.filter((w) => (w.ips || []).some((ip) => n.subnet && ipIn(ip, n.subnet)));
    return `<tr><td><b>${esc(n.vlan ?? "—")}</b></td><td>${esc(n.name || "")}</td><td class="mono">${esc(n.subnet)}</td><td>${guests.map((g) => esc(g.name)).join(", ") || '<span class="muted">—</span>'}</td><td>${devs.length} <span class="muted small">(${devs.filter((d) => d.online).length} online)</span></td></tr>`;
  }).join("");
  return `<div class="page-head"><div><h1>Network</h1><p>Which name goes where: domain → DNS → proxy → app. Plus your VLANs.</p></div></div>
  <div class="toolbar">${searchBox("Find a domain or IP…")}</div>
  <section class="glass sec"><div class="sec-h"><h2>Domains</h2><span class="muted small">${doms.length}</span></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Domain</th><th>Points to</th><th class="hide-m">Via</th><th class="hide-m">Reaches</th><th>Check</th></tr></thead><tbody>
  ${doms.map((d) => { const a = appFor(d.name), ep = a && a.endpoints.find((e) => e.host === d.name);
    const iss = inv.issues.filter((i) => (i.evidence || []).some((e) => String(e).startsWith(d.name + " ")) || i.ref === "dns:" + d.name);
    return `<tr class="${a ? "click" : ""}" ${a ? `data-details="${esc(a.id)}"` : ""}><td class="mono">${esc(d.name)}</td><td class="mono small">${esc((d.addresses || []).join(", ") || "no record")}</td>
      <td class="hide-m small">${esc(ep?.proxy || (d.note ? "Caddy" : "direct"))}${ep?.upstream ? `<div class="muted tiny mono">→ ${esc(ep.upstream)}</div>` : ""}</td><td class="hide-m">${a ? esc(a.name) : '<span class="muted">nothing found</span>'}</td>
      <td>${ep?.health ? pill(ep.health) : d.ok ? pill("unverified") : pill("dns-fail")}${iss.length ? ` <span class="pill ${iss[0].severity}" title="${esc(iss[0].title)}">${svg("warn")}issue</span>` : ""}</td></tr>`; }).join("")}
  </tbody></table></div></section>
  <section class="glass sec"><div class="sec-h"><h2>VLANs</h2></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>VLAN</th><th>Name</th><th>Subnet</th><th>VMs / LXCs</th><th>Devices</th></tr></thead><tbody>${nets}</tbody></table></div></section>`;
}

// ------------------------------------------------------------------ issues & digest
function issueRow(i) {
  const ev = (i.evidence || []).filter(Boolean);
  const target = i.ref && S.appMap.get(i.ref) ? i.ref : (S.inv.apps.find((a) => a.endpoints.some((e) => e.id === i.ref)) || {}).id;
  return `<div class="issue">${pill(i.severity)}<div class="t">${esc(i.title)}${target ? ` <a href="#" data-details="${esc(target)}" class="small" style="color:#a5b4fc">details</a>` : ""}</div>
    <div class="ev">${ev.length ? `<ul>${ev.slice(0, 8).map((e) => `<li>${esc(e)}</li>`).join("")}${ev.length > 8 ? `<li class="muted">+${ev.length - 8} more</li>` : ""}</ul>` : ""}
    ${i.suggestion ? `<div><b>Fix:</b> ${esc(i.suggestion)}</div>` : ""}${i.hypothesis ? `<div class="hyp">Likely cause (not confirmed): ${esc(i.hypothesis)}</div>` : ""}</div></div>`;
}
async function vIssues() {
  const sev = { high: 0, medium: 1, low: 2, info: 3 };
  const issues = [...S.inv.issues].sort((a, b) => sev[a.severity] - sev[b.severity]);
  let d = null; try { d = await api("/api/digest"); } catch { /* none yet */ }
  const ch = (d?.changes || []).slice(0, 30);
  return `<div class="page-head"><div><h1>Issues</h1><p>${issues.length} findings from live checks, Proxmox and DNS — most important first.</p></div>
    ${S.me.admin ? `<button class="btn primary" id="genDigest">${svg("refresh")}New digest</button>` : ""}</div>
  <div class="cols"><section class="glass sec"><div class="sec-h"><h2>To fix</h2></div><div class="list">${issues.map(issueRow).join("") || '<div class="empty">Nothing to fix. 🎉</div>'}</div></section>
  <div><section class="glass sec"><div class="sec-h"><h2>What changed</h2><span class="muted small">${d ? esc(fmtTime(d.generated_at)) : "no digest yet"}</span></div>
    ${d?.baseline_note ? `<div style="padding:0 18px 12px"><div class="note">${esc(d.baseline_note)}</div></div>` : ""}
    <div class="list">${ch.map((c) => `<div class="issue">${pill(c.severity)}<div class="t">${esc(c.title)}</div></div>`).join("") || '<div class="empty small">No changes recorded.</div>'}</div></section>
    ${d ? `<section class="glass sec"><div class="sec-h"><h2>Up and down</h2></div><div class="list">${[...(d.health_down || []), ...(d.health_recovered || [])].map((e) => `<div class="issue">${pill(e.type === "health-recovered" ? "up" : "down")}<div class="t">${esc(e.title)}<div class="muted tiny">${esc(fmtTime(e.at))}</div></div></div>`).join("") || '<div class="empty small">No ups or downs in the last 24 h.</div>'}</div></section>` : ""}
  </div></div>`;
}

// ------------------------------------------------------------------ details drawer
function openDetails(id) { S.sel = id; renderDrawer(); }
function closeDetails() { S.sel = null; S.lastDiag = null; const d = $("#drawer"); if (d) d.remove(); }
function epBlock(a, e) {
  const t = e.tls || {}, h = e.http || {};
  const isPref = e.id === a.preferred_domain || e.id === a.preferred_ip;
  return `<div class="ep"><div class="row"><span class="u">${esc(e.url)}</span>${isPref ? '<span class="pill info">Preferred</span>' : ""}</div>
    <div class="m">${pill(e.health || "unverified")}${pill(e.status, "How this address is known")}<span class="pill">${e.kind === "domain" ? "Domain" : "IP address"}</span>
      ${e.proxy ? `<span class="pill">via ${esc(e.proxy)}</span>` : ""}${t.days_left != null ? `<span class="pill ${t.days_left < 14 ? "medium" : ""}">TLS ${t.verified === false ? "not trusted" : "ok"} · ${t.days_left} d left</span>` : ""}</div>
    <div class="why">${esc(e.health_summary || "Not checked yet.")}${e.checked_at ? ` · ${esc(ago(e.checked_at))}` : ""}${e.last_ok_at ? ` · last OK ${esc(ago(e.last_ok_at))}` : ""}</div>
    ${e.hypothesis ? `<div class="hyp">Likely cause: ${esc(e.hypothesis)}</div>` : ""}${e.upstream ? `<div class="why">Upstream <span class="mono">${esc(e.upstream)}</span>${e.proxy_ip ? ` on ${esc(e.proxy_ip)}` : ""}</div>` : ""}
    ${h.location ? `<div class="why">Redirects to <span class="mono">${esc(h.location)}</span></div>` : ""}
    <div class="row" style="margin-top:10px"><a class="btn sm primary" href="${esc(e.url)}" target="_blank" rel="noopener noreferrer" data-open="${esc(a.id)}">${svg("ext")}Open</a>
      <button class="btn sm" data-copy="${esc(e.url)}">${svg("copy")}Copy</button><button class="btn sm" data-diag="${esc(e.id)}">${svg("pulse")}Test now</button>
      ${S.me.admin && !isPref ? `<button class="btn sm" data-pref="${esc(e.url)}">Make preferred</button>` : ""}</div></div>`;
}
function renderDrawer() {
  const old = $("#drawer"); if (old) old.remove();
  const a = S.appMap.get(S.sel); if (!a) return;
  const L = a.location || {}, w = S.wlById.get(L.workload_id), c = S.ctById.get(L.container_id), n = S.nodeById.get(L.node_id || (w && w.node_id)), d = S.devById.get(L.device_id);
  const chain = [n && `Proxmox ${esc(n.name)}`, w && `${w.kind.toUpperCase()} ${w.vmid} · ${esc(w.name)}`, !n && !w && d && esc(d.name || d.ip), c && `container ${esc(c.name)}`, L.compose_project && `stack ${esc(L.compose_project)}`].filter(Boolean);
  const rt = a.runtime || {};
  const el = document.createElement("div"); el.id = "drawer";
  el.innerHTML = `<div class="scrim" data-close></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(a.name)}">
    <div class="drawer-h">${icon(a)}<div style="flex:1;min-width:0"><h2>${esc(a.name)}</h2><div class="muted small">${esc(a.purpose || a.category || "")}${a.discovered_name && a.discovered_name !== a.name ? ` · found as “${esc(a.discovered_name)}”` : ""}</div></div>
      <button class="star ${a._fav ? "on" : ""}" data-fav="${esc(a.id)}" aria-label="Favorite">${svg("star")}</button><button class="iconbtn" data-close aria-label="Close">${svg("x")}</button></div>
    <div class="row">${pill(a.status)}<span class="pill">${esc(a.category || "Other")}</span>${a.hidden ? '<span class="pill">Hidden</span>' : ""}${!L.workload_id && !L.node_id && !a.manual && !a.confirmed && a.kind !== "addon" && a.id !== "app:ha:main" ? '<span class="pill medium">Unconfirmed</span>' : ""}</div>
    <section><h3>Where it runs</h3><div class="chain">${chain.map((x, i) => (i ? '<span class="sep">›</span>' : "") + `<span class="node">${x}</span>`).join("") || '<span class="muted">Unknown</span>'}</div>
      <dl class="kv" style="margin-top:12px"><dt>IP</dt><dd class="mono">${esc(L.host_ip || "—")}</dd><dt>VLAN</dt><dd>${esc(a.vlan ?? "—")}</dd>
      ${c ? `<dt>Image</dt><dd class="mono">${esc(c.image)}</dd><dt>Ports</dt><dd class="mono">${esc(c.ports.map((p) => `${p.host_port}→${p.container_port}`).join(", ") || "none published")}</dd>` : ""}
      ${rt.state ? `<dt>State</dt><dd>${esc(rt.state)}${rt.status ? " · " + esc(rt.status) : ""}</dd>` : ""}${rt.version ? `<dt>Version</dt><dd>${esc(rt.version)}${rt.update ? ` · <span style="color:var(--warn)">update ${esc(rt.update)}</span>` : ""}</dd>` : ""}</dl></section>
    <section><h3>Addresses</h3>${a.endpoints.length ? [...a.endpoints].sort((x, y) => (x.kind === "domain" ? 0 : 1) - (y.kind === "domain" ? 0 : 1)).map((e) => epBlock(a, e)).join("") : '<div class="muted">No web address known.</div>'}</section>
    ${(a.mgmt_links || []).length ? `<section><h3>Manage</h3><div class="row">${a.mgmt_links.map((m) => `<a class="btn sm" href="${esc(m.url)}" target="_blank" rel="noopener">${svg("ext")}${esc(m.label)}</a>`).join("")}</div></section>` : ""}
    ${(a.notes || []).length || a.notes_user ? `<section><h3>Notes</h3>${a.notes_user ? `<p style="white-space:pre-wrap">${esc(a.notes_user)}</p>` : ""}${(a.notes || []).map((x) => `<p class="small muted">${esc(x)}</p>`).join("")}</section>` : ""}
    <section id="diagOut"></section>
    <section><h3>Found by</h3><ul class="small muted" style="margin:0;padding-left:18px">${(a.sources || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ul></section>
    ${S.me.admin ? `<section><a class="btn" href="#/admin" data-edit="${esc(a.id)}">${svg("gear")}Edit in Admin</a></section>` : ""}
  </aside>`;
  document.body.appendChild(el);
  $$("[data-close]", el).forEach((b) => b.addEventListener("click", closeDetails));
  el.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDetails(); });
  $$("[data-copy]", el).forEach((b) => b.addEventListener("click", () => copy(b.dataset.copy)));
  $$("[data-diag]", el).forEach((b) => b.addEventListener("click", () => runDiag(b.dataset.diag, $("#diagOut", el))));
  $$("[data-pref]", el).forEach((b) => b.addEventListener("click", () => saveOverride(a.id, { preferred_url: b.dataset.pref })));
  $$("[data-edit]", el).forEach((b) => b.addEventListener("click", () => { S.adminTab = "services"; S.admQ = a.discovered_name || a.name; ls.set("adminTab", "services"); closeDetails(); }));
  wire(el);
  if (S.lastDiag?.app === a.id) $("#diagOut", el).innerHTML = S.lastDiag.html;
  if (!renderDrawer.quiet) $(".iconbtn[data-close]", el).focus();
}
async function saveOverride(id, patch, quiet) {
  try { await api("/api/admin/override/" + encodeURIComponent(id), { method: "PUT", body: patch }); if (!quiet) toast("Saved"); await refresh(); }
  catch (e) { toast("Not saved: " + e.message); }
}
async function runDiag(epId, out) {
  out.innerHTML = `<h3>Test</h3><div class="muted">Checking DNS → connection → certificate → web page…</div>`;
  let html;
  try {
    const r = await api("/api/diagnose", { method: "POST", body: { endpoint_id: epId } });
    const d = r.dns || {}, t = r.tcp || {}, s = r.tls, h = r.http;
    const row = (k, ok, body) => `<div class="step"><div class="k">${k} ${pill(ok === true ? "up" : ok === false ? "down" : "unverified")}</div><pre>${esc(body)}</pre></div>`;
    html = `<h3>Test · <span class="mono">${esc(short(r.endpoint?.url))}</span></h3><div class="steps"><div class="note">${pill(r.status)} <b>${esc(r.summary || "")}</b>${r.hypothesis ? `<div class="hyp">Likely cause: ${esc(r.hypothesis)}</div>` : ""}</div>
      ${row("DNS", d.ok, d.skipped ? "IP address — no lookup needed" : d.ok ? (d.addresses || []).join(", ") : d.error || "")}
      ${row("Connect", t.ok, t.ok ? `connected to ${r.ip} in ${t.ms} ms` : `${t.result || "not tried"}${t.result === "timeout" ? " — no answer (often a firewall)" : t.result === "refused" ? " — the host is up but nothing listens on this port" : ""}`)}
      ${s ? row("Certificate", s.ok && s.verified !== false, s.ok ? `${s.verified ? "trusted" : "NOT trusted: " + (s.verify_error || "")}\nexpires ${s.expires || "?"} (${s.days_left ?? "?"} days)` : s.error || "") : ""}
      ${h ? row("Web page", h.ok && h.code < 500, h.ok ? `HTTP ${h.code}${h.location ? " → " + h.location : ""}${h.title ? "\n" + h.title : ""}` : (h.result || "") + " " + (h.error || "")) : ""}</div>`;
  } catch (e) { html = `<h3>Test</h3><div class="note warn">${esc(e.message)}</div>`; }
  S.lastDiag = { app: S.sel, html };
  out.innerHTML = html;
}

// ------------------------------------------------------------------ admin console
const ATABS = [["connections", "Connections", "plug"], ["services", "Services", "grid"], ["hosts", "Hosts & devices", "server"], ["unconfirmed", "Unconfirmed", "alert"],
  ["look", "Appearance", "palette"], ["checks", "Checks & schedule", "clock"], ["account", "Account", "user"], ["backup", "Backup & import", "save"]];
const CONN = {
  proxmox: { title: "Proxmox VE", icon: "proxmox", ro: "read-only",
    gives: ["Every VM and LXC on all nodes — running or stopped", "IPs, VLANs, CPU, memory and disk, refreshed automatically", "Can't start, stop or change anything (PVEAuditor role)"],
    how: ["In the Proxmox web UI go to <b>Datacenter → Permissions → Users → Add</b>. User name <code>dashboard</code>, realm <code>Proxmox VE authentication server</code>. No password needed.",
      "<b>Datacenter → Permissions → Add → User Permission</b>: path <code>/</code>, user <code>dashboard@pve</code>, role <code>PVEAuditor</code>.",
      "<b>Datacenter → Permissions → API Tokens → Add</b>: user <code>dashboard@pve</code>, token ID <code>dash</code>, <b>untick Privilege Separation</b>.",
      "Copy the secret (shown only once) and paste it below as <code>dashboard@pve!dash=SECRET</code>. One token covers every node in the cluster."],
    fields: [["token", "API token", "password", "dashboard@pve!dash=xxxxxxxx-xxxx-…"], ["hosts", "Node addresses (optional)", "text", "10.10.10.10, 10.10.10.11"]] },
  portainer: { title: "Portainer", icon: "portainer", ro: "read-only, optional",
    gives: ["Every container in every Portainer, live: running, stopped, restarting", "Traefik routes from container labels — no scans needed", "Add one line per Portainer server"],
    how: ["Open Portainer → <b>Users → Add user</b> <code>dashboard</code>. Business Edition: give it the <b>Read-only user</b> role on each environment. Community Edition: a standard user with access to the environment.",
      "Log in as <code>dashboard</code> → click the user menu → <b>My account → Access tokens → Add access token</b>.",
      "Paste the Portainer address (e.g. <code>10.10.30.30:9443</code>) and the token below. Repeat for each Portainer."],
    fields: null },
  unifi: { title: "UniFi Network", icon: "ubiquiti-unifi", ro: "read-only, optional",
    gives: ["Real network and VLAN names, DHCP reservations", "Your local DNS records — the dashboard then shows exactly which to fix", "Devices seen in the last 30 days, even if offline now"],
    how: ["Open UniFi Network → <b>Settings → Control Plane → Integrations</b>.", "Click <b>Create API Key</b>, name it <code>dashboard</code>, copy the key.", "Paste it below. The gateway address is usually <code>10.10.1.1</code>."],
    fields: [["host", "Gateway address", "text", "10.10.1.1"], ["key", "API key", "password", "UniFi API key"], ["site", "Site (optional)", "text", "default"]] },
  homeassistant: { title: "Home Assistant", icon: "home-assistant", ro: "optional",
    gives: ["Add-ons and whether they run", "Every network client Home Assistant's UniFi integration sees"],
    how: ["In Home Assistant create a non-admin user <code>dashboard</code> (Settings → People → Users).", "Log in as that user → profile → <b>Security → Long-lived access tokens → Create token</b>.", "Paste the HA address and the token below."],
    fields: [["url", "Home Assistant address", "text", "https://ha.safrani.co"], ["token", "Access token", "password", "long-lived access token"]] },
};
async function vAdmin() {
  if (!S.me.password_set) return `<div class="glass login"><h1>Welcome</h1><p class="muted">Create the admin account. You'll use it to manage the dashboard — no command line needed.</p>
    <form id="setupForm" class="grid-form" style="grid-template-columns:1fr;margin-top:16px"><label class="f">Username<input class="inp" name="username" value="admin" autocomplete="username"></label>
    <label class="f">Password (10+ characters)<input class="inp" name="password" type="password" autocomplete="new-password" required minlength="10"></label>
    <label class="f">Repeat password<input class="inp" name="password2" type="password" autocomplete="new-password" required></label>
    <button class="btn primary">Create admin account</button><div id="formErr" class="small" style="color:var(--bad)"></div></form></div>`;
  if (!S.me.admin) return `<div class="glass login"><h1>Admin</h1><p class="muted">Sign in to manage connections, services and settings.</p>
    <form id="loginForm" class="grid-form" style="grid-template-columns:1fr;margin-top:16px"><label class="f">Username<input class="inp" name="username" value="admin" autocomplete="username" required></label>
    <label class="f">Password<input class="inp" name="password" type="password" autocomplete="current-password" required></label>
    <button class="btn primary">Sign in</button><div id="formErr" class="small" style="color:var(--bad)"></div></form></div>`;
  const t = S.adminTab;
  const body = await ({ connections: aConnections, services: aServices, hosts: aHosts, unconfirmed: aUnconfirmed, look: aLook, checks: aChecks, account: aAccount, backup: aBackup }[t] || aConnections)();
  return `<div class="adm"><nav class="glass anav" aria-label="Admin sections">${ATABS.map(([k, l, ic]) => `<button data-atab="${k}" class="${t === k ? "on" : ""}">${svg(ic)}${l}${k === "unconfirmed" && S.model.unk.length ? ` <span class="badge" style="margin-left:auto;background:var(--warn)">${S.model.unk.length}</span>` : ""}</button>`).join("")}
    <div class="who">Signed in as <b>${esc(S.me.user || "admin")}</b></div></nav><div>${body}</div></div>`;
}
const ah = (title, text, extra = "") => `<div class="ah"><div><h2>${title}</h2><p>${text}</p></div>${extra}</div>`;

async function aConnections() {
  const r = await api("/api/admin/connections");
  const mode = r.mode;
  const card = (k) => {
    const c = CONN[k], v = r.connections[k] || {}, last = v.last || {};
    const st = !v.configured ? '<span class="status-off">Not connected</span>' : last.status === "ok" ? `<span class="status-ok">Connected${last.detail ? " · " + esc(last.detail) : ""}</span>` : last.status ? `<span class="status-err">${esc(last.error || last.status)}</span>` : '<span class="status-off">Saved — not tested yet</span>';
    let form;
    if (k === "portainer") {
      const servers = (v.servers || []).concat([{ host: "", hint: "" }]);
      form = `<div id="ptrows">${servers.map((s, i) => `<div class="cform" data-prow><label class="f">Portainer address<input class="inp" name="host" value="${esc(s.host)}" placeholder="10.10.30.30:9443"></label>
        <label class="f">Access token<input class="inp" name="token" type="password" placeholder="${s.hint ? "saved (" + esc(s.hint) + ") — leave empty to keep" : "ptr_…"}" autocomplete="off"></label>
        <div class="acts">${s.host ? `<button class="btn sm danger" data-prm="${i}" type="button">${svg("trash")}Remove</button>` : ""}</div></div>`).join("")}</div>`;
    } else {
      form = `<div class="cform">${c.fields.map(([f, label, type, ph]) => `<label class="f">${label}<input class="inp" name="${f}" type="${type}" autocomplete="off" value="${type === "password" ? "" : esc(v[f] || "")}" placeholder="${type === "password" && v[f] ? "saved (" + esc(v[f]) + ") — leave empty to keep" : esc(ph)}"></label>`).join("")}</div>`;
    }
    return `<form class="glass conn" data-conn="${k}">${icon({ name: c.title, icon: c.icon })}<div><h3>${c.title} <span class="muted small" style="font-weight:600">${c.ro}</span> <span style="margin-left:auto">${st}</span></h3>
      <ul class="gives">${c.gives.map((g) => `<li>${g}</li>`).join("")}</ul>
      <details class="how"><summary>How do I get this?</summary><ol>${c.how.map((h) => `<li>${h}</li>`).join("")}</ol></details>
      ${form}<div class="row" style="margin-top:12px"><button class="btn primary" type="submit">${svg("check")}Save &amp; test</button><button class="btn" type="button" data-test="${k}">Test</button>
      ${v.configured ? `<button class="btn danger" type="button" data-cdel="${k}">${svg("trash")}Disconnect</button>` : ""}</div><div class="result" data-result="${k}"></div></div></form>`;
  };
  return ah("Connections", "Connect your systems once — the dashboard keeps itself up to date. Every connection is read-only and optional. Tokens are stored on the dashboard server, never shown again, and never included in exports.") +
    `<div class="mode-card"><button class="mode-opt ${mode === "live" ? "on" : ""}" data-mode-set="live"><b>${svg("refresh").replace("<svg", '<svg style="width:16px;height:16px;vertical-align:-3px"')} Live</b><span>Use the connections below. Discovery every ${esc(S.inv.settings_public?.discovery_interval_min)} min, web checks every ${esc(S.inv.settings_public?.check_interval_min)} min.</span></button>
      <button class="mode-opt ${mode === "offline" ? "on" : ""}" data-mode-set="offline"><b>${svg("save").replace("<svg", '<svg style="width:16px;height:16px;vertical-align:-3px"')} Offline</b><span>No API calls. Use the last scan you uploaded (Backup &amp; import), and show its date.</span></button></div>` +
    ["proxmox", "portainer", "unifi", "homeassistant"].map(card).join("");
}
async function aServices() {
  const apps = S.inv.apps.filter((a) => !S.admQ || (a.name + " " + a.id + " " + (a.discovered_name || "") + " " + (a.location?.host_label || "")).toLowerCase().includes(S.admQ.toLowerCase()));
  const cats = S.inv.settings_public?.categories_order || [];
  return ah("Services", "Rename, re-icon, recategorise, reorder, hide or turn off any entry. Your changes are kept separate from what discovery finds, so they survive every refresh. Hiding never touches the real service.",
    `<input class="inp" id="admq" placeholder="Filter…" value="${esc(S.admQ || "")}" style="width:240px">`) +
  `<div class="glass tbl-wrap"><table class="tbl"><thead><tr><th>Service</th><th>Name</th><th>Category</th><th class="hide-m">Icon</th><th class="hide-m">Order</th><th class="hide-m">Open with</th><th>Visible</th><th>Off on purpose</th><th></th></tr></thead><tbody>
  ${apps.map((a) => { const o = a.override || {};
    return `<tr class="adm-row" data-id="${esc(a.id)}"><td style="min-width:180px"><div class="nm">${icon(a, "sm")}<div><a href="#" data-details="${esc(a.id)}">${esc(a.discovered_name || a.name)}</a><div class="s">${esc(a.location?.host_label || (a.manual ? "added by you" : ""))}</div></div></div></td>
      <td><input class="inp" data-k="name" value="${esc(o.name || "")}" placeholder="${esc(a.discovered_name || "")}"></td>
      <td><input class="inp" data-k="category" value="${esc(o.category || "")}" placeholder="${esc(a.category || "")}" list="catl"></td>
      <td class="hide-m"><input class="inp" data-k="icon" value="${esc(o.icon || "")}" placeholder="${esc(a.icon || "slug, URL or emoji")}" style="min-width:120px"></td>
      <td class="hide-m"><input class="inp" data-k="order" type="number" value="${esc(o.order ?? "")}" style="width:70px;min-width:70px"></td>
      <td class="hide-m"><select class="sel" data-k="preferred_url" style="min-width:160px"><option value="">Automatic</option>${a.endpoints.map((e) => `<option value="${esc(e.url)}" ${o.preferred_url === e.url ? "selected" : ""}>${esc(short(e.url))}</option>`).join("")}</select></td>
      <td><label class="switch"><input type="checkbox" data-k="visible" ${a.hidden ? "" : "checked"}></label></td>
      <td><label class="switch" title="Stops health checks and shows it as off"><input type="checkbox" data-k="disabled" ${o.disabled ? "checked" : ""}></label></td>
      <td style="white-space:nowrap">${Object.keys(o).length ? `<button class="btn sm" data-reset="${esc(a.id)}" title="Undo all your changes">Reset</button>` : ""}${a.manual ? ` <button class="btn sm danger" data-delmanual="${esc(a.id)}">${svg("trash")}</button>` : ""}</td></tr>`; }).join("")}
  </tbody></table><datalist id="catl">${cats.map((c) => `<option>${esc(c)}</option>`).join("")}</datalist></div>
  <form class="glass pad" id="addApp" style="margin-top:18px"><h3 style="margin-bottom:12px">Add a service by hand</h3><div class="grid-form">
    <label class="f">Name<input class="inp" name="name" required></label><label class="f">Category<input class="inp" name="category" list="catl"></label>
    <label class="f">Icon<input class="inp" name="icon" placeholder="e.g. grafana — see dashboardicons.com"></label><label class="f">Runs on<input class="inp" name="location" placeholder="VM / device name"></label>
    <label class="f">IP<input class="inp" name="ip"></label><label class="f">What it does<input class="inp" name="purpose"></label>
    <label class="f" style="grid-column:1/-1">Web addresses (one per line)<textarea class="inp" name="urls" placeholder="https://app.safrani.co/&#10;http://10.10.30.30:3000/"></textarea></label></div>
    <div class="row" style="margin-top:12px"><button class="btn primary">${svg("plus")}Add service</button></div></form>`;
}
async function aHosts() {
  const wl = [...S.inv.workloads].sort((a, b) => a.vmid - b.vmid);
  const devs = S.inv.devices.filter((d) => !d.workload_id && !d.node_id).sort((a, b) => (a.name || "zz").localeCompare(b.name || "zz"));
  return ah("Hosts & devices", "Rename VMs, LXCs and devices for the dashboard, mark guests that are off on purpose (they stop showing as problems), and hide devices you don't care about.") +
  `<section class="glass sec"><div class="sec-h"><h2>VMs and LXCs</h2></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Guest</th><th>Node</th><th>State</th><th>Show as</th><th>Off on purpose</th></tr></thead><tbody>
  ${wl.map((w) => `<tr class="adm-row" data-id="${esc(w.id)}"><td><b>${w.kind.toUpperCase()} ${esc(w.vmid)}</b> ${esc(w.name)}<div class="muted tiny mono">${esc((w.ips || []).join(", "))}</div></td><td>${esc(w.node)}</td>
    <td>${w.status === "running" ? '<span class="st run">Running</span>' : '<span class="st stop">Stopped</span>'}</td>
    <td><input class="inp" data-k="name" value="${esc(w.override?.name || "")}" placeholder="${esc(w.name)}"></td><td><label class="switch"><input type="checkbox" data-k="disabled" ${w.override?.disabled ? "checked" : ""}></label></td></tr>`).join("")}
  </tbody></table></div></section>
  <section class="glass sec"><div class="sec-h"><h2>Devices outside Proxmox</h2><span class="muted small">${devs.length} from UniFi</span></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Device</th><th>IP</th><th>VLAN</th><th>Show as</th><th>Visible</th></tr></thead><tbody>
  ${devs.map((d) => `<tr class="adm-row" data-id="${esc(d.id)}"><td>${esc(d.name || d.hostname || "(no name)")}<div class="muted tiny">${esc(d.vendor || "")} · ${d.online ? "online" : "offline"}</div></td><td class="mono small">${esc(d.ip || "—")}</td><td>${esc(d.vlan ?? "—")}</td>
    <td><input class="inp" data-k="name" value="${esc(d.override?.name || "")}" placeholder="${esc(d.name || d.hostname || "")}"></td><td><label class="switch"><input type="checkbox" data-k="visible" ${d.hidden ? "" : "checked"}></label></td></tr>`).join("")}
  </tbody></table></div></section>
  <form class="glass pad" id="addDev"><h3 style="margin-bottom:12px">Add a device by hand</h3><div class="grid-form"><label class="f">Name<input class="inp" name="name" required></label><label class="f">IP<input class="inp" name="ip"></label>
    <label class="f">MAC<input class="inp" name="mac"></label><label class="f">VLAN<input class="inp" name="vlan"></label><label class="f">Type<input class="inp" name="role" placeholder="Raspberry Pi, NAS, printer…"></label></div>
    <div class="row" style="margin-top:12px"><button class="btn primary">${svg("plus")}Add device</button></div></form>`;
}
async function aUnconfirmed() {
  const unk = S.model.unk, conf = S.inv.apps.filter((a) => a.confirmed);
  const row = (r, confirmed) => `<tr><td><div class="nm">${icon({ name: r.name, icon: r.icon || r.app?.icon }, "sm")}${esc(r.name)}</div></td><td class="small">${esc(r.why || "confirmed by you")}</td>
    <td class="mono small">${r.url ? esc(short(r.url)) : esc(r.addr || "—")}</td><td>${r.url ? pill(r.health || "unverified") : ""}</td>
    <td style="white-space:nowrap">${confirmed ? `<button class="btn sm" data-unconfirm="${esc(r.app.id)}">Undo</button>` : `<button class="btn sm primary" data-confirm="${esc(r.app.id)}">${svg("check")}It's real</button> <button class="btn sm" data-hide="${esc(r.app.id)}">Hide</button>`}</td></tr>`;
  return ah("Unconfirmed", "These were guessed from UniFi device names, DNS records or proxy configs — not found in Proxmox. Mark the real ones as confirmed (they move into the main view) and hide the rest.") +
    `<section class="glass sec"><div class="sec-h"><h2>Waiting for you</h2><span class="muted small">${unk.length}</span></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Why it's here</th><th>Address</th><th>Check</th><th></th></tr></thead><tbody>
    ${unk.map((r) => row(r, false)).join("") || '<tr><td colspan="5" class="empty">All done.</td></tr>'}</tbody></table></div></section>
    ${conf.length ? `<section class="glass sec"><div class="sec-h"><h2>Confirmed by you</h2></div><div class="tbl-wrap"><table class="tbl"><tbody>${conf.map((a) => row({ name: a.name, app: a, url: preferred(a)?.url, health: preferred(a)?.health }, true)).join("")}</tbody></table></div></section>` : ""}`;
}
async function aLook() {
  const s = await api("/api/admin/settings");
  return ah("Appearance", "How the dashboard looks and greets you.") + `<form class="glass pad" id="setForm"><div class="grid-form">
    <label class="f">Dashboard title<input class="inp" name="dashboard_title" value="${esc(s.dashboard_title)}"></label>
    <label class="f">Your name (for the greeting)<input class="inp" name="owner_name" value="${esc(s.owner_name)}"></label>
    <label class="f">Open apps by default with<select class="sel" name="default_access_mode"><option value="domain" ${s.default_access_mode === "domain" ? "selected" : ""}>Domain name</option><option value="ip" ${s.default_access_mode === "ip" ? "selected" : ""}>IP address</option></select></label>
    <label class="f" style="grid-column:1/-1">Category order (comma separated)<input class="inp" name="categories_order" value="${esc(s.categories_order.join(", "))}"></label></div>
    <div class="row" style="margin-top:14px"><button class="btn primary">${svg("check")}Save</button></div></form>`;
}
async function aChecks() {
  const s = await api("/api/admin/settings"), e = S.inv.engine || {};
  return ah("Checks & schedule", "How often the dashboard looks for changes and tests every web address.") + `<form class="glass pad" id="setForm"><div class="grid-form">
    <label class="f">Refresh from Proxmox &amp; APIs every (min)<input class="inp" type="number" min="5" max="1440" name="discovery_interval_min" value="${esc(s.discovery_interval_min)}"></label>
    <label class="f">Test web addresses every (min, ≥ 2)<input class="inp" type="number" min="2" max="1440" name="check_interval_min" value="${esc(s.check_interval_min)}"></label>
    <label class="f">Daily digest at (hour, 0–23)<input class="inp" type="number" min="0" max="23" name="digest_hour_local" value="${esc(s.digest_hour_local)}"></label>
    <label class="f">Warn when a certificate expires within (days)<input class="inp" type="number" min="1" max="90" name="cert_warn_days" value="${esc(s.cert_warn_days)}"></label>
    <label class="f">Keep check history (days)<input class="inp" type="number" min="1" max="365" name="check_history_days" value="${esc(s.check_history_days)}"></label></div>
    <div class="row" style="margin-top:12px"><label class="switch"><input type="checkbox" name="digest_enabled" ${s.digest_enabled ? "checked" : ""}>Daily digest</label>
      <label class="switch"><input type="checkbox" name="require_login_for_view" ${s.require_login_for_view ? "checked" : ""}>Require sign-in to view the dashboard</label></div>
    <div class="row" style="margin-top:14px"><button class="btn primary">${svg("check")}Save</button></div></form>
    <div class="glass pad" style="margin-top:16px"><h3 style="margin-bottom:6px">Run now</h3><p class="muted small" style="margin-top:0">Last refresh ${esc(ago(e.discovery?.last || S.inv.generated_at))}${e.discovery?.error ? ` · <span style="color:var(--bad)">${esc(e.discovery.error)}</span>` : ""} · last web test ${esc(ago(e.checks?.last))}</p>
      <div class="row"><button class="btn" id="runDisc">${svg("refresh")}Refresh now</button><button class="btn" id="runCheck">${svg("pulse")}Test all addresses</button></div></div>`;
}
async function aAccount() {
  return ah("Account", "Change the admin password. Changing it signs out every other device.") + `<form class="glass pad" id="pwForm" style="max-width:520px"><div class="grid-form" style="grid-template-columns:1fr">
    <label class="f">Current password<input class="inp" type="password" name="current" autocomplete="current-password" required></label>
    <label class="f">New password (10+ characters)<input class="inp" type="password" name="new" autocomplete="new-password" required minlength="10"></label>
    <label class="f">Repeat new password<input class="inp" type="password" name="new2" autocomplete="new-password" required></label></div>
    <div class="row" style="margin-top:14px"><button class="btn primary">Change password</button><button class="btn" type="button" id="logout">${svg("logout")}Sign out</button></div><div id="formErr" class="small" style="color:var(--bad);margin-top:8px"></div></form>`;
}
async function aBackup() {
  const runs = S.inv.collected_runs || [];
  return ah("Backup & import", "Save or restore your dashboard setup, and upload scans for Offline mode or for VMs the APIs can't see into.") +
  `<div class="cols"><div class="glass pad"><h3>Download</h3><p class="muted small">Your edits, manual entries and settings. Never includes tokens or passwords.</p>
      <div class="row"><a class="btn" href="/api/admin/export">${svg("save")}Dashboard setup (.json)</a></div><div class="row" style="margin-top:8px"><a class="btn sm" href="/api/export/inventory.json">Inventory JSON</a><a class="btn sm" href="/api/export/inventory.csv">Inventory CSV</a></div></div>
    <div class="glass pad"><h3>Restore setup</h3><p class="muted small">Upload a file downloaded above.</p><input type="file" id="impFile" accept="application/json,.json">
      <div class="row" style="margin-top:10px"><label class="switch"><input type="radio" name="impMode" value="merge" checked>Merge</label><label class="switch"><input type="radio" name="impMode" value="replace">Replace my edits</label><button class="btn primary" id="impBtn">Restore</button></div></div></div>
  <div class="glass pad" style="margin-top:16px"><h3>Upload a scan</h3><p class="muted small">Run <span class="mono">collect-proxmox.sh</span> on each Proxmox node as root and upload the <span class="mono">.tar.gz</span> files. It sees inside VMs and LXCs (containers, Traefik and Caddy routes) where the APIs can't.</p>
    <input type="file" id="tgzFile" accept=".gz,application/gzip" multiple> <button class="btn primary" id="tgzBtn">Upload</button><a class="btn sm" href="/collect-proxmox.sh" download style="margin-left:6px">Download collect-proxmox.sh</a><div id="tgzOut" class="small" style="margin-top:8px"></div>
    ${runs.length ? `<p class="muted small" style="margin-top:12px">Scans in use: ${runs.map((r) => `${esc(r.collector)}@${esc(r.hostname)} (${esc(r.at)})`).join(", ")}</p>` : ""}</div>`;
}

function wireAdmin(root) {
  const fe = (msg) => { const e = $("#formErr", root); if (e) e.textContent = msg; else toast(msg); };
  const sf = $("#setupForm", root); if (sf) sf.addEventListener("submit", async (e) => {
    e.preventDefault(); const fd = new FormData(sf);
    if (fd.get("password") !== fd.get("password2")) return fe("Passwords differ");
    try { await api("/api/setup", { method: "POST", body: { username: fd.get("username"), password: fd.get("password") } }); toast("Admin account created"); S.adminTab = "connections"; await refresh(); } catch (er) { fe(er.message); }
  });
  const lf = $("#loginForm", root); if (lf) lf.addEventListener("submit", async (e) => {
    e.preventDefault(); const fd = new FormData(lf);
    try { await api("/api/login", { method: "POST", body: { username: fd.get("username"), password: fd.get("password") } }); await refresh(); toast("Signed in"); } catch (er) { fe(er.message); }
  });
  $$("[data-atab]", root).forEach((b) => b.addEventListener("click", () => { S.adminTab = b.dataset.atab; ls.set("adminTab", S.adminTab); render(); }));
  // connections
  $$("[data-mode-set]", root).forEach((b) => b.addEventListener("click", async () => { await api("/api/admin/settings", { method: "PUT", body: { mode: b.dataset.modeSet } }); toast(b.dataset.modeSet === "live" ? "Live mode" : "Offline mode"); await api("/api/admin/discover", { method: "POST", body: {} }); render(); pollEngine("discovery"); }));
  const collect = (form, k) => {
    if (k === "portainer") return { servers: $$("[data-prow]", form).map((r) => ({ host: $('[name="host"]', r).value.trim(), token: $('[name="token"]', r).value.trim() })).filter((s) => s.host) };
    const o = {}; $$("input", form).forEach((i) => { o[i.name] = i.value.trim(); }); return o;
  };
  const showRes = (k, res) => { const el = $(`[data-result="${k}"]`, root); if (el) el.innerHTML = res.status === "ok" ? `<span class="status-ok">✓ ${esc(res.detail || "Connected")}</span>` : `<span class="status-err">${esc(res.error || res.detail || res.status)}</span>`; };
  $$("form[data-conn]", root).forEach((f) => f.addEventListener("submit", async (e) => {
    e.preventDefault(); const k = f.dataset.conn; showRes(k, { status: "…", detail: "Saving and testing…" });
    try { const r = await api("/api/admin/connections/" + k, { method: "PUT", body: collect(f, k) }); showRes(k, r.test); toast("Saved"); pollEngine("discovery", true); } catch (er) { showRes(k, { status: "error", error: er.message }); }
  }));
  $$("[data-test]", root).forEach((b) => b.addEventListener("click", async () => { const k = b.dataset.test; showRes(k, { status: "…", detail: "Testing…" }); try { showRes(k, await api(`/api/admin/connections/${k}/test`, { method: "POST", body: {} })); } catch (er) { showRes(k, { status: "error", error: er.message }); } }));
  $$("[data-cdel]", root).forEach((b) => b.addEventListener("click", async () => { if (!confirm("Disconnect and delete the saved token?")) return; await api("/api/admin/connections/" + b.dataset.cdel, { method: "DELETE" }); toast("Disconnected"); render(); }));
  $$("[data-prm]", root).forEach((b) => b.addEventListener("click", async () => { const f = b.closest("form"); b.closest("[data-prow]").remove(); try { await api("/api/admin/connections/portainer", { method: "PUT", body: collect(f, "portainer") }); toast("Removed"); render(); } catch (er) { toast(er.message); } }));
  // services / hosts rows
  const aq = $("#admq", root); if (aq) aq.addEventListener("input", () => { S.admQ = aq.value; const p = aq.selectionStart; render().then(() => { const n = $("#admq"); if (n) { n.focus(); n.setSelectionRange(p, p); } }); });
  $$(".adm-row", root).forEach((row) => {
    const id = row.dataset.id, a = S.appMap.get(id);
    $$("[data-k]", row).forEach((inp) => inp.addEventListener("change", async () => {
      const k = inp.dataset.k, v = inp.type === "checkbox" ? inp.checked : inp.value.trim();
      const patch = k === "visible" ? { hidden: v ? (a?.default_hidden ? false : null) : true } : k === "disabled" ? { disabled: v || null } : k === "order" ? { order: v === "" ? null : +v } : { [k]: v || null };
      await saveOverride(id, patch);
    }));
  });
  $$("[data-reset]", root).forEach((b) => b.addEventListener("click", async () => { if (!confirm("Undo all your changes to this entry?")) return; await api("/api/admin/override/" + encodeURIComponent(b.dataset.reset), { method: "DELETE" }); toast("Reset"); await refresh(); }));
  $$("[data-delmanual]", root).forEach((b) => b.addEventListener("click", async () => { if (!confirm("Delete this entry from the dashboard? Nothing on your servers changes.")) return; await api("/api/admin/manual/" + encodeURIComponent(b.dataset.delmanual), { method: "DELETE" }); toast("Deleted"); await refresh(); }));
  $$("[data-confirm]", root).forEach((b) => b.addEventListener("click", () => saveOverride(b.dataset.confirm, { confirmed: true })));
  $$("[data-unconfirm]", root).forEach((b) => b.addEventListener("click", () => saveOverride(b.dataset.unconfirm, { confirmed: null })));
  $$("[data-hide]", root).forEach((b) => b.addEventListener("click", () => saveOverride(b.dataset.hide, { hidden: true })));
  const addApp = $("#addApp", root); if (addApp) addApp.addEventListener("submit", async (e) => {
    e.preventDefault(); const fd = Object.fromEntries(new FormData(addApp)); fd.urls = (fd.urls || "").split("\n").map((x) => x.trim()).filter(Boolean);
    for (const k of Object.keys(fd)) if (fd[k] === "" || (Array.isArray(fd[k]) && !fd[k].length)) delete fd[k];
    try { await api("/api/admin/manual", { method: "POST", body: { kind: "app", ...fd } }); toast("Added"); await refresh(); } catch (er) { toast(er.message); }
  });
  const addDev = $("#addDev", root); if (addDev) addDev.addEventListener("submit", async (e) => {
    e.preventDefault(); const fd = Object.fromEntries(new FormData(addDev)); for (const k of Object.keys(fd)) if (fd[k] === "") delete fd[k];
    try { await api("/api/admin/manual", { method: "POST", body: { kind: "device", ...fd } }); toast("Added"); await refresh(); } catch (er) { toast(er.message); }
  });
  const setf = $("#setForm", root); if (setf) setf.addEventListener("submit", async (e) => {
    e.preventDefault(); const p = {};
    for (const el of setf.elements) {
      if (!el.name) continue;
      if (el.type === "checkbox") p[el.name] = el.checked;
      else if (el.type === "number") p[el.name] = +el.value;
      else if (el.name === "categories_order") p[el.name] = el.value.split(",").map((x) => x.trim()).filter(Boolean);
      else p[el.name] = el.value;
    }
    try { await api("/api/admin/settings", { method: "PUT", body: p }); toast("Saved"); await refresh(); } catch (er) { toast(er.message); }
  });
  const rd = $("#runDisc", root); if (rd) rd.addEventListener("click", async () => { await api("/api/admin/discover", { method: "POST", body: {} }); toast("Refreshing…"); pollEngine("discovery"); });
  const rc = $("#runCheck", root); if (rc) rc.addEventListener("click", async () => { await api("/api/admin/check", { method: "POST", body: {} }); toast("Testing every address…"); pollEngine("checks"); });
  const pw = $("#pwForm", root); if (pw) pw.addEventListener("submit", async (e) => {
    e.preventDefault(); const fd = new FormData(pw);
    if (fd.get("new") !== fd.get("new2")) return fe("New passwords differ");
    try { await api("/api/admin/password", { method: "PUT", body: { current: fd.get("current"), new: fd.get("new") } }); toast("Password changed"); pw.reset(); } catch (er) { fe(er.message); }
  });
  const lo = $("#logout", root); if (lo) lo.addEventListener("click", async () => { await api("/api/logout", { method: "POST", body: {} }); await refresh(); });
  const ib = $("#impBtn", root); if (ib) ib.addEventListener("click", async () => {
    const f = $("#impFile", root).files[0]; if (!f) return toast("Choose a file");
    try { const j = JSON.parse(await f.text()); j.mode = $('input[name="impMode"]:checked', root).value; const r = await api("/api/admin/import", { method: "POST", body: j }); toast(`Restored ${r.imported} items`); await refresh(); } catch (er) { toast("Restore failed: " + er.message); }
  });
  const tb = $("#tgzBtn", root); if (tb) tb.addEventListener("click", async () => {
    const files = [...$("#tgzFile", root).files]; if (!files.length) return toast("Choose scan files");
    const out = $("#tgzOut", root); out.textContent = "";
    for (const f of files) { try { await api("/api/admin/upload?name=" + encodeURIComponent(f.name), { method: "POST", body: f, raw: true }); out.innerHTML += `✓ ${esc(f.name)}<br>`; } catch (er) { out.innerHTML += `✗ ${esc(f.name)}: ${esc(er.message)}<br>`; } }
    pollEngine("discovery");
  });
}
async function pollEngine(which, quiet) {
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const s = await api("/api/status");
    if (!s.engine[which].running) { await refresh(); if (!quiet) toast(which === "discovery" ? "Refreshed" : "All addresses tested"); return; }
  }
}

// ------------------------------------------------------------------ wiring & router
function wire(root = document) {
  $$("[data-fav]", root).forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); toggleFav(b.dataset.fav); }));
  $$("[data-open]", root).forEach((b) => b.addEventListener("click", () => recordOpen(b.dataset.open)));
  $$("[data-details]", root).forEach((b) => {
    b.addEventListener("click", (e) => {
      if (b.tagName === "TR" && e.target.closest("a")) return; // a link inside a list row opens the link
      e.preventDefault(); e.stopPropagation(); openDetails(b.dataset.details);
    });
    if (b.getAttribute("role") === "button") b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetails(b.dataset.details); } });
  });
}
async function render() {
  const [r, qs] = (location.hash.replace(/^#\/?/, "") || "home").split("?");
  S.route = NAV.some((n) => n[0] === r) ? r : "home";
  let inner;
  try {
    inner = { home: vHome, services: vServices, network: vNetwork, issues: vIssues, admin: vAdmin }[S.route]();
    if (inner instanceof Promise) inner = await inner;
  } catch (e) { inner = `<div class="glass pad note warn">Could not show this page: ${esc(e.message)}</div>`; console.error(e); }
  const y = window.scrollY;
  $("#root").innerHTML = shell(inner);
  document.title = (S.inv.settings_public?.dashboard_title || "Homelab") + " · " + (NAV.find((n) => n[0] === S.route) || [0, ""])[1];
  const root = $("#root");
  wire(root);
  $$("[data-mode]", root).forEach((b) => b.addEventListener("click", () => { S.mode = b.dataset.mode; ls.set("mode", S.mode); index(); render(); }));
  $$("[data-show]", root).forEach((b) => b.addEventListener("click", () => { S.show = S.show === b.dataset.show && b.dataset.show !== "all" ? "all" : b.dataset.show; render(); }));
  $$("[data-group]", root).forEach((b) => b.addEventListener("click", () => { S.group = b.dataset.group; ls.set("group", S.group); render(); }));
  $$("[data-goto]", root).forEach((b) => b.addEventListener("click", () => { S.adminTab = b.dataset.goto; ls.set("adminTab", S.adminTab); }));
  $$("[data-jump]", root).forEach((b) => b.addEventListener("click", () => $("#unk")?.scrollIntoView({ behavior: "smooth" })));
  const q = $("#q", root); if (q) q.addEventListener("input", () => { S.q = q.value; const p = q.selectionStart; render().then(() => { const n = $("#q"); if (n) { n.focus(); n.setSelectionRange(p, p); } }); });
  const g = $("#genDigest", root); if (g) g.addEventListener("click", async () => { g.disabled = true; try { await api("/api/admin/digest", { method: "POST", body: {} }); toast("Digest updated"); render(); } catch (e) { toast(e.message); g.disabled = false; } });
  if (S.route === "admin") wireAdmin(root);
  if (S.sel) { renderDrawer.quiet = true; renderDrawer(); renderDrawer.quiet = false; }
  if (!render.nav) window.scrollTo(0, y);
  render.nav = false;
}
async function refresh() { await load(); await render(); }
window.addEventListener("hashchange", () => { closeDetails(); render.nav = true; window.scrollTo(0, 0); render(); });
document.addEventListener("keydown", (e) => { if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { const q = $("#q"); if (q) { e.preventDefault(); q.focus(); } } });
load().then(render).catch(async (e) => {
  if (e.status === 401) { S.inv = { apps: [], devices: [], nodes: [], workloads: [], containers: [], domains: [], routes: [], issues: [], sources: [], networks: [], summary: {} }; S.me = await api("/api/me").catch(() => ({ password_set: true })); index(); location.hash = "#/admin"; return render(); }
  $("#root").innerHTML = `<div class="glass login">Could not load the dashboard: ${esc(e.message)}</div>`;
});
setInterval(() => { if (document.visibilityState === "visible" && !document.querySelector("input:focus,textarea:focus,select:focus") && !S.sel && S.route !== "admin") refresh(); }, 60000);
