/* Homelab dashboard — vanilla JS, no build step.
 * Data comes from /api/inventory (discovered facts merged with your overrides).
 * Nothing here can change infrastructure; admin calls only edit dashboard rows. */
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
  if (s < 0) return "just now";
  if (s < 60) return Math.round(s) + "s ago";
  if (s < 3600) return Math.round(s / 60) + "m ago";
  if (s < 86400) return Math.round(s / 3600) + "h ago";
  return Math.round(s / 86400) + "d ago";
};
const fmtTime = (iso) => iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";
const pct = (a, b) => (a && b ? Math.round((a / b) * 100) : 0);
const gb = (b) => (b ? (b / 1073741824).toFixed(1) + " GB" : "—");

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
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast("Copied"); }
  catch {
    const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast("Copied"); } catch { toast("Copy failed — select and copy manually"); }
    ta.remove();
  }
}

// ------------------------------------------------------------------ icons (inline SVG, stroke = currentColor)
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
const svg = (name, cls = "") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[name] || P.q}"/></svg>`;

// Status vocabulary — every color is paired with an icon and a word (never color alone).
const STATUS = {
  up: ["Up", "ok"], auth: ["Up · login", "lock"], reachable: ["Reachable", "ok"], degraded: ["Degraded", "warn"],
  down: ["Down", "down"], "dns-fail": ["DNS failed", "down"], unreachable: ["Unreachable from collector", "cloud"],
  unverified: ["Unverified", "q"], stopped: ["Stopped", "pause"], disabled: ["Disabled", "ban"], unsupported: ["Not HTTP", "q"],
  verified: ["Verified", "ok"], configured: ["Configured", "globe"], discovered: ["Discovered", "search"], inferred: ["Inferred", "q"],
  online: ["Online", "ok"], offline: ["Offline", "pause"], unknown: ["Unknown", "q"],
  high: ["High", "warn"], medium: ["Medium", "warn"], low: ["Low", "q"], info: ["Info", "q"],
};
const SHORT = { unreachable: "Unreachable", auth: "Login" };
const pill = (st, short = false, title = "") => {
  const [label, ic] = STATUS[st] || [st || "—", "q"];
  return `<span class="pill ${esc(st)}" title="${esc(title || label)}">${svg(ic)}${esc(short ? SHORT[st] || label : label)}</span>`;
};

const ICON_CDN = "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/";
function icon(a, cls = "") {
  const ic = a.icon;
  const letters = esc((a.name || "?").replace(/[^A-Za-z0-9 ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?");
  if (ic && /^https?:\/\//.test(ic)) return `<span class="ico ${cls}"><img alt="" src="${esc(ic)}" data-fallback="${letters}" loading="lazy"></span>`;
  if (ic && /^[a-z0-9-]+$/.test(ic)) return `<span class="ico ${cls}"><img alt="" src="${ICON_CDN}${esc(ic)}.svg" data-fallback="${letters}" loading="lazy"></span>`;
  if (ic) return `<span class="ico ${cls}" aria-hidden="true">${esc(ic)}</span>`;
  return `<span class="ico ${cls}" aria-hidden="true">${letters}</span>`;
}
document.addEventListener("error", (e) => {
  const img = e.target;
  if (img.tagName !== "IMG" || img.dataset.fallback === undefined) return;
  // dashboard-icons ships some icons only as PNG: try that before falling back to initials
  if (img.src.includes("/dashboard-icons/svg/")) { img.src = img.src.replace("/svg/", "/png/").replace(/\.svg$/, ".png"); return; }
  const s = img.parentElement; s.textContent = img.dataset.fallback;
}, true);

// ------------------------------------------------------------------ state
const S = {
  inv: null, me: { admin: false }, mode: ls.get("mode", null), q: "", favs: [], recents: ls.get("recents", []),
  filters: ls.get("filters", { cat: "", status: "", host: "", vlan: "", type: "", showHidden: false }),
  route: "overview", sel: null, adminTab: ls.get("adminTab", "entries"),
};
const byId = () => {
  const m = new Map();
  for (const a of S.inv.apps) { m.set(a.id, a); for (const al of a.aliases || []) m.set(al, a); }
  return m;
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
  S.appMap = byId();
  for (const a of inv.apps) a._fav = a.favorite || S.favs.includes(a.id);
}

// ------------------------------------------------------------------ helpers over the model
function epOf(a, id) { return a.endpoints.find((e) => e.id === id); }
function preferred(a, mode = S.mode) {
  const d = epOf(a, a.preferred_domain), i = epOf(a, a.preferred_ip);
  if (mode === "ip") return i || null;
  return d || i || null;
}
function hostChain(a) {
  const L = a.location || {}, out = [];
  const w = S.wlById.get(L.workload_id), n = S.nodeById.get(L.node_id || (w && w.node_id)), d = S.devById.get(L.device_id);
  if (n) out.push(n.name);
  if (w) out.push(`${w.kind.toUpperCase()} ${w.vmid} ${w.display_name || w.name || ""}`.trim());
  if (!n && !w && d) out.push(d.name || d.hostname || d.ip);
  if (!out.length && L.host_label) out.push(L.host_label);
  if (L.container_id) out.push((L.compose_project ? L.compose_project + "/" : "") + (L.compose_service || L.container_id.split(":").pop()));
  if (L.addon) out.push("add-on");
  return out;
}
function appType(a) {
  if (a.manual) return "manual";
  if (a.kind === "addon") return "ha-addon";
  if (a.location?.container_id) return "container";
  if (a.location?.node_id && a.catalog_key === "proxmox") return "hypervisor";
  if (a.endpoints.some((e) => e.proxy)) return "proxied";
  if (a.location?.device_id) return "device";
  return "other";
}
const TYPE_LABEL = { container: "Container", "ha-addon": "HA add-on", hypervisor: "Hypervisor", proxied: "Behind proxy", device: "Device / appliance", manual: "Manual", other: "Other" };
const hostKey = (a) => hostChain(a)[0] || "Unknown host";
function recordOpen(a) {
  S.recents = [a.id, ...S.recents.filter((x) => x !== a.id)].slice(0, 12);
  ls.set("recents", S.recents);
}
async function toggleFav(id) {
  const a = S.appMap.get(id); if (!a) return;
  a._fav = !a._fav;
  S.favs = a._fav ? [...new Set([...S.favs, a.id])] : S.favs.filter((x) => x !== a.id);
  try { await api("/api/prefs/favorites", { method: "PUT", body: { favorites: S.favs } }); }
  catch (e) { toast("Could not save favorite: " + e.message); }
  render();
}

// ------------------------------------------------------------------ search
function searchAll(q) {
  q = q.trim().toLowerCase(); if (!q) return [];
  const hit = (...xs) => xs.some((x) => x && String(x).toLowerCase().includes(q));
  const out = [];
  for (const a of S.inv.apps) {
    if (a.hidden && !S.filters.showHidden) continue;
    if (hit(a.name, a.discovered_name, a.category, a.purpose, a.location?.host_ip, a.location?.host_label, a.location?.compose_project, a.location?.compose_service,
      a.location?.container_id, ...(a.tags || []), ...a.endpoints.map((e) => e.url), ...a.endpoints.map((e) => e.upstream), ...hostChain(a)))
      out.push({ g: "Applications", id: a.id, t: a.name, s: (preferred(a) || {}).url || hostChain(a).join(" › "), app: a });
  }
  for (const d of S.inv.devices) if (hit(d.name, d.hostname, d.ip, d.mac, d.vendor, d.role)) out.push({ g: "Devices", t: d.name || d.hostname || d.ip || d.mac, s: `${d.ip || ""} ${d.online ? "online" : d.online === false ? "offline" : ""}`, dev: d });
  for (const w of S.inv.workloads) if (hit(w.name, w.vmid, ...(w.ips || []), w.node)) out.push({ g: "VMs & LXCs", t: `${w.kind.toUpperCase()} ${w.vmid} ${w.name}`, s: `${w.node} · ${w.status}`, wl: w });
  for (const c of S.inv.containers) if (hit(c.name, c.image, c.compose_project, c.host_label)) out.push({ g: "Containers", t: c.name, s: `${c.host_label} · ${c.state}`, ct: c });
  for (const d of S.inv.domains) if (hit(d.name, ...(d.addresses || []))) out.push({ g: "Domains", t: d.name, s: (d.addresses || [d.error]).join(", "), dom: d });
  return out.slice(0, 60);
}
function renderResults() {
  const box = $("#results"); if (!box) return;
  const res = searchAll(S.q);
  if (!S.q.trim()) { box.hidden = true; return; }
  box.hidden = false;
  if (!res.length) { box.innerHTML = `<div class="empty">No matches for “${esc(S.q)}”.</div>`; return; }
  let g = "", h = "";
  res.forEach((r, i) => {
    if (r.g !== g) { g = r.g; h += `<div class="grp">${esc(g)}</div>`; }
    const lead = r.app ? icon(r.app, "sm") : `<span class="ico sm">${svg(r.dev ? "dev" : r.wl ? "tree" : r.dom ? "globe" : "grid")}</span>`;
    h += `<a href="#" data-r="${i}">${lead}<span>${esc(r.t)}${r.app ? " " + pill(r.app.status, true) : ""}</span><span class="sub mono">${esc(r.s || "")}</span></a>`;
  });
  box.innerHTML = h;
  $$("a[data-r]", box).forEach((el) => el.addEventListener("click", (e) => {
    e.preventDefault(); const r = res[+el.dataset.r];
    S.q = ""; $("#q").value = ""; box.hidden = true;
    if (r.app) openDetails(r.app.id);
    else if (r.dev) { location.hash = "#/devices?q=" + encodeURIComponent(r.dev.ip || r.dev.mac || r.t); }
    else if (r.wl || r.ct) location.hash = "#/infra";
    else if (r.dom) location.hash = "#/network?q=" + encodeURIComponent(r.dom.name);
  }));
}

// ------------------------------------------------------------------ shell
const NAV = [
  ["overview", "Home", "home"], ["apps", "Apps", "grid"], ["infra", "Infrastructure", "tree"], ["network", "DNS & proxy", "globe"],
  ["devices", "Devices", "dev"], ["digest", "Digest", "digest"], ["diag", "Diagnostics", "pulse"], ["admin", "Admin", "gear"],
];
const TABBAR = ["overview", "apps", "infra", "network", "digest", "admin"];
function shell(inner) {
  const issues = S.inv.issues.filter((i) => i.severity === "high" || i.severity === "medium").length;
  const navItem = ([k, label, ic]) => `<a href="#/${k}" class="${S.route === k ? "on" : ""}">${svg(ic)}<span>${label}</span>${k === "overview" && issues ? `<span class="badge">${issues}</span>` : ""}</a>`;
  const theme = ls.get("theme", "auto");
  return `<div class="app">
  <aside class="side"><div class="brand"><img src="icon.svg" alt="">Homelab</div><nav class="nav">${NAV.map(navItem).join("")}</nav>
    <div class="side-foot">Collector: <span class="mono">${esc(S.inv.collector || "?")}</span><br>Discovery ${esc(ago(S.inv.generated_at))}<br>Checks ${esc(ago(S.inv.engine?.checks?.last))}</div></aside>
  <main>
    <div class="top">
      <div class="brand-m"><img src="icon.svg" alt="" width="26" height="26">Homelab</div>
      <div class="search" role="search">${svg("search")}<input id="q" type="search" placeholder="Search apps, devices, domains, IPs, containers…" autocomplete="off" aria-label="Search" value="${esc(S.q)}"><kbd>/</kbd><div id="results" class="results" hidden></div></div>
      <div class="seg" role="group" aria-label="Open links by"><button data-mode="domain" class="${S.mode === "domain" ? "on" : ""}" aria-pressed="${S.mode === "domain"}">Domain</button><button data-mode="ip" class="${S.mode === "ip" ? "on" : ""}" aria-pressed="${S.mode === "ip"}">IP</button></div>
      <button class="iconbtn" id="theme" title="Theme: ${theme}" aria-label="Toggle theme (${theme})">${svg("sun")}</button>
    </div>
    ${inner}
  </main>
  <nav class="tabbar" aria-label="Sections">${NAV.filter((n) => TABBAR.includes(n[0])).map(([k, label, ic]) => `<a href="#/${k}" class="${S.route === k ? "on" : ""}">${svg(ic)}${label.split(" ")[0]}${k === "overview" && issues ? `<span class="badge">${issues}</span>` : ""}</a>`).join("")}</nav>
</div>`;
}
function wireShell() {
  const q = $("#q");
  q.addEventListener("input", () => { S.q = q.value; renderResults(); });
  q.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { S.q = ""; q.value = ""; renderResults(); }
    if (e.key === "Enter") { const first = $("#results a"); if (first) first.click(); }
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".search")) { const b = $("#results"); if (b) b.hidden = true; } }, { once: true });
  $$("[data-mode]").forEach((b) => b.addEventListener("click", () => { S.mode = b.dataset.mode; ls.set("mode", S.mode); render(); }));
  $("#theme").addEventListener("click", () => {
    const order = ["auto", "light", "dark"], cur = ls.get("theme", "auto"), next = order[(order.indexOf(cur) + 1) % 3];
    ls.set("theme", next); applyTheme(); render(); toast("Theme: " + next);
  });
}
function applyTheme() {
  const t = ls.get("theme", "auto");
  if (t === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.dataset.theme = t;
}

// ------------------------------------------------------------------ cards
function card(a) {
  const ep = preferred(a), dom = epOf(a, a.preferred_domain);
  let urlLine;
  if (ep) urlLine = `<div class="url" title="${esc(ep.url)}">${esc(ep.url.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</div>`;
  else if (S.mode === "ip" && dom) urlLine = `<div class="url none">${esc(a.direct_ip_note || "No direct IP address known — use the domain")}</div>`;
  else urlLine = `<div class="url none">No web address known</div>`;
  const dim = a.hidden || a.status === "disabled";
  return `<article class="card acard ${dim ? "dim" : ""}" data-app="${esc(a.id)}" tabindex="0" aria-label="${esc(a.name)}">
    ${icon(a)}
    <div class="meta"><div class="nm">${esc(a.name)}</div><div class="sub2">${esc(a.purpose || a.category || "")}</div></div>
    <button class="star ${a._fav ? "on" : ""}" data-fav="${esc(a.id)}" aria-pressed="${a._fav}" aria-label="${a._fav ? "Remove from" : "Add to"} favorites">${svg("star")}</button>
    <div style="grid-column:1/-1;display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">${pill(a.status)}${ep ? pill(ep.status, false, "How this URL is known") : ""}${a.hidden ? '<span class="pill">Hidden</span>' : ""}</div>
    ${urlLine}
    <div class="loc">${esc(hostChain(a).join(" › ") || "Location unknown")}${a.vlan ? ` · VLAN ${esc(a.vlan)}` : ""}</div>
    <div class="acts">${ep ? `<a class="btn sm primary" href="${esc(ep.url)}" target="_blank" rel="noopener noreferrer" data-open="${esc(a.id)}">${svg("ext")}Open</a>` : ""}<button class="btn sm" data-details="${esc(a.id)}">Details</button></div>
  </article>`;
}
function wireCards(root = document) {
  $$("[data-fav]", root).forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); toggleFav(b.dataset.fav); }));
  $$("[data-open]", root).forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); recordOpen(S.appMap.get(b.dataset.open)); }));
  $$("[data-details]", root).forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openDetails(b.dataset.details); }));
  $$(".acard", root).forEach((c) => {
    c.addEventListener("click", () => openDetails(c.dataset.app));
    c.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target === c) openDetails(c.dataset.app); });
  });
  $$("[data-app-row]", root).forEach((r) => r.addEventListener("click", (e) => { if (e.target.closest("a,button")) return; e.preventDefault(); openDetails(r.dataset.appRow); }));
  $$(".lt[data-details]", root).forEach((t) => t.addEventListener("keydown", (e) => { if (e.key === "Enter") openDetails(t.dataset.details); }));
}
function mini(a) {
  const ep = preferred(a);
  return `<div class="card mini" data-app="${esc(a.id)}">${icon(a, "sm")}<div style="min-width:0;flex:1"><div class="nm">${esc(a.name)}</div><div class="tiny muted mono" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(ep ? ep.url.replace(/^https?:\/\//, "") : "no URL")}</div></div>${pill(a.status, true)}${ep ? `<a class="iconbtn" style="width:32px;height:32px" href="${esc(ep.url)}" target="_blank" rel="noopener noreferrer" data-open="${esc(a.id)}" aria-label="Open ${esc(a.name)}">${svg("ext")}</a>` : ""}</div>`;
}

