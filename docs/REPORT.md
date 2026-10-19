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

## Proxmox (collected 2026-10-19 11:58Z with collect-proxmox.sh)

Cluster **safrani-cluster** is quorate with 2 nodes, both online, on Proxmox VE 9.2.11.

| ID | Type | Name | Node | Status | IP / VLAN | Looked inside? |
|---|---|---|---|---|---|---|
| 100 | VM | Truenas | pve | running | 10.10.10.2, 10.10.20.2, 10.10.21.2 (VLAN 10/20/21) | **No**: guest agent not answering |
| 101 | VM | NC | pve | stopped | VLAN 35 | — |
| 102 | VM | Caddy | pve | running | 50.50.50.10 (VLAN 50) | yes (agent): Caddy, 9 sites |
| 103 | VM | Ubuntu-Media | pve | running | 10.10.40.40 (VLAN 40) | yes (agent): 26 containers, Traefik |
| 104 | VM | Arr-Stack | pve | running | 10.10.30.30 (VLAN 30) | yes (agent): 17 containers, Traefik |
| 105 | VM | Win10-SSD | pve | stopped | VLAN 60 | — |
| 106 | VM | Claude-Agents | pve | **stopped, onboot=1** | VLAN 35 | — |
| 107 | VM | ClaudeDesktop | pve | running | 10.10.35.6 (this collector) | yes |
| 108 | VM | Camera-Docker | pve | stopped | VLAN 200 | — |
| 109 | LXC | Frigate | pve | running | 10.10.200.110 | yes: Scrypted, Traefik, Portainer; **frigate container exited** |
| 110 | LXC | Frigate | pve-gtx | running | 10.10.200.111 | yes: Frigate (TensorRT), Traefik |
| 111 | LXC | plex | pve-gtx | running | 10.10.30.40 | yes: Plex on 32400 |
| 112 | LXC | thread-route-manager | pve | running | 10.10.60.100 | yes: bgpd only, no web UI |
| 900 | LXC | audit-mgmt | pve-gtx | stopped | — | — |

Totals: **52 containers**, **69 apps** (4 hidden), **39 proxy routes** (9 Caddy, 30 Traefik). 38 routes are matched to a running backend.

## Issues found (prioritized)

| # | Severity | Issue | Evidence | Suggested next step |
|---|---|---|---|---|
| 1 | High | **6 Ubuntu-Media names resolve to 192.168.50.70** instead of 10.10.40.40: speed, photo, uptime, ov, openspeed, tr | Traefik labels on VM 103 route them; DNS answers 192.168.50.70, which is on no current network | Change these local DNS records to 10.10.40.40. *Hypothesis:* the VM's old address from before the re-IP. |
| 2 | High | `sonarr.safrani.co` → 192.168.50.70, and **nothing routes that name any more** (Sonarr is now `sonarr-arr.safrani.co`) | DNS + Traefik labels on VM 104 | Delete the record, or point it at 10.10.30.30 and add a Traefik router. |
| 3 | Medium | **8 Traefik routes have no DNS record at all**: ai, baby, bazz, coo, dash, drop, it (on 10.10.40.40) and overseerr-arr (on 10.10.30.30) | NXDOMAIN | Add records to the Traefik host IPs, or remove unused routers. Until then those apps can't be reached by name. |
| 4 | Medium | `homepage-arr` and `jackett-arr.safrani.co` → **10.10.21.3**, but Traefik on Arr-Stack (10.10.30.30) serves them | DNS vs labels | Point them to 10.10.30.30. *Hypothesis:* a typo (21 vs 30). |
| 5 | Medium | `scrypted.safrani.co` has a Caddy route → **10.10.200.100:10443**, but DNS sends the name to 10.10.200.110, and no host .100 is known | Caddy config + DNS + UniFi | Decide on one path: Scrypted runs with host networking in LXC 109 (10.10.200.110), so fix the Caddy upstream, or drop that route. |
| 6 | Medium | **Frigate container in LXC 109 (pve) is exited**, while LXC 110 (pve-gtx) runs Frigate. `frigate.safrani.co` still routes to 109. | docker ps | If 110 replaced it, point frigate.safrani.co at 110 or remove it. |
| 7 | Medium | **watchtower is restart-looping** on 4 hosts (Arr-Stack, Ubuntu-Media, both Frigate LXCs). mailrise also restart-loops on Ubuntu-Media. | `docker ps` State=restarting | Check `docker logs watchtower`. *Hypothesis:* the old containrrr image no longer works with Docker 29's API version (unconfirmed). |
| 8 | Medium | VM 106 Claude-Agents is **stopped but set to start on boot** | Proxmox config onboot=1 | Start it, or turn off onboot if it's retired. |
| 9 | Medium | HA integration HP Color LaserJet is stuck in `setup_retry` | HA config entry | Check the printer's power and IP. |
| 10 | Low | Exited containers: jellyfin (Arr-Stack), plex and immich_server (Ubuntu-Media), portainer-database-rollback | docker ps | Plex now runs in LXC 111. Remove the dead ones, or mark them disabled in the dashboard. Immich being down means `photo.safrani.co` is down too. |
| 11 | Low | Stopped guests: NC (101), Win10-SSD (105), Camera-Docker (108), audit-mgmt (900) | Proxmox | Mark them "intentionally disabled" in Admin if expected. |
| 12 | Low | iDRAC 10.10.1.33 offline; `idrac.safrani.co` routes to it through Caddy | UniFi + Caddy | Expected if that server is off. |
| 13 | Info | Traefik router `hadash` on Arr-Stack uses a bare hostname with no domain | label | Use `hadash.safrani.co` if it should be reachable. |
| 14 | Info | 16 UniFi clients unnamed (e.g. 10.10.10.11 = pve-gtx, Hikvision cameras) | UniFi | Name them in UniFi. |

Correction to the first report: 10.10.200.110 is **not** offline. LXC 109 runs there, and UniFi's offline flag for it is stale.

## Still not verified

- **TrueNAS VM 100**: the guest agent didn't answer, so its apps are unknown. Fix: enable the QEMU guest agent in TrueNAS, then re-run the script. Or run `collect-guest.sh` from the TrueNAS shell.
- **Health of everything outside VLAN 1**: the collector (VLAN 35) is firewalled from those networks, so those apps show "unreachable from collector". This goes away once the dashboard runs on a host allowed to reach them (see the deployment proposal).
- **External access**: not tested (`collect-endpoints.sh` with `LOCATION=external` from your phone hotspot).
- **UniFi DNS records and DHCP reservations themselves**: needs `collect-unifi.sh` (optional; DNS answers were checked directly).

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
