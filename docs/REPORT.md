# Homelab discovery report: 2026-10-19

Collector: **Claude-Desktop, 10.10.35.6 (VLAN 35)**. All findings are read-only. The full inventory is in [inventory/INVENTORY.md](inventory/INVENTORY.md) (also `inventory.json` and `inventory.csv`).

## What was verified

| Area | Result | Evidence |
|---|---|---|
| Home Assistant (Yellow, 10.10.1.10) | **Up**: `https://ha.safrani.co/` and `https://10.10.1.10/` answer. TLS Let's Encrypt, valid until 2026-12-23. Core 2026.10.1 (2026.10.2 available). | HA REST API (read-only GETs) and live checks |
| HA add-ons | 14 found. Zigbee2MQTT, Scrypted, Music Assistant, File editor and Terminal pages verified at `/app/<slug>` (HA 2026.x path; the old `/hassio/ingress/` path returns 404). Mosquitto update 7.1.1 → 7.1.2 available. | HA update/running entities |
| Network clients | **86 UniFi clients** (59 online, 27 previously seen) with IP, VLAN, vendor and state | UniFi integration inside HA |
| VLANs / subnets observed | 1, 10, 20, 21, 30, 35, 40, 50 (50.50.50.0/24), 60, 200 | Client VLAN tags (names are inferred until the UniFi collector runs) |
| DNS | 16 names resolve (12 configured, 4 automatic DHCP hostname records) | System resolver on the collector |
| UniFi gateway | 10.10.1.1 answers on 8443/9443/8080 from VLAN 35 but not 443 | TCP/HTTP checks |

## Issues found (prioritized)