// ------------------------------------------------------------------ v2 building blocks
const ST_TEXT = {
  up: "Up", auth: "Up (login page)", reachable: "Reachable", degraded: "Degraded", down: "Down", "dns-fail": "No DNS record",
  unreachable: "Not checkable from the collector", unverified: "Not checked yet", stopped: "Stopped", disabled: "Disabled",
};
const sdot = (st) => `<span class="sd ${esc(st)}" role="img" aria-label="${esc(ST_TEXT[st] || st)}" title="${esc(ST_TEXT[st] || st)}"></span>`;
function shortHost(a) {
  const L = a.location || {}, w = S.wlById.get(L.workload_id);
  if (w) return w.display_name || w.name;
  return L.host_label || L.host_ip || "";
}
function tile(a) {
  const ep = preferred(a);
  const cls = `lt ${ep ? "" : "nourl"} ${a.hidden || a.status === "disabled" || a.status === "stopped" ? "dim" : ""}`;
  const inner = `${sdot(a.status)}<button class="more" data-details="${esc(a.id)}" aria-label="Details for ${esc(a.name)}">${svg("q")}</button>
    ${icon(a)}<div class="nm">${esc(a.name.split(" · ")[0])}${a.name.includes(" · ") ? `<span class="sfx"> · ${esc(a.name.split(" · ").slice(1).join(" · "))}</span>` : ""}</div><div class="host">${esc(shortHost(a))}</div>
    ${a._fav ? `<span class="fav" aria-label="Favorite">${svg("star")}</span>` : ""}`;
  return ep
    ? `<a class="${cls}" href="${esc(ep.url)}" target="_blank" rel="noopener noreferrer" data-open="${esc(a.id)}" title="${esc(a.name)} — ${esc(ep.url)} — ${esc(ST_TEXT[a.status] || a.status)}">${inner}</a>`
    : `<div class="${cls}" data-details="${esc(a.id)}" tabindex="0" role="button" title="${esc(a.name)} — no web address known">${inner}</div>`;
}
function arow(a) {
  const ep = preferred(a), dom = epOf(a, a.preferred_domain);
  const u = ep ? `<div class="u" title="${esc(ep.url)}">${esc(ep.url.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</div>`
    : `<div class="u none">${esc(S.mode === "ip" && dom ? "Only reachable by name" : "No web address")}</div>`;
  return `<div class="arow ${a.hidden ? "dim" : ""}" data-app-row="${esc(a.id)}">
    ${icon(a)}<div style="min-width:0"><div class="nm">${esc(a.name)}</div><div class="pp">${esc(a.purpose || a.category || "")}</div></div>
    ${u}<div class="lc">${esc(hostChain(a).join(" › "))}${a.vlan != null ? ` · VLAN ${esc(a.vlan)}` : ""}</div>
    <div class="st"><span class="stl">${esc(ST_TEXT[a.status] || a.status)}</span>${sdot(a.status)}
      <button class="star ${a._fav ? "on" : ""}" data-fav="${esc(a.id)}" aria-pressed="${a._fav}" aria-label="Favorite">${svg("star")}</button>
      ${ep ? `<a class="btn sm" href="${esc(ep.url)}" target="_blank" rel="noopener noreferrer" data-open="${esc(a.id)}">Open</a>` : ""}</div></div>`;
}
function launcherGroups(list) {
  const order = S.inv.settings_public?.categories_order || [];
  const groups = {};
  for (const a of list) (groups[a.category || "Other"] = groups[a.category || "Other"] || []).push(a);
  const cats = Object.keys(groups).sort((x, y) => ((order.indexOf(x) + 1 || 99) - (order.indexOf(y) + 1 || 99)) || x.localeCompare(y));
  return cats.map((c) => `<section class="lgroup"><div class="lgroup-h"><h2>${esc(c)}</h2><span class="n">${groups[c].length}</span></div>
    <div class="launch">${groups[c].sort((x, y) => (x.order ?? 1000) - (y.order ?? 1000) || x.name.localeCompare(y.name)).map(tile).join("")}</div></section>`).join("");
}
function healthStrip(apps) {
  const bucket = (s) => (["up", "auth", "reachable"].includes(s) ? "up" : ["down", "dns-fail"].includes(s) ? "down" : s);
  const c = {};
  apps.forEach((a) => { const b = bucket(a.status); c[b] = (c[b] || 0) + 1; });
  const parts = [["up", "Up"], ["degraded", "Degraded"], ["down", "Down / no DNS"], ["stopped", "Stopped"], ["unreachable", "Not checkable from here"], ["unverified", "Not checked"]];
  const total = apps.length || 1;
  return `<div class="panel health"><div class="row" style="justify-content:space-between"><h2>Health</h2><span class="tiny muted">checked ${esc(ago(S.inv.engine?.checks?.last))} from ${esc((S.inv.collector || "").split(" ")[0])}</span></div>
    <div class="hbar" role="img" aria-label="${parts.map(([k, l]) => `${c[k] || 0} ${l}`).join(", ")}">${parts.filter(([k]) => c[k]).map(([k]) => `<i class="${k}" style="width:${(c[k] / total) * 100}%"></i>`).join("")}</div>
    <div class="hlegend">${parts.filter(([k]) => c[k]).map(([k, l]) => `<a href="#/apps?status=${k}">${sdot(k === "down" ? "down" : k)}<b>${c[k]}</b> ${l}</a>`).join("")}</div></div>`;
}

// ------------------------------------------------------------------ home (launcher)
function vOverview() {
  const inv = S.inv;
  const visible = inv.apps.filter((a) => !a.hidden && a.kind !== "addon-noui");
  const launchable = visible.filter((a) => a.endpoints.length);
  const noUrl = visible.filter((a) => !a.endpoints.length);
  const favs = visible.filter((a) => a._fav).sort((x, y) => S.favs.indexOf(x.id) - S.favs.indexOf(y.id));
  const recents = S.recents.map((id) => S.appMap.get(id)).filter((a) => a && !a._fav).slice(0, 8);
  const sevOrder = { high: 0, medium: 1, low: 2, info: 3 };
  const issues = [...inv.issues].sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);
  const top = issues.filter((i) => i.severity === "high" || i.severity === "medium").slice(0, 6);
  const nodes = inv.nodes.map((n) => {
    const wl = inv.workloads.filter((w) => w.node_id === n.id);
    const run = wl.filter((w) => w.status === "running").length;
    return `<a class="att" href="#/infra" style="color:inherit;text-decoration:none">${sdot(n.verified ? (n.status === "online" ? "up" : "down") : "unverified")}
      <div class="t">${esc(n.name)} <span class="tiny muted mono">${esc(n.ip)}</span></div>
      <div class="s">${n.verified ? `${run}/${wl.length} guests running${n.maxmem ? ` · memory ${pct(n.mem, n.maxmem)}%` : ""}` : "not verified yet"}</div></a>`;
  }).join("");
  const rail = `<aside class="home-rail">
    ${healthStrip(visible)}
    <div class="panel"><div class="panel-h"><h2>Needs attention</h2><a href="#/digest">All ${issues.length} →</a></div>
      ${top.map((i) => `<div class="att"><span class="sev ${i.severity}" title="${esc(i.severity)} priority"></span><div class="t">${esc(i.title)}</div><div class="s">${esc(i.suggestion || "")}</div></div>`).join("") || '<div class="empty small">Nothing urgent.</div>'}</div>
    <div class="panel"><div class="panel-h"><h2>Proxmox · ${esc(inv.nodes[0]?.cluster || "")}</h2><a href="#/infra">Hosts →</a></div>${nodes}<div style="height:6px"></div></div>
  </aside>`;
  const head = `<div class="page-head"><div><h1>Home</h1><p>${launchable.length} apps you can open · ${inv.workloads.length} VMs/LXCs · ${inv.containers.length} containers</p></div></div>`;
  return `${head}<div class="show-m" style="margin-bottom:14px">${healthStrip(visible)}</div><div class="home"><div>
    ${favs.length ? `<section class="lgroup"><div class="lgroup-h"><h2>Favorites</h2></div><div class="launch">${favs.map(tile).join("")}</div></section>` : ""}
    ${recents.length ? `<section class="lgroup"><div class="lgroup-h"><h2>Recent</h2><span class="n">this device</span></div><div class="launch">${recents.map(tile).join("")}</div></section>` : ""}
    ${launcherGroups(launchable)}
    ${noUrl.length ? `<details class="lgroup"><summary class="lgroup-h" style="cursor:pointer"><h2>Without a web address</h2><span class="n">${noUrl.length}</span></summary><div class="launch" style="margin-top:10px">${noUrl.map(tile).join("")}</div></details>` : ""}
    <p class="tiny muted">Tap a tile to open it. Hover (or use the Apps list on phones) for details. Star apps in their details to pin them on top.</p>
  </div>${rail}</div>`;
}

// ------------------------------------------------------------------ infrastructure (host cards)
function meter(label, used, total, fmt) {
  const p = pct(used, total);
  return `<div class="meter"><div class="k"><span>${label}</span><b>${total ? p + "%" : "—"}</b></div><div class="mbar"><i class="${p > 90 ? "crit" : p > 75 ? "hot" : ""}" style="width:${p}%"></i></div>
    <div class="tiny muted" style="margin-top:3px">${total ? fmt(used) + " / " + fmt(total) : "not reported"}</div></div>`;
}
function vInfra() {
  const inv = S.inv;
  const appsOf = (pred) => inv.apps.filter((a) => !a.hidden && pred(a));
  const chipApp = (a) => `<span class="gapp" data-app-row="${esc(a.id)}">${icon(a, "sm")}${esc(a.name.replace(/ · .*$/, "").replace(/ \(.*\)$/, ""))}${sdot(a.status)}</span>`;
  const guestRow = (w) => {
    const cts = inv.containers.filter((c) => c.host_id === w.id);
    const apps = appsOf((a) => a.location?.workload_id === w.id);
    const st = w.disabled ? "disabled" : w.status === "running" ? "up" : w.status === "stopped" ? "stopped" : "unverified";
    const memTxt = w.maxmem ? `<div class="mcol"><div class="mbar" title="memory ${pct(w.mem, w.maxmem)}%"><i style="width:${pct(w.mem, w.maxmem)}%"></i></div></div>` : `<span class="mcol"></span>`;
    const summary = `<summary class="g ${w.status === "stopped" ? "stopped" : ""}">${sdot(st)}<span class="id">${w.kind === "vm" ? "VM" : "LXC"} ${esc(w.vmid)}</span>
      <span class="nm">${esc(w.display_name || w.name)}<small>${esc((w.ips || [])[0] || "")}</small></span>
      <span class="row" style="gap:6px">${cts.length ? `<span class="chip2">${cts.filter((c) => c.state === "running").length}/${cts.length} containers</span>` : ""}${w.onboot && w.status === "stopped" ? '<span class="chip2" style="color:var(--warn-ink)">onboot</span>' : ""}${w.kind === "vm" && w.status === "running" && !w.guest_collected_at ? '<span class="chip2" title="No QEMU guest agent: apps inside unknown">agent off</span>' : ""}</span>${memTxt}</summary>`;
    if (!apps.length && !cts.length) return `<div>${summary.replace("<summary", "<div").replace("</summary>", "</div>")}</div>`;
    const ctOnly = cts.filter((c) => !apps.some((a) => a.location?.container_id === c.id));
    return `<details class="gx">${summary}<div class="gapps">${apps.map(chipApp).join("")}${ctOnly.map((c) => `<span class="gapp ct" title="${esc(c.image)}">${sdot(c.state === "running" ? "up" : "stopped")}${esc(c.name)}</span>`).join("")}</div></details>`;
  };
  const nodes = inv.nodes.map((n) => {
    const wl = inv.workloads.filter((w) => w.node_id === n.id).sort((a, b) => (a.status === "running" ? 0 : 1) - (b.status === "running" ? 0 : 1) || a.vmid - b.vmid);
    const up = n.uptime ? `up ${Math.round(n.uptime / 86400)} d` : "";
    return `<section class="card hcard"><div class="hcard-h">${icon({ name: n.name, icon: "proxmox" })}<div style="flex:1;min-width:0"><div class="t">${esc(n.name)}</div>
        <div class="s mono">${esc(n.ip)} · ${esc(n.pveversion ? "PVE " + ((n.pveversion.match(/proxmox-ve:\s*([\d.]+)/) || [])[1] || n.pveversion) : (n.verified ? "Proxmox VE" : "not verified"))} ${up ? "· " + up : ""}</div></div>${sdot(n.verified ? (n.status === "online" ? "up" : "down") : "unverified")}</div>
      ${n.verified ? `<div class="meters">${meter("CPU", n.cpu || 0, 1, (x) => Math.round(x * 100) + "%").replace(/\d+% \/ 100%/, `${n.maxcpu || "?"} cores`)}${meter("Memory", n.mem, n.maxmem, gb)}${meter("Root disk", n.disk, n.maxdisk, gb)}</div>` : ""}
      <div class="guests">${wl.map(guestRow).join("") || '<div class="empty small">No guests reported.</div>'}</div></section>`;
  }).join("");
  const placed = new Set(inv.apps.filter((a) => a.location?.node_id || a.location?.workload_id).map((a) => a.id));
  const standalone = inv.devices.filter((d) => !d.workload_id && !d.node_id && !["client", "iot-climate", "proxmox-guest"].includes(d.role) && !d.hidden)
    .sort((a, b) => ipSort(a.ip) - ipSort(b.ip));
  const devRow = (d) => {
    const apps = appsOf((a) => !placed.has(a.id) && a.location?.device_id === d.id);
    const sum = `<summary class="g">${sdot(d.online ? "up" : d.online === false ? "stopped" : "unverified")}<span class="id">${esc((d.role || "device").replace("unifi-device", "UniFi").replace("raspberry-pi", "Pi").slice(0, 9))}</span>
      <span class="nm">${esc(d.name || d.hostname || d.mac)}<small>${esc(d.ip || "")}</small></span><span class="row">${d.vlan != null ? `<span class="chip2">VLAN ${esc(d.vlan)}</span>` : ""}</span><span class="mcol"></span></summary>`;
    return apps.length ? `<details class="gx">${sum}<div class="gapps">${apps.map(chipApp).join("")}</div></details>` : `<div>${sum.replace("<summary", "<div").replace("</summary>", "</div>")}</div>`;
  };
  return `<div class="page-head"><div><h1>Infrastructure</h1><p>Cluster <b>${esc(inv.nodes[0]?.cluster || "?")}</b> · ${inv.workloads.filter((w) => w.status === "running").length}/${inv.workloads.length} guests running · ${inv.containers.length} containers. Click a guest to see what runs in it.</p></div></div>
  <div class="hosts">${nodes}</div>
  <section class="card hcard" style="margin-top:16px"><div class="hcard-h"><div style="flex:1"><div class="t">Outside Proxmox</div><div class="s">Gateway, switches, access points, servers, Pis and appliances seen by UniFi</div></div></div>
    <div class="guests">${standalone.map(devRow).join("")}</div></section>`;
}

function issueRow(i) {
  const ev = (i.evidence || []).filter(Boolean);
  const target = i.ref && S.appMap.get(i.ref) ? i.ref : (S.inv.apps.find((a) => a.endpoints.some((e) => e.id === i.ref)) || {}).id;
  return `<div class="issue">${pill(i.severity)}<div class="t">${esc(i.title)}${target ? ` <a href="#" data-details="${esc(target)}" class="small">details</a>` : ""}</div>
    <div class="ev">${ev.length ? `<ul>${ev.slice(0, 6).map((e) => `<li>${esc(e)}</li>`).join("")}${ev.length > 6 ? `<li class="muted">+${ev.length - 6} more</li>` : ""}</ul>` : ""}
    ${i.suggestion ? `<div><b>Next step:</b> ${esc(i.suggestion)}</div>` : ""}${i.hypothesis ? `<div class="hyp">Hypothesis (unconfirmed): ${esc(i.hypothesis)}</div>` : ""}</div></div>`;
}