| # | Severity | Issue | Evidence | Suggested next step |
|---|---|---|---|---|
| 1 | High | **`sonarr.safrani.co` and `uptime.safrani.co` → 192.168.50.70**, an address in no current network | DNS answer; no UniFi network contains 192.168.50.0/24 | Update or delete these local DNS records. *Hypothesis:* left over from an older layout. Sonarr is probably on Arr-Stack (10.10.30.30) now; to confirm, run collect-guest.sh there. |
| 2 | Medium | **`frigate.safrani.co` and `scrypted.safrani.co` → 10.10.200.110**, which UniFi shows offline. HA uses `frigate-gtx.safrani.co` (10.10.200.111). | DNS + UniFi offline state + HA Frigate integration title | Repoint or remove the old names. *Hypothesis:* the old Frigate/Scrypted VM was replaced by the GTX one. |
| 3 | Medium | HA integration **HP Color LaserJet Pro MFP 3303** is stuck in `setup_retry` | HA config entry state | Check the printer is on and at the same IP (UniFi shows HPI8CD858 offline). |
| 4 | Low | **iDRAC (10.10.1.33) is offline** in UniFi, yet `idrac.safrani.co` routes through Caddy | UniFi state; DNS → 50.50.50.10 | Expected if that server is powered off. Otherwise check its cable. |
| 5 | Info | **16 UniFi clients have no name**, e.g. 10.10.10.11 (ASUSTek NIC, the pve-gtx host itself), plus Proxmox virtual NICs at 10.10.30.40 and 10.10.200.111 | UniFi client list | Name them in UniFi so they are identifiable here. |
| 6 | Info | `unifi.safrani.co` → 10.10.35.1 (the gateway's VLAN 35 address), while the console UI answers on 10.10.1.1 | DNS | Works only from VLANs that may reach the gateway on 443. Consider pointing it at 10.10.1.1 or proxying it. |
| 7 | Info | `proxy.safrani.co`, `plex.safrani.co` and `idrac.safrani.co` point to Caddy, but its routes are unknown | DNS | Run collect-guest.sh on Caddy-Proxy (50.50.50.10). |
| 8 | Info | Pending updates: HA Core 2026.10.2, Mosquitto 7.1.2 | HA update entities | Not applied (read-only rule). |

## Not accessible or not verified yet

From VLAN 35 every port on these hosts **timed out**. That points to an inter-VLAN firewall, *not* to the services being down:

| Target | What is missing | Script to run | Where |
|---|---|---|---|
| pve 10.10.10.10, pve-gtx 10.10.10.11 | All VMs/LXCs, their state, host services, Docker in LXCs. The cluster name `safrani-cluster` is still unverified. | `collect-proxmox.sh` | each Proxmox host shell (root) |
| Caddy-Proxy 50.50.50.10 | All proxy routes (domain → upstream) | `collect-guest.sh` | Caddy host (sudo) |
| Arr-Stack 10.10.30.30, 10.10.30.40, Mediaserver 10.10.40.40, Frigate 10.10.200.111, thread-route-manager 10.10.60.100 | Containers, Compose projects, ports | `collect-guest.sh` | inside each VM (sudo) |
| NAS 10.10.10.2, Truenas-Secure 10.10.20.2, Truenas-Media 10.10.21.2 | Apps, web UI port/scheme | `collect-guest.sh` | TrueNAS shell |
| PiKVM 10.10.10.87, HA QA 10.10.60.20 | Services | `collect-guest.sh` | device shell |
| UniFi | Network names, DHCP reservations, local DNS records, offline-client history beyond HA's view, port forwards | `collect-unifi.sh` | your Mac (read-only API key) |
| External access | Whether any name works from the Internet | `collect-endpoints.sh` with `LOCATION=external` | your Mac on iPhone hotspot |
| Hikvision cameras (10.10.200.x), IoT devices | Web UIs not probed (unreachable from VLAN 35) | none needed | — |

Until those results are imported, IP URLs for these hosts are marked **inferred** (convention only), and every check reads **unreachable from collector**.

## Validation performed

- 10 automated tests: parsers (ss, docker, pct/qm config, Caddyfile incl. snippets, `handle_path`, redirects, TLS upstreams, Caddy JSON, nginx), status classification, an end-to-end Proxmox → LXC → Docker → Caddy path-route build, overrides surviving rediscovery, diff events, and the digest baseline.
- Real import: a real `collect-guest.sh` run from this VM was uploaded through the Admin UI and appeared in the inventory.
- In the browser: overview, apps (filters, domain/IP switch, favorites), details and diagnostics, search (apps, devices, domains), infrastructure tree, DNS/proxy view, digest, admin login and edit. Checked at 1280 px desktop, 768 px iPad portrait (dark mode) and 375 px iPhone.
- Security: unknown override fields, `javascript:`/`file:` URLs, requests missing the `X-Dashboard` header and unauthenticated admin calls were all rejected. Exports and backups contain no token.
- Not yet validated: real Proxmox, Caddy and Docker data, because those hosts are unreachable from here. The parsers are covered by tests that use the exact formats the collectors produce.

## Deployment proposal

Nothing has been deployed. It runs now on this VM, `http://10.10.35.6:8088`, for review only. This VM can't reach most VLANs, so production needs a better-placed host.

| Item | Proposal |
|---|---|
| Target | A **new small LXC on pve** (Debian 12, unprivileged), on VLAN 10 (Servers) with a DHCP reservation. Alternative: an existing utility VM you choose. |
| Network access it needs (outbound, read-only) | TCP 443/80 and app ports to the VLANs you want monitored. HTTPS to HA (10.10.1.10). DNS. No inbound except the UI port. |
| Ports | 8088/tcp (UI). Optionally published as `https://dash.safrani.co` through Caddy (then set `secure_cookie: true`). |
| Persistent storage | `/var/lib/homelab-dashboard` (SQLite + config + uploads). About 50 MB/year at default retention. |
| Resources | 1 vCPU, 256 MB RAM (systemd caps it at 256 MB / 50 % CPU), 2 GB disk |
| Credentials | A **new dedicated HA token** for a non-admin HA user, stored in `/etc/homelab-dashboard/ha_token` (mode 600, owned by the service user). Don't reuse the current agent token. |
| Install | Copy the folder to `/opt/homelab-dashboard`, create the user, `--set-password`, install `deploy/homelab-dashboard.service`, enable it. |
| Rollback | `systemctl disable --now homelab-dashboard`, then remove the unit and `/opt/homelab-dashboard`. Data stays in `/var/lib/homelab-dashboard` until you delete it. Destroying the LXC removes everything; no other system is changed. |

Approval needed from you: the host or LXC, its IP/VLAN, the firewall allowance for that IP, and whether to publish it through Caddy.