// ------------------------------------------------------------------ apps view
function appMatches(a, f) {
  if (a.hidden && !f.showHidden) return false;
  if (f.cat && (a.category || "Other") !== f.cat) return false;
  if (f.status) {
    const g = { up: ["up", "auth", "reachable"], down: ["down", "dns-fail"] }[f.status] || [f.status];
    if (!g.includes(a.status)) return false;
  }
  if (f.host && hostKey(a) !== f.host) return false;
  if (f.vlan && String(a.vlan ?? "none") !== f.vlan) return false;
  if (f.type && appType(a) !== f.type) return false;
  if (f.fav && !a._fav) return false;
  return true;
}
function chipRow(label, key, values, counts) {
  const f = S.filters;
  return `<div class="row"><span class="lbl">${label}</span><div class="chips">
    <button class="chip ${!f[key] ? "on" : ""}" data-f="${key}" data-v="">All</button>
    ${values.map(([v, t]) => `<button class="chip ${f[key] === v ? "on" : ""}" data-f="${key}" data-v="${esc(v)}">${esc(t)} <span class="n">${counts[v] || 0}</span></button>`).join("")}</div></div>`;
}
function vApps(params) {
  if (params.get("status")) S.filters.status = params.get("status");
  const f = S.filters, apps = S.inv.apps;
  const base = apps.filter((a) => !a.hidden || f.showHidden);
  const count = (fn) => base.reduce((m, a) => ((m[fn(a)] = (m[fn(a)] || 0) + 1), m), {});
  const order = S.inv.settings_public?.categories_order || [];
  const cats = [...new Set(base.map((a) => a.category || "Other"))].sort((a, b) => ((order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)) || a.localeCompare(b));
  const hosts = [...new Set(base.map(hostKey))].sort();
  const vlans = [...new Set(base.map((a) => String(a.vlan ?? "none")))].sort((a, b) => (+a || 9999) - (+b || 9999));
  const types = [...new Set(base.map(appType))];
  const stCount = count((a) => (["up", "auth", "reachable"].includes(a.status) ? "up" : ["down", "dns-fail"].includes(a.status) ? "down" : a.status));
  const list = apps.filter((a) => appMatches(a, f));
  const groups = {};
  for (const a of list) (groups[a.category || "Other"] = groups[a.category || "Other"] || []).push(a);
  const hostSel = `<select class="sel" data-fsel="host" aria-label="Host"><option value="">All hosts</option>${hosts.map((h) => `<option ${f.host === h ? "selected" : ""}>${esc(h)}</option>`).join("")}</select>`;
  const vlanSel = `<select class="sel" data-fsel="vlan" aria-label="VLAN"><option value="">All VLANs</option>${vlans.map((v) => `<option value="${esc(v)}" ${f.vlan === v ? "selected" : ""}>${v === "none" ? "No VLAN known" : "VLAN " + esc(v)}</option>`).join("")}</select>`;
  const typeSel = `<select class="sel" data-fsel="type" aria-label="Service type"><option value="">All types</option>${types.map((t) => `<option value="${t}" ${f.type === t ? "selected" : ""}>${TYPE_LABEL[t]}</option>`).join("")}</select>`;
  const anyF = f.cat || f.status || f.host || f.vlan || f.type || f.fav;
  return `<div class="page-head"><div><h1>Applications</h1><p>${list.length} of ${base.length} shown · links open by <b>${S.mode === "ip" ? "direct IP" : "domain"}</b> (switch at the top)</p></div>
    <div class="row"><a class="btn sm" href="/api/export/inventory.csv">Export CSV</a><a class="btn sm" href="/api/export/inventory.json">Export JSON</a></div></div>
  <details class="filters card pad" id="filt" ${window.innerWidth > 860 || ls.get("filtOpen", false) ? "open" : ""}><summary class="fsum">Filters${anyF ? ` <span class="pill info">${[f.cat, f.status, f.host, f.vlan, f.type, f.fav && "favorites"].filter(Boolean).map(esc).join(" · ")}</span>` : ""}</summary>
    ${chipRow("Status", "status", [["up", "Up"], ["degraded", "Degraded"], ["down", "Down"], ["unreachable", "Unreachable"], ["unverified", "Unverified"], ["stopped", "Stopped"], ["disabled", "Disabled"]], stCount)}
    ${chipRow("Category", "cat", cats.map((c) => [c, c]), count((a) => a.category || "Other"))}
    <div class="row"><span class="lbl">More</span>${hostSel}${vlanSel}${typeSel}
      <label class="switch"><input type="checkbox" data-fchk="fav" ${f.fav ? "checked" : ""}>Favorites</label>
      <label class="switch"><input type="checkbox" data-fchk="showHidden" ${f.showHidden ? "checked" : ""}>Show hidden (${apps.filter((a) => a.hidden).length})</label>
      ${anyF ? '<button class="btn sm" id="clearF">Clear filters</button>' : ""}</div>
  </details>
  <div class="row" style="justify-content:flex-end;margin:-4px 0 8px"><div class="viewtog" role="group" aria-label="Layout"><button data-view="list" class="${ls.get("appsView", "list") === "list" ? "on" : ""}">List</button><button data-view="grid" class="${ls.get("appsView", "list") === "grid" ? "on" : ""}">Tiles</button></div></div>
  ${list.length ? cats.filter((c) => groups[c]).map((c) => `<div class="cat-h"><h2>${esc(c)}</h2><span class="muted small">${groups[c].length}</span></div>${ls.get("appsView", "list") === "grid" ? `<div class="launch">${groups[c].map(tile).join("")}</div>` : `<div class="rows">${groups[c].map(arow).join("")}</div>`}`).join("")
    : `<div class="card empty">No applications match these filters.</div>`}`;
}
function wireFilters() {
  const save = () => { ls.set("filters", S.filters); render(); };
  $$("[data-f]").forEach((b) => b.addEventListener("click", () => { S.filters[b.dataset.f] = b.dataset.v; if (location.hash.includes("?")) history.replaceState(null, "", "#/apps"); save(); }));
  $$("[data-fsel]").forEach((s) => s.addEventListener("change", () => { S.filters[s.dataset.fsel] = s.value; save(); }));
  $$("[data-fchk]").forEach((c) => c.addEventListener("change", () => { S.filters[c.dataset.fchk] = c.checked; save(); }));
  $$("[data-view]").forEach((b) => b.addEventListener("click", () => { ls.set("appsView", b.dataset.view); render(); }));
  const fd = $("#filt"); if (fd) fd.addEventListener("toggle", () => { if (window.innerWidth <= 860) ls.set("filtOpen", fd.open); });
  const cl = $("#clearF"); if (cl) cl.addEventListener("click", () => { S.filters = { showHidden: S.filters.showHidden }; history.replaceState(null, "", "#/apps"); save(); });
}

// ------------------------------------------------------------------ details drawer
function openDetails(id) { S.sel = id; renderDrawer(); }
function closeDetails() { S.sel = null; S.lastDiag = null; const d = $("#drawer"); if (d) d.remove(); }
function epBlock(a, e) {
  const t = e.tls || {}, h = e.http || {};
  const tlsTxt = t.days_left != null ? `TLS ${t.verified === false ? "not trusted" : "valid"} · expires in ${t.days_left} d` : "";
  const isPref = e.id === a.preferred_domain || e.id === a.preferred_ip;
  return `<div class="ep">
    <div class="row"><span class="u">${esc(e.url)}</span>${isPref ? '<span class="pill info">Preferred</span>' : ""}</div>
    <div class="m">${e.health ? pill(e.health) : pill("unverified")}${pill(e.status, false, "How we know this URL")}<span class="pill">${e.kind === "domain" ? "Domain" : "Direct IP"}</span>
      ${e.auth ? '<span class="pill">Needs login</span>' : ""}${e.path_based ? '<span class="pill">Path route</span>' : ""}${e.sensitive ? '<span class="pill" title="Management UI: HTTP probed at most every 6 h">Low-frequency checks</span>' : ""}
      ${tlsTxt ? `<span class="pill ${t.days_left < 14 ? "medium" : ""}">${esc(tlsTxt)}</span>` : ""}</div>
    <div class="why">${esc(e.health_summary || "Not checked yet.")}${e.checked_at ? ` · checked ${esc(ago(e.checked_at))} from ${esc(e.collector || "collector")}` : ""}${e.last_ok_at ? ` · last OK ${esc(ago(e.last_ok_at))}` : e.checked_at ? " · never OK from this collector" : ""}</div>
    ${e.hypothesis ? `<div class="hyp">Hypothesis: ${esc(e.hypothesis)}</div>` : ""}
    ${e.proxy || e.upstream ? `<div class="why">Proxy: <b>${esc(e.proxy || "?")}</b>${e.proxy_ip ? ` on ${esc(e.proxy_ip)}` : ""}${e.upstream ? ` → upstream <span class="mono">${esc(e.upstream)}</span>` : ""}</div>` : ""}
    ${h.location ? `<div class="why">Redirects to <span class="mono">${esc(h.location)}</span></div>` : ""}
    <div class="why muted">Source: ${esc((e.sources || []).join("; "))}</div>
    <div class="row" style="margin-top:8px">
      <a class="btn sm primary" href="${esc(e.url)}" target="_blank" rel="noopener noreferrer" data-open="${esc(a.id)}">${svg("ext")}Open</a>
      <button class="btn sm" data-copy="${esc(e.url)}">${svg("copy")}Copy</button>
      <button class="btn sm" data-diag="${esc(e.id)}">${svg("pulse")}Diagnose</button>
      ${S.me.admin && !isPref ? `<button class="btn sm" data-pref="${esc(e.url)}">Make preferred</button>` : ""}
    </div></div>`;
}
function renderDrawer() {
  const old = $("#drawer"); if (old) old.remove();
  const a = S.appMap.get(S.sel); if (!a) return;
  const L = a.location || {}, w = S.wlById.get(L.workload_id), d = S.devById.get(L.device_id), c = S.ctById.get(L.container_id);
  const n = S.nodeById.get(L.node_id || (w && w.node_id));
  const chain = [];
  if (n) chain.push(`Proxmox ${esc(n.name)}`);
  else if (d) chain.push(esc(d.name || d.hostname || d.ip));
  if (w) chain.push(`${w.kind.toUpperCase()} ${w.vmid} · ${esc(w.name)} (${esc(w.status)})`);
  if (c) chain.push(`${esc(c.engine)}: ${esc(c.name)} (${esc(c.state)})`);
  if (L.compose_project) chain.push(`compose ${esc(L.compose_project)}/${esc(L.compose_service || "")}`);
  chain.push(`<b>${esc(a.name)}</b>`);
  const eps = [...a.endpoints].sort((x, y) => (x.kind === "domain" ? 0 : 1) - (y.kind === "domain" ? 0 : 1));
  const deps = [...(a.dependencies || []), ...(a.override?.dependencies_user || [])].map((dep) => {
    const t = S.appMap.get(dep); return t ? `<a href="#" data-details="${esc(t.id)}">${esc(t.name)}</a>` : `<span class="mono">${esc(dep)}</span>`;
  });
  const rt = a.runtime || {};
  const el = document.createElement("div");
  el.id = "drawer";
  el.innerHTML = `<div class="scrim" data-close></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(a.name)} details">
    <div class="drawer-h">${icon(a)}<div style="flex:1;min-width:0"><h2>${esc(a.name)}</h2><div class="muted small">${esc(a.purpose || "")}${a.discovered_name && a.discovered_name !== a.name ? ` · discovered as “${esc(a.discovered_name)}”` : ""}</div></div>
      <button class="star ${a._fav ? "on" : ""}" data-fav="${esc(a.id)}" aria-label="Favorite">${svg("star")}</button><button class="iconbtn" data-close aria-label="Close">${svg("x")}</button></div>
    <div class="row">${pill(a.status)}<span class="pill">${esc(a.category || "Other")}</span><span class="pill">${esc(TYPE_LABEL[appType(a)])}</span><span class="pill" title="Discovery confidence">Confidence: ${esc(a.confidence)}</span>${a.hidden ? '<span class="pill">Hidden</span>' : ""}</div>
    ${a.direct_ip_note ? `<div class="note warn" style="margin-top:12px">${esc(a.direct_ip_note)}</div>` : ""}
    <section><h3>Endpoints (${eps.length})</h3>${eps.length ? eps.map((e) => epBlock(a, e)).join("") : '<div class="muted">No web endpoints known. This may not be a web app, or its port has not been collected yet.</div>'}</section>
    <section><h3>Location</h3><div class="chain">${chain.map((x, i) => (i ? '<span class="sep">›</span>' : "") + `<span class="node">${x}</span>`).join("")}</div>
      <dl class="kv" style="margin-top:12px">
        <dt>Host IP</dt><dd class="mono">${esc(L.host_ip || "—")}</dd><dt>VLAN</dt><dd>${esc(a.vlan ?? "unknown")}</dd>
        ${c ? `<dt>Image</dt><dd class="mono">${esc(c.image)}</dd><dt>Ports</dt><dd class="mono">${esc(c.ports.map((p) => `${p.host_port}→${p.container_port}/${p.proto}`).join(", ") || "none published")}</dd>` : ""}
        ${rt.state ? `<dt>Runtime</dt><dd>${esc(rt.state)}${rt.status ? " · " + esc(rt.status) : ""}${rt.restarts ? ` · ${esc(rt.restarts)} restarts` : ""}</dd>` : ""}
        ${rt.version ? `<dt>Version</dt><dd>${esc(rt.version)}${rt.update ? ` <span class="pill medium">update ${esc(rt.update)}</span>` : ""}</dd>` : ""}
        ${a.access || a.override?.access ? `<dt>Access</dt><dd>${esc(a.override?.access || a.access)}</dd>` : `<dt>Access</dt><dd>Local network (external access not tested)</dd>`}
      </dl></section>
    ${deps.length ? `<section><h3>Depends on</h3><div class="row">${deps.join(" · ")}</div></section>` : ""}
    ${(a.mgmt_links || []).length ? `<section><h3>Management</h3><div class="row">${a.mgmt_links.map((m) => `<a class="btn sm" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">${svg("ext")}${esc(m.label)}</a>`).join("")}</div></section>` : ""}
    ${(a.notes || []).length || a.notes_user ? `<section><h3>Notes</h3>${a.notes_user ? `<p style="white-space:pre-wrap">${esc(a.notes_user)}</p>` : ""}${(a.notes || []).map((x) => `<p class="small muted">${esc(x)}</p>`).join("")}</section>` : ""}
    <section><h3>Evidence</h3><ul class="small" style="margin:0;padding-left:18px">${(a.sources || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ul><div class="tiny muted" style="margin-top:6px">ID <span class="mono">${esc(a.id)}</span></div></section>
    <section id="diagOut"></section>
    ${S.me.admin ? `<section><h3>Edit</h3>${editForm(a)}</section>` : `<section><a class="small" href="#/admin">Log in as admin to edit this entry</a></section>`}
  </aside>`;
  document.body.appendChild(el);
  $$("[data-close]", el).forEach((b) => b.addEventListener("click", closeDetails));
  el.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDetails(); });
  $$("[data-copy]", el).forEach((b) => b.addEventListener("click", () => copy(b.dataset.copy)));
  $$("[data-diag]", el).forEach((b) => b.addEventListener("click", () => runDiag(b.dataset.diag, $("#diagOut", el))));
  $$("[data-pref]", el).forEach((b) => b.addEventListener("click", () => saveOverride(a.id, { preferred_url: b.dataset.pref })));
  wireCards(el);
  wireEditForm(el, a);
  showLastDiag();
  if (!renderDrawer._quiet) $(".iconbtn[data-close]", el).focus();
}
function editForm(a) {
  const o = a.override || {};
  const opts = (sel, vals) => vals.map((v) => `<option ${sel === v ? "selected" : ""}>${esc(v)}</option>`).join("");
  return `<form class="grid-form" id="editForm">
    <label class="f">Name<input class="inp" name="name" value="${esc(o.name || "")}" placeholder="${esc(a.discovered_name || a.name)}"></label>
    <label class="f">Category<input class="inp" name="category" list="cats" value="${esc(o.category || "")}" placeholder="${esc(a.category || "")}"><datalist id="cats">${(S.inv.settings_public?.categories_order || []).map((c) => `<option>${esc(c)}</option>`).join("")}</datalist></label>
    <label class="f">Icon (slug, URL or emoji)<input class="inp" name="icon" value="${esc(o.icon || "")}" placeholder="${esc(a.icon || "")}"></label>
    <label class="f">Order (lower first)<input class="inp" name="order" type="number" value="${esc(o.order ?? "")}"></label>
    <label class="f">Preferred URL<select class="sel" name="preferred_url"><option value="">Automatic</option>${a.endpoints.map((e) => `<option value="${esc(e.url)}" ${o.preferred_url === e.url || o.preferred_url === e.id ? "selected" : ""}>${esc(e.url)}</option>`).join("")}</select></label>
    <label class="f">Access<select class="sel" name="access"><option value="">Not set</option>${opts(o.access, ["lan", "vpn", "external"])}</select></label>
    <label class="f" style="grid-column:1/-1">Extra URLs (one per line)<textarea class="inp" name="extra_endpoints" placeholder="https://…">${esc((o.extra_endpoints || []).join("\n"))}</textarea></label>
    <label class="f" style="grid-column:1/-1">Your notes<textarea class="inp" name="notes_user">${esc(o.notes_user || "")}</textarea></label>
    <div class="row" style="grid-column:1/-1">
      <label class="switch"><input type="checkbox" name="hidden" ${a.hidden ? "checked" : ""}>Hidden from dashboard</label>
      <label class="switch"><input type="checkbox" name="disabled" ${o.disabled ? "checked" : ""}>Intentionally disabled</label>
      <label class="switch"><input type="checkbox" name="check_disabled" ${o.check_disabled ? "checked" : ""}>No health checks</label>
    </div>
    <div class="row" style="grid-column:1/-1"><button class="btn primary" type="submit">Save</button>${Object.keys(o).length ? '<button class="btn danger" type="button" id="resetOv">Reset to discovered</button>' : ""}
      <span class="tiny muted">Edits are stored separately and survive rediscovery. Hiding never touches the real service.</span></div>
  </form>`;
}
function wireEditForm(el, a) {
  const f = $("#editForm", el); if (!f) return;
  f.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(f), p = {};
    for (const k of ["name", "category", "icon", "order", "preferred_url", "access", "notes_user"]) p[k] = fd.get(k) || null;
    p.order = p.order === null ? null : +p.order;
    const extra = (fd.get("extra_endpoints") || "").split("\n").map((s) => s.trim()).filter(Boolean);
    p.extra_endpoints = extra.length ? extra : null;
    for (const k of ["hidden", "disabled", "check_disabled"]) p[k] = fd.get(k) === "on";
    if (!p.hidden && !a.default_hidden) p.hidden = null; // don't store a redundant "false"
    if (!p.disabled) p.disabled = null;
    if (!p.check_disabled) p.check_disabled = null;
    saveOverride(a.id, p);
  });
  const r = $("#resetOv", el);
  if (r) r.addEventListener("click", async () => {
    if (!confirm("Remove all your edits for this entry? Discovered data stays.")) return;
    await api("/api/admin/override/" + encodeURIComponent(a.id), { method: "DELETE" }); toast("Reset"); await refresh();
  });
}
async function saveOverride(id, patch) {
  try { await api("/api/admin/override/" + encodeURIComponent(id), { method: "PUT", body: patch }); toast("Saved"); await refresh(); }
  catch (e) { toast("Not saved: " + e.message); }
}

// ------------------------------------------------------------------ diagnostics
async function runDiag(epId, out) {
  out.innerHTML = `<h3>Diagnostics</h3><div class="muted">Running DNS → TCP → TLS → HTTP…</div>`;
  out.scrollIntoView({ behavior: "smooth", block: "nearest" });
  let html;
  try {
    const r = await api("/api/diagnose", { method: "POST", body: { endpoint_id: epId } });
    html = `<h3>Diagnostics · <span class="mono small">${esc(r.endpoint?.url || "")}</span></h3>${diagSteps(r)}`;
  } catch (e) { html = `<h3>Diagnostics</h3><div class="note warn">${esc(e.message)}</div>`; }
  S.lastDiag = { app: S.sel, html };
  out.innerHTML = html;
  await refresh(true); // re-render keeps S.lastDiag visible
  showLastDiag();
}
function showLastDiag() {
  if (!S.lastDiag) return;
  const t = S.sel ? (S.lastDiag.app === S.sel ? $("#diagOut") : null) : $("#diagPanel");
  if (t) t.innerHTML = S.lastDiag.html;
}
function diagSteps(r) {
  const st = (ok, txt) => `${pill(ok === true ? "up" : ok === false ? "down" : "unverified", true)}${txt ? "" : ""}`;
  const d = r.dns || {}, t = r.tcp || {}, s = r.tls, h = r.http;
  const row = (k, ok, body) => `<div class="step"><div class="k">${k} ${st(ok)}</div><pre>${esc(body)}</pre></div>`;
  return `<div class="steps">
    <div class="note">${pill(r.status)} <b>${esc(r.summary || "")}</b><br><span class="tiny">From ${esc(r.collector)} at ${esc(fmtTime(r.at))}</span>${r.hypothesis ? `<div class="hyp">Hypothesis: ${esc(r.hypothesis)}</div>` : ""}</div>
    ${row("DNS", d.ok, d.skipped ? "IP address — no lookup needed" : d.ok ? (d.addresses || []).join(", ") : d.error || "")}
    ${row("TCP", t.ok, t.ok ? `connected to ${r.ip}:${r.endpoint?.url?.match(/:(\d+)/)?.[1] || (r.endpoint?.url?.startsWith("https") ? 443 : 80)} in ${t.ms} ms` : `${t.result || "not tried"}${t.result === "timeout" ? " — no answer; usually a firewall between VLANs" : t.result === "refused" ? " — host is up, nothing listening" : ""}`)}
    ${s ? row("TLS", s.ok && s.verified !== false, s.ok ? `${s.verified ? "trusted" : "NOT trusted: " + (s.verify_error || "")}\nsubject ${JSON.stringify(s.subject || {})}\nissuer ${s.issuer || "?"}\nexpires ${s.expires || "?"} (${s.days_left ?? "?"} days)\nSAN ${(s.san || []).join(", ")}` : s.error || "") : ""}
    ${h ? row("HTTP", h.ok && h.code < 500, h.ok ? `HTTP ${h.code}${h.location ? " → " + h.location : ""}\nserver ${h.server || "?"} · ${h.ms} ms${h.title ? "\ntitle " + h.title : ""}${h.cached ? "\n(cached result)" : ""}` : h.result + " " + (h.error || "")) : t.ok ? row("HTTP", null, "not requested") : ""}
    ${r.proxy_tcp ? row("Proxy", r.proxy_tcp.ok, `reverse proxy :443 ${r.proxy_tcp.ok ? "reachable" : r.proxy_tcp.result}`) : ""}
  </div>`;
}
function vDiag(params) {
  const all = [];
  for (const a of S.inv.apps) for (const e of a.endpoints) all.push({ a, e });
  const q = (params.get("q") || "").toLowerCase();
  const list = all.filter(({ a, e }) => !q || (a.name + " " + e.url).toLowerCase().includes(q));
  const counts = all.reduce((m, { e }) => ((m[e.health || "unchecked"] = (m[e.health || "unchecked"] || 0) + 1), m), {});
  return `<div class="page-head"><div><h1>Diagnostics</h1><p>Read-only checks from <span class="mono">${esc(S.inv.collector)}</span>. Last scheduled run ${esc(ago(S.inv.engine?.checks?.last))} (${esc(S.inv.engine?.checks?.count ?? 0)} endpoints, every ${esc(S.inv.settings_public?.check_interval_min)} min).</p></div></div>
  <div class="note sec">Only endpoints already in the inventory can be tested. Each check is one DNS lookup, one TCP connect, one TLS handshake and at most one unauthenticated GET. No passwords are sent. Management UIs are probed over HTTP at most every 6 hours (on demand: every 5 minutes).</div>
  <div class="row sec">${Object.entries(counts).map(([k, v]) => `${pill(k === "unchecked" ? "unverified" : k, true)} <span class="small">${v}</span>`).join(" &nbsp; ")}</div>
  <div class="row sec"><input class="inp" id="dq" placeholder="Filter endpoints" value="${esc(q)}" style="flex:1;max-width:380px"></div>
  <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>App</th><th>Endpoint</th><th>Health</th><th class="hide-m">Detail</th><th class="hide-m">TLS</th><th class="hide-m">Checked</th><th></th></tr></thead><tbody>
  ${list.map(({ a, e }) => `<tr><td>${esc(a.name)}</td><td class="mono">${esc(e.url)}</td><td>${pill(e.health || "unverified", true)}</td><td class="hide-m small">${esc(e.health_summary || "")}</td>
    <td class="hide-m small">${e.tls?.days_left != null ? esc(e.tls.days_left + " d") : "—"}</td><td class="hide-m small">${esc(ago(e.checked_at))}</td>
    <td><button class="btn sm" data-diag2="${esc(e.id)}" data-app2="${esc(a.id)}">Run</button></td></tr>`).join("")}
  </tbody></table></div><div id="diagPanel" class="sec" style="margin-top:16px"></div>`;
}

// ------------------------------------------------------------------ network (DNS & proxy)
function vNetwork(params) {
  const inv = S.inv, q = (params.get("q") || "").toLowerCase();
  const apps = inv.apps;
  const appFor = (name) => apps.find((a) => a.endpoints.some((e) => e.host === name));
  const doms = inv.domains.filter((d) => !q || d.name.includes(q)).sort((a, b) => (a.kind === "dhcp-hostname") - (b.kind === "dhcp-hostname") || a.name.localeCompare(b.name));
  const issuesFor = (name) => inv.issues.filter((i) => i.ref === "dns:" + name);
  const domRows = doms.map((d) => {
    const a = appFor(d.name), ep = a && a.endpoints.find((e) => e.host === d.name);
    const tgt = (d.targets || []).map((t) => { const dev = S.devById.get(t.device); return dev ? `${dev.name || dev.hostname || ""}` : ""; }).filter(Boolean).join(", ");
    const iss = issuesFor(d.name);
    return `<tr class="${a ? "click" : ""}" ${a ? `data-app-row="${esc(a.id)}"` : ""}><td class="mono">${esc(d.name)}${d.kind === "dhcp-hostname" ? ' <span class="pill">DHCP name</span>' : ""}</td>
      <td class="mono">${esc((d.addresses || []).join(", ") || d.error || "")}${tgt ? `<div class="tiny muted">${esc(tgt)}</div>` : ""}</td>
      <td>${ep?.proxy ? esc(ep.proxy) : d.note ? '<span class="small">Caddy (route not collected)</span>' : '<span class="muted small">direct</span>'}</td>
      <td class="mono small">${esc(ep?.upstream || "—")}</td><td>${a ? esc(a.name) : '<span class="muted">—</span>'}</td>
      <td>${ep?.health ? pill(ep.health, true) : d.ok ? pill("unverified", true) : pill("dns-fail", true)}${iss.map((i) => " " + pill(i.severity, true, i.title)).join("")}</td></tr>`;
  }).join("");
  const routes = inv.routes.map((r) => {
    const a = S.appMap.get(r.app_id || r.upstream_app);
    return `<tr><td class="mono">${esc((r.hosts || []).join(", "))}</td><td class="mono">${esc((r.paths || []).join(", "))}</td><td>${esc(r.proxy)}<div class="tiny muted">${esc(r.proxy_label || "")} ${esc(r.proxy_ip || "")}</div></td>
      <td class="mono">${esc(r.action === "redirect" ? "→ " + r.target : (r.upstreams || []).join(", "))}</td><td>${a ? esc(a.name) : "—"}</td><td>${pill(r.upstream_status === "matched" ? "verified" : r.action === "redirect" ? "configured" : "unverified", true, r.upstream_status)}</td></tr>`;
  }).join("");
  const nets = inv.networks.map((n) => {
    const devs = inv.devices.filter((d) => d.vlan == n.vlan || (d.ip && n.subnet && ipIn(d.ip, n.subnet)));
    return `<tr><td>${esc(n.vlan ?? "—")}</td><td>${esc(n.name || "")}</td><td class="mono">${esc(n.subnet)}</td><td>${devs.length} <span class="muted small">(${devs.filter((d) => d.online).length} online)</span></td><td class="tiny muted">${esc(n.source || "")}</td></tr>`;
  }).join("");
  const unifiDns = inv.unifi_dns;
  return `<div class="page-head"><div><h1>DNS &amp; reverse proxy</h1><p>Domain → DNS → proxy → upstream → app. A DNS name alone is not proof a website exists.</p></div></div>
  <section class="card sec"><div class="sec-h"><h2>Domains</h2><span class="muted small">${doms.length} names · resolved by ${esc(inv.collector)}</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Domain</th><th>Resolves to</th><th>Proxy</th><th>Upstream</th><th>App</th><th>Status</th></tr></thead><tbody>${domRows || '<tr><td colspan="6" class="empty">No domains.</td></tr>'}</tbody></table></div></section>
  <section class="card sec"><div class="sec-h"><h2>Proxy routes</h2><span class="muted small">${inv.routes.length} from collected Caddy/Nginx/Traefik config</span></div>
    ${inv.routes.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Host</th><th>Path</th><th>Proxy</th><th>Upstream</th><th>App</th><th>Backend</th></tr></thead><tbody>${routes}</tbody></table></div>`
      : `<div class="pad"><div class="note warn">No proxy configuration collected yet. Caddy runs at <span class="mono">50.50.50.10</span> (UniFi client “Caddy-Proxy”) and <span class="mono">proxy.safrani.co</span>, <span class="mono">plex.safrani.co</span> and <span class="mono">idrac.safrani.co</span> point at it. Run <span class="mono">collect-guest.sh</span> on that host to map routes to backends.</div></div>`}</section>
  ${unifiDns ? `<section class="card sec"><div class="sec-h"><h2>UniFi local DNS records</h2></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Type</th><th>Value</th><th>Enabled</th></tr></thead><tbody>${unifiDns.map((r) => `<tr><td class="mono">${esc(r.name)}</td><td>${esc(r.type)}</td><td class="mono">${esc(r.value)}</td><td>${r.enabled ? "yes" : "no"}</td></tr>`).join("")}</tbody></table></div></section>` : ""}
  <section class="card sec"><div class="sec-h"><h2>Networks / VLANs</h2></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>VLAN</th><th>Name</th><th>Subnet</th><th>Devices</th><th>Source</th></tr></thead><tbody>${nets}</tbody></table></div></section>`;
}
function ipIn(ip, cidr) {
  const [net, bits] = cidr.split("/"), toN = (s) => s.split(".").reduce((a, o) => (a << 8) + +o, 0) >>> 0;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
  const mask = bits === "0" ? 0 : (~0 << (32 - +bits)) >>> 0;
  return (toN(ip) & mask) === (toN(net) & mask);
}

// ------------------------------------------------------------------ devices
function vDevices(params) {
  const inv = S.inv, q = (params.get("q") || S.devQ || "").toLowerCase();
  const f = S.devF || "all";
  const roles = [...new Set(inv.devices.map((d) => d.role || "unknown"))].sort();
  const list = inv.devices.filter((d) => (f === "all" || (f === "online" ? d.online : f === "offline" ? !d.online : d.role === f))
    && (!q || [d.name, d.hostname, d.ip, d.mac, d.vendor].some((x) => x && String(x).toLowerCase().includes(q))))
    .sort((a, b) => ipSort(a.ip) - ipSort(b.ip));
  return `<div class="page-head"><div><h1>Devices</h1><p>${inv.devices.length} UniFi clients and standalone devices. Offline means “previously seen”, as reported by UniFi.</p></div></div>
  <div class="row sec"><input class="inp" id="devq" placeholder="Filter by name, IP, MAC, vendor" value="${esc(q)}" style="flex:1;max-width:380px">
    <select class="sel" id="devf"><option value="all">All</option><option value="online" ${f === "online" ? "selected" : ""}>Online</option><option value="offline" ${f === "offline" ? "selected" : ""}>Offline / previously seen</option>${roles.map((r) => `<option ${f === r ? "selected" : ""}>${esc(r)}</option>`).join("")}</select>
    <span class="muted small">${list.length} shown</span></div>
  <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>IP</th><th>VLAN</th><th class="hide-m">Role</th><th class="hide-m">Vendor</th><th class="hide-m">MAC</th><th>State</th><th class="hide-m">Last change</th></tr></thead><tbody>
  ${list.map((d) => `<tr><td>${esc(d.name || d.hostname || "(unnamed)")}${d.manual ? ' <span class="pill">manual</span>' : ""}${d.workload_id ? ` <span class="pill info">${esc((S.wlById.get(d.workload_id) || {}).kind || "guest")}</span>` : ""}</td><td class="mono">${esc(d.ip || "—")}</td><td>${esc(d.vlan ?? "—")}</td>
    <td class="hide-m">${esc(d.role || "")}</td><td class="hide-m small">${esc(d.vendor || "")}</td><td class="hide-m mono small">${esc(d.mac || "")}</td>
    <td>${pill(d.online ? "online" : d.online === false ? "offline" : "unknown", true)}</td><td class="hide-m small">${esc(d.last_changed ? ago(d.last_changed) : "—")}</td></tr>`).join("")}
  </tbody></table></div>`;
}
const ipSort = (ip) => (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip) ? ip.split(".").reduce((a, o) => a * 256 + +o, 0) : 9e12);

// ------------------------------------------------------------------ digest
async function vDigest(params) {
  const id = params.get("id");
  const [d, list] = await Promise.all([api("/api/digest" + (id ? "?id=" + encodeURIComponent(id) : "")), api("/api/digests")]);
  const sec = (title, items, fn, emptyTxt) => `<section class="card sec"><div class="sec-h"><h2>${title}</h2><span class="muted small">${items.length}</span></div><div class="list">${items.length ? items.map(fn).join("") : `<div class="empty small">${emptyTxt}</div>`}</div></section>`;
  const ch = (c) => `<div class="issue">${pill(c.severity)}<div class="t">${esc(c.title)}</div>${c.hypothesis || c.detail?.hypothesis ? `<div class="ev hyp">Hypothesis: ${esc(c.hypothesis || c.detail.hypothesis)}</div>` : ""}</div>`;
  const ev = (e) => `<div class="issue">${pill(e.type === "health-recovered" ? "up" : "down", true)}<div class="t">${esc(e.title)} <span class="muted small">${esc(fmtTime(e.at))}</span></div>${e.detail?.summary ? `<div class="ev">${esc(e.detail.summary)}${e.detail.hypothesis ? `<div class="hyp">Hypothesis: ${esc(e.detail.hypothesis)}</div>` : ""}</div>` : ""}</div>`;
  const act = (a) => `<div class="issue">${pill(a.severity)}<div class="t">${esc(a.title)}</div><div class="ev">${(a.evidence || []).length ? `<ul>${a.evidence.slice(0, 5).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}${a.next_step ? `<b>Next step:</b> ${esc(a.next_step)}` : ""}${a.hypothesis ? `<div class="hyp">Hypothesis (unconfirmed): ${esc(a.hypothesis)}</div>` : ""}</div></div>`;
  const head = `<div class="page-head"><div><h1>Digest</h1><p>${d ? `${esc(d.kind)} digest · ${esc(fmtTime(d.generated_at))} · last ${esc(d.window_hours)} h` : "No digest yet."}</p></div>
    <div class="row">${S.me.admin ? `<button class="btn primary" id="genDigest">${svg("refresh")}Generate now</button>` : '<span class="muted small">Daily digest runs automatically; admins can generate one now.</span>'}
    ${list.length ? `<select class="sel" id="digPick" aria-label="Past digests">${list.map((x) => `<option value="${x.id}" ${d && d.id === x.id ? "selected" : ""}>${esc(fmtTime(x.at))} · ${esc(x.kind)}</option>`).join("")}</select>` : ""}</div></div>`;
  if (!d) return head + `<div class="card empty">The first digest is created after discovery and checks have run.</div>`;
  return head + `<div class="card pad sec"><div style="font-size:18px;font-weight:650">${esc(d.headline)}</div>
    ${d.baseline_note ? `<div class="note" style="margin-top:10px">${esc(d.baseline_note)}</div>` : `<div class="small muted" style="margin-top:6px">Compared ${esc(fmtTime(d.compared.base))} → ${esc(fmtTime(d.compared.current))}</div>`}</div>
  ${sec("Prioritized actions", d.actions, act, "No actions.")}
  <div class="cols"><div>
    ${sec("Changes", d.changes, ch, d.baseline_note ? "Baseline: no earlier snapshot to compare." : "No changes detected.")}
    ${sec("Went down", d.health_down, ev, "No endpoint went down in this window.")}
    ${sec("Recovered", d.health_recovered, ev, "No recoveries in this window.")}
  </div><div>
    ${sec("Certificates nearing expiry", d.certificates, (i) => `<div class="issue">${pill(i.severity)}<div class="t">${esc(i.title)}</div></div>`, "None within the warning window.")}
    ${sec("Broken links", d.broken_links, (i) => `<div class="issue">${pill(i.severity)}<div class="t">${esc(i.title)}</div></div>`, "None.")}
    ${sec("Stale or suspicious entries", d.stale, (i) => `<div class="issue">${pill(i.severity)}<div class="t">${esc(i.title)}</div>${i.hypothesis ? `<div class="ev hyp">Hypothesis: ${esc(i.hypothesis)}</div>` : ""}</div>`, "None.")}
    ${sec("Stopped workloads", d.stopped, (i) => `<div class="issue">${pill(i.severity)}<div class="t">${esc(i.title)}</div></div>`, "None known (Proxmox not collected yet if this stays empty).")}
    ${d.orphan_overrides.length ? sec("Edits for entries no longer discovered", d.orphan_overrides, (k) => `<div class="issue">${pill("low")}<div class="t mono">${esc(k)}</div></div>`, "") : ""}
  </div></div>`;
}

// ------------------------------------------------------------------ admin
async function vAdmin() {
  if (!S.me.admin) {
    return `<div class="card pad login"><h1 style="margin-bottom:6px">Admin</h1><p class="muted small" style="margin-top:0">Editing entries, settings and imports needs the admin password.</p>
      ${S.me.password_set ? "" : `<div class="note warn">No admin password set yet. On the dashboard host run:<br><span class="mono">python3 -m server.app --set-password</span></div>`}
      <form id="loginForm" class="grid-form" style="grid-template-columns:1fr;margin-top:12px">
        <label class="f">Username<input class="inp" name="username" autocomplete="username" value="admin" required></label>
        <label class="f">Password<input class="inp" name="password" type="password" autocomplete="current-password" required></label>
        <button class="btn primary" type="submit">Log in</button><div id="loginErr" class="small" style="color:var(--crit-ink)"></div></form></div>`;
  }
  const tabs = [["entries", "Entries"], ["manual", "Add & manual"], ["favorites", "Favorites"], ["settings", "Settings"], ["data", "Import / export"]];
  const t = S.adminTab;
  let body = "";
  if (t === "entries") {
    const apps = S.inv.apps;
    body = `<div class="row sec"><input class="inp" id="admq" placeholder="Filter entries" value="${esc(S.admQ || "")}" style="flex:1;max-width:360px"><span class="muted small">Changes save per row. Discovered values are shown as placeholders.</span></div>
    <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>Entry</th><th>Name</th><th>Category</th><th>Icon</th><th>Order</th><th>Preferred URL</th><th>Show</th><th>Disabled</th><th></th></tr></thead><tbody>
    ${apps.filter((a) => !S.admQ || (a.name + a.id + (a.discovered_name || "")).toLowerCase().includes(S.admQ.toLowerCase())).map((a) => {
      const o = a.override || {};
      return `<tr class="adm-row" data-id="${esc(a.id)}"><td style="min-width:170px">${icon(a, "sm")} <a href="#" data-details="${esc(a.id)}">${esc(a.discovered_name || a.name)}</a><div class="tiny muted mono">${esc(a.id)}</div></td>
        <td><input class="inp" data-k="name" value="${esc(o.name || "")}" placeholder="${esc(a.discovered_name || "")}"></td>
        <td><input class="inp" data-k="category" value="${esc(o.category || "")}" placeholder="${esc(a.category || "")}" list="cats2"></td>
        <td><input class="inp" data-k="icon" value="${esc(o.icon || "")}" placeholder="${esc(a.icon || "")}"></td>
        <td><input class="inp" data-k="order" type="number" value="${esc(o.order ?? "")}" style="width:70px"></td>
        <td><select class="sel" data-k="preferred_url"><option value="">Auto</option>${a.endpoints.map((e) => `<option value="${esc(e.url)}" ${o.preferred_url === e.url ? "selected" : ""}>${esc(e.url)}</option>`).join("")}</select></td>
        <td><label class="switch"><input type="checkbox" data-k="visible" ${a.hidden ? "" : "checked"}></label></td>
        <td><label class="switch"><input type="checkbox" data-k="disabled" ${o.disabled ? "checked" : ""}></label></td>
        <td>${Object.keys(o).length ? `<button class="btn sm danger" data-reset="${esc(a.id)}" title="Remove your edits">Reset</button>` : ""}${a.manual ? ` <button class="btn sm danger" data-delmanual="${esc(a.id)}">Delete</button>` : ""}</td></tr>`;
    }).join("")}</tbody></table><datalist id="cats2">${(S.inv.settings_public?.categories_order || []).map((c) => `<option>${esc(c)}</option>`).join("")}</datalist></div>
    ${S.inv.orphan_overrides?.length ? `<div class="card pad sec" style="margin-top:16px"><h2>Edits for entries not currently discovered</h2><p class="small muted">Kept in case the entry comes back (for example after a collector run).</p>${S.inv.orphan_overrides.map((k) => `<div class="row"><span class="mono small">${esc(k)}</span><button class="btn sm danger" data-reset="${esc(k)}">Delete edit</button></div>`).join("")}</div>` : ""}`;
  } else if (t === "manual") {
    const man = S.inv.apps.filter((a) => a.manual);
    const mdev = S.inv.devices.filter((d) => d.manual);
    body = `<div class="cols"><form class="card pad" id="manApp"><h2 style="margin-bottom:12px">Add an application</h2><div class="grid-form">
        <label class="f">Name<input class="inp" name="name" required></label><label class="f">Category<input class="inp" name="category" list="cats3"><datalist id="cats3">${(S.inv.settings_public?.categories_order || []).map((c) => `<option>${esc(c)}</option>`).join("")}</datalist></label>
        <label class="f">Icon<input class="inp" name="icon" placeholder="e.g. grafana"></label><label class="f">Host / location<input class="inp" name="location"></label>
        <label class="f">IP<input class="inp" name="ip"></label><label class="f">Purpose<input class="inp" name="purpose"></label>
        <label class="f" style="grid-column:1/-1">URLs (one per line)<textarea class="inp" name="urls" placeholder="https://app.safrani.co/&#10;http://10.10.30.30:3000/"></textarea></label>
        <label class="f" style="grid-column:1/-1">Notes<textarea class="inp" name="notes"></textarea></label></div>
        <div class="row" style="margin-top:10px"><button class="btn primary">Add application</button></div></form>
      <form class="card pad" id="manDev"><h2 style="margin-bottom:12px">Add a device</h2><div class="grid-form">
        <label class="f">Name<input class="inp" name="name" required></label><label class="f">IP<input class="inp" name="ip"></label><label class="f">MAC<input class="inp" name="mac"></label>
        <label class="f">VLAN<input class="inp" name="vlan"></label><label class="f">Role<input class="inp" name="role" placeholder="server, raspberry-pi, nas…"></label><label class="f">Vendor<input class="inp" name="vendor"></label>
        <label class="f" style="grid-column:1/-1">Notes<textarea class="inp" name="notes"></textarea></label></div>
        <div class="row" style="margin-top:10px"><button class="btn primary">Add device</button></div></form></div>
      <section class="card sec" style="margin-top:16px"><div class="sec-h"><h2>Manual entries</h2></div><div class="list">
      ${[...man.map((a) => ["app", a.id, a.name, a.endpoints.map((e) => e.url).join(", ")]), ...mdev.map((d) => ["device", d.id, d.name, d.ip || ""])].map(([k, id, nm, sub]) => `<div class="hostrow"><span class="pill">${k}</span><div style="flex:1"><b>${esc(nm)}</b> <span class="small muted mono">${esc(sub)}</span></div><button class="btn sm danger" data-delmanual="${esc(id)}">Delete</button></div>`).join("") || '<div class="empty small">None yet.</div>'}</div></section>`;
  } else if (t === "favorites") {
    const favs = S.favs.map((id) => S.appMap.get(id)).filter(Boolean);
    body = `<section class="card"><div class="sec-h"><h2>Favorites</h2><span class="muted small">Order shown on the overview</span></div><div class="list">
      ${favs.map((a, i) => `<div class="hostrow">${icon(a, "sm")}<div style="flex:1">${esc(a.name)}</div><button class="btn sm" data-fmove="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button><button class="btn sm" data-fmove="${i}" data-dir="1" ${i === favs.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button><button class="btn sm danger" data-fav="${esc(a.id)}">Remove</button></div>`).join("") || '<div class="empty small">No favorites. Use the star on any app.</div>'}</div></section>`;
  } else if (t === "settings") {
    const s = await api("/api/admin/settings");
    body = `<form class="card pad" id="setForm"><div class="grid-form">
      <label class="f">Discovery interval (minutes)<input class="inp" type="number" min="5" max="1440" name="discovery_interval_min" value="${esc(s.discovery_interval_min)}"></label>
      <label class="f">Health-check interval (minutes, ≥ 2)<input class="inp" type="number" min="2" max="1440" name="check_interval_min" value="${esc(s.check_interval_min)}"></label>
      <label class="f">Daily digest hour (local, 0–23)<input class="inp" type="number" min="0" max="23" name="digest_hour_local" value="${esc(s.digest_hour_local)}"></label>
      <label class="f">Certificate warning (days)<input class="inp" type="number" min="1" max="90" name="cert_warn_days" value="${esc(s.cert_warn_days)}"></label>
      <label class="f">Default link mode<select class="sel" name="default_access_mode"><option value="domain" ${s.default_access_mode === "domain" ? "selected" : ""}>Domain</option><option value="ip" ${s.default_access_mode === "ip" ? "selected" : ""}>Direct IP</option></select></label>
      <label class="f">Check history (days)<input class="inp" type="number" min="1" max="365" name="check_history_days" value="${esc(s.check_history_days)}"></label>
      <label class="f" style="grid-column:1/-1">Category order (comma separated)<input class="inp" name="categories_order" value="${esc(s.categories_order.join(", "))}"></label>
      <div class="row" style="grid-column:1/-1"><label class="switch"><input type="checkbox" name="digest_enabled" ${s.digest_enabled ? "checked" : ""}>Daily digest</label>
        <label class="switch"><input type="checkbox" name="require_login_for_view" ${s.require_login_for_view ? "checked" : ""}>Require login to view the dashboard</label></div></div>
      <div class="row" style="margin-top:12px"><button class="btn primary">Save settings</button></div></form>
      <div class="card pad sec" style="margin-top:16px"><h2 style="margin-bottom:8px">Run now</h2><div class="row"><button class="btn" id="runDisc">${svg("refresh")}Rediscover</button><button class="btn" id="runCheck">${svg("pulse")}Run health checks</button></div>
      <p class="small muted">Discovery: last ${esc(ago(S.inv.engine?.discovery?.last || S.inv.generated_at))}${S.inv.engine?.discovery?.error ? ` · <span style="color:var(--crit-ink)">error ${esc(S.inv.engine.discovery.error)}</span>` : ""}. Checks: last ${esc(ago(S.inv.engine?.checks?.last))}.</p></div>`;
  } else if (t === "data") {
    body = `<div class="cols"><div class="card pad"><h2 style="margin-bottom:8px">Export</h2>
        <div class="row"><a class="btn" href="/api/admin/export">Dashboard config (edits, manual entries, settings)</a></div>
        <div class="row" style="margin-top:8px"><a class="btn" href="/api/export/inventory.json">Inventory JSON</a><a class="btn" href="/api/export/inventory.csv">Inventory CSV</a></div>
        <p class="small muted">Exports never contain the Home Assistant token, the admin password or session data.</p></div>
      <div class="card pad"><h2 style="margin-bottom:8px">Import dashboard config</h2><input type="file" id="impFile" accept="application/json,.json">
        <div class="row" style="margin-top:8px"><label class="switch"><input type="radio" name="impMode" value="merge" checked>Merge</label><label class="switch"><input type="radio" name="impMode" value="replace">Replace edits</label><button class="btn primary" id="impBtn">Import</button></div></div></div>
      <div class="card pad sec" style="margin-top:16px"><h2 style="margin-bottom:8px">Upload collector results</h2><p class="small muted" style="margin-top:0">The <span class="mono">.tar.gz</span> files produced by the scripts in <span class="mono">collectors/dist/</span>. Rediscovery starts automatically.</p>
        <input type="file" id="tgzFile" accept=".gz,application/gzip" multiple> <button class="btn primary" id="tgzBtn">Upload</button><div id="tgzOut" class="small" style="margin-top:8px"></div></div>`;
  }
  return `<div class="page-head"><div><h1>Admin</h1><p>Edit what the dashboard shows. Nothing here changes your servers, DNS or proxies.</p></div><button class="btn" id="logout">Log out</button></div>
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${t === k}" class="${t === k ? "on" : ""}" data-tab="${k}">${l}</button>`).join("")}</div>${body}`;
}
function wireAdmin() {
  const lf = $("#loginForm");
  if (lf) lf.addEventListener("submit", async (e) => {
    e.preventDefault(); const fd = new FormData(lf);
    try { await api("/api/login", { method: "POST", body: { username: fd.get("username"), password: fd.get("password") } }); await refresh(); toast("Logged in"); }
    catch (err) { $("#loginErr").textContent = err.message; }
  });
  const lo = $("#logout"); if (lo) lo.addEventListener("click", async () => { await api("/api/logout", { method: "POST", body: {} }); await refresh(); });
  $$("[data-tab]").forEach((b) => b.addEventListener("click", () => { S.adminTab = b.dataset.tab; ls.set("adminTab", S.adminTab); render(); }));
  const aq = $("#admq"); if (aq) aq.addEventListener("input", () => { S.admQ = aq.value; const pos = aq.selectionStart; render().then(() => { const n = $("#admq"); n.focus(); n.setSelectionRange(pos, pos); }); });
  $$(".adm-row").forEach((row) => {
    const id = row.dataset.id, a = S.appMap.get(id);
    $$("[data-k]", row).forEach((inp) => inp.addEventListener("change", async () => {
      const k = inp.dataset.k; let v = inp.type === "checkbox" ? inp.checked : inp.value.trim();
      let patch;
      if (k === "visible") patch = { hidden: v ? (a.default_hidden ? false : null) : true };
      else if (k === "disabled") patch = { disabled: v || null };
      else if (k === "order") patch = { order: v === "" ? null : +v };
      else patch = { [k]: v || null };
      try { await api("/api/admin/override/" + encodeURIComponent(id), { method: "PUT", body: patch }); toast("Saved"); await refresh(true); }
      catch (e) { toast("Not saved: " + e.message); }
    }));
  });
  $$("[data-reset]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Remove your edits for this entry?")) return;
    await api("/api/admin/override/" + encodeURIComponent(b.dataset.reset), { method: "DELETE" }); toast("Reset"); await refresh();
  }));
  $$("[data-delmanual]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Delete this manual dashboard entry? (No real device or service is affected.)")) return;
    await api("/api/admin/manual/" + encodeURIComponent(b.dataset.delmanual), { method: "DELETE" }); toast("Deleted"); await refresh();
  }));
  const ma = $("#manApp"); if (ma) ma.addEventListener("submit", async (e) => {
    e.preventDefault(); const fd = Object.fromEntries(new FormData(ma));
    fd.urls = (fd.urls || "").split("\n").map((s) => s.trim()).filter(Boolean);
    for (const k of Object.keys(fd)) if (fd[k] === "" ) delete fd[k];
    try { await api("/api/admin/manual", { method: "POST", body: { kind: "app", ...fd } }); toast("Added"); ma.reset(); await refresh(); } catch (er) { toast(er.message); }
  });
  const md = $("#manDev"); if (md) md.addEventListener("submit", async (e) => {
    e.preventDefault(); const fd = Object.fromEntries(new FormData(md)); for (const k of Object.keys(fd)) if (fd[k] === "") delete fd[k];
    try { await api("/api/admin/manual", { method: "POST", body: { kind: "device", ...fd } }); toast("Added"); md.reset(); await refresh(); } catch (er) { toast(er.message); }
  });
  $$("[data-fmove]").forEach((b) => b.addEventListener("click", async () => {
    const favs = S.favs.filter((id) => S.appMap.get(id)), i = +b.dataset.fmove, j = i + +b.dataset.dir;
    [favs[i], favs[j]] = [favs[j], favs[i]]; S.favs = favs;
    await api("/api/prefs/favorites", { method: "PUT", body: { favorites: favs } }); render();
  }));
  const sf = $("#setForm"); if (sf) sf.addEventListener("submit", async (e) => {
    e.preventDefault(); const fd = new FormData(sf), p = {};
    for (const k of ["discovery_interval_min", "check_interval_min", "digest_hour_local", "cert_warn_days", "check_history_days"]) p[k] = +fd.get(k);
    p.default_access_mode = fd.get("default_access_mode");
    p.categories_order = fd.get("categories_order").split(",").map((s) => s.trim()).filter(Boolean);
    p.digest_enabled = fd.get("digest_enabled") === "on"; p.require_login_for_view = fd.get("require_login_for_view") === "on";
    try { await api("/api/admin/settings", { method: "PUT", body: p }); toast("Settings saved"); await refresh(); } catch (er) { toast(er.message); }
  });
  const rd = $("#runDisc"); if (rd) rd.addEventListener("click", async () => { await api("/api/admin/discover", { method: "POST", body: {} }); toast("Discovery started"); pollEngine("discovery"); });
  const ib = $("#impBtn"); if (ib) ib.addEventListener("click", async () => {
    const f = $("#impFile").files[0]; if (!f) return toast("Choose a file");
    try { const j = JSON.parse(await f.text()); j.mode = $('input[name="impMode"]:checked').value; const r = await api("/api/admin/import", { method: "POST", body: j }); toast(`Imported ${r.imported} items`); await refresh(); }
    catch (er) { toast("Import failed: " + er.message); }
  });
  const tb = $("#tgzBtn"); if (tb) tb.addEventListener("click", async () => {
    const files = [...$("#tgzFile").files]; if (!files.length) return toast("Choose collector files");
    const out = $("#tgzOut"); out.textContent = "";
    for (const f of files) {
      try { await api("/api/admin/upload?name=" + encodeURIComponent(f.name), { method: "POST", body: f, raw: true }); out.innerHTML += `✓ ${esc(f.name)}<br>`; }
      catch (er) { out.innerHTML += `✗ ${esc(f.name)}: ${esc(er.message)}<br>`; }
    }
    pollEngine("discovery");
  });
}
async function pollEngine(which) {
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const s = await api("/api/status");
    if (!s.engine[which].running) { await refresh(); toast(which === "discovery" ? "Discovery finished" : "Checks finished"); return; }
  }
}

// ------------------------------------------------------------------ router
async function render() {
  const [r, qs] = (location.hash.replace(/^#\/?/, "") || "overview").split("?");
  S.route = NAV.some((n) => n[0] === r) ? r : "overview";
  const params = new URLSearchParams(qs || "");
  let inner;
  try {
    inner = { overview: vOverview, apps: vApps, infra: vInfra, network: vNetwork, devices: vDevices, digest: vDigest, diag: vDiag, admin: vAdmin }[S.route](params);
    if (inner instanceof Promise) inner = await inner;
  } catch (e) { inner = `<div class="card pad note warn">Could not render: ${esc(e.message)}</div>`; console.error(e); }
  const scroll = window.scrollY;
  $("#root").innerHTML = shell(inner);
  document.title = (NAV.find((n) => n[0] === S.route) || [0, "Homelab"])[1] + " · Homelab";
  wireShell(); wireCards();
  if (S.route === "apps") wireFilters();
  if (S.route === "admin") wireAdmin();
  if (S.route === "devices") {
    const dq = $("#devq"); dq.addEventListener("input", () => { S.devQ = dq.value; history.replaceState(null, "", "#/devices"); const p = dq.selectionStart; render().then(() => { const n = $("#devq"); n.focus(); n.setSelectionRange(p, p); }); });
    $("#devf").addEventListener("change", (e) => { S.devF = e.target.value; render(); });
  }
  if (S.route === "diag") {
    const dq = $("#dq"); dq.addEventListener("change", () => { location.hash = "#/diag?q=" + encodeURIComponent(dq.value); });
    $$("[data-diag2]").forEach((b) => b.addEventListener("click", () => runDiag(b.dataset.diag2, $("#diagPanel"))));
  }
  if (S.route === "digest") {
    const g = $("#genDigest"); if (g) g.addEventListener("click", async () => { g.disabled = true; try { await api("/api/admin/digest", { method: "POST", body: {} }); toast("Digest generated"); render(); } catch (e) { toast(e.message); g.disabled = false; } });
    const p = $("#digPick"); if (p) p.addEventListener("change", () => { location.hash = "#/digest?id=" + p.value; });
  }
  const rc = $("#runCheck"); if (rc) rc.addEventListener("click", async () => { await api("/api/admin/check", { method: "POST", body: {} }); toast("Health checks started"); pollEngine("checks"); });
  if (S.q) renderResults();
  if (S.sel) { renderDrawer._quiet = true; const sc = $(".drawer")?.scrollTop; renderDrawer(); renderDrawer._quiet = false; }
  else showLastDiag();
  if (scroll && !render._nav) window.scrollTo(0, scroll);
  render._nav = false;
}
async function refresh(keepDrawer = true) {
  await load();
  if (!keepDrawer) S.sel = null;
  await render();
}
window.addEventListener("hashchange", () => { S.sel = null; S.lastDiag = null; closeDetails(); render._nav = true; window.scrollTo(0, 0); render(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $("#q")?.focus(); }
});
applyTheme();
load().then(render).catch((e) => {
  $("#root").innerHTML = `<div class="card pad login">${e.status === 401 ? `<h1>Login required</h1><p>This dashboard requires login.</p><a class="btn primary" href="#/admin">Log in</a>` : `Could not load the inventory: ${esc(e.message)}`}</div>`;
  if (e.status === 401) { S.inv = { apps: [], devices: [], nodes: [], workloads: [], containers: [], domains: [], routes: [], issues: [], sources: [], networks: [], summary: { by_status: {}, issues: {} } }; S.me = { admin: false, password_set: true }; index(); location.hash = "#/admin"; render(); }
});
// Refresh data quietly every minute while visible
setInterval(() => { if (document.visibilityState === "visible" && !document.querySelector("input:focus,textarea:focus,select:focus") && !S.sel) refresh(); }, 60000);
