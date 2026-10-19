# Homelab dashboard

A single place to find, open and check every application on the safrani.co homelab. It covers both Proxmox nodes, their VMs, LXCs and containers, standalone devices, DNS names and reverse-proxy routes. Discovery is read-only, and health checks are low-impact.

```
collectors/   read-only collection scripts (run on hosts) → .tar.gz results
server/       Python 3 standard library only: discovery, checks, digest, API
web/          the dashboard (vanilla JS/CSS, no build step), works on Mac/iPad/iPhone
config/       seed.json: facts you supplied (nodes, known domains, VLAN names)
deploy/       systemd unit, backup.sh, restore.sh
docs/         inventory (JSON/CSV/Markdown), REPORT.md (issues and gaps)
tests/        unit + end-to-end tests (python3 -m unittest discover -s tests)
.claude/agents/  project agent team (removed roles are recoverable from git: bf2657d)
```

## Why this stack

The host had Python 3.14 but no pip or venv, and no Node package manager was needed. A standard-library-only Python backend with SQLite has **zero dependencies to install, patch or break**. Back it up by copying one folder; deploy it with one systemd unit. The UI is plain HTML/JS/CSS served by the same process.

## How it works

| Layer | What it does | Where the data lives |
|---|---|---|
| Discovery (hourly by default) | Reads Home Assistant read-only (its UniFi integration gives every client with IP, VLAN and online state; its add-ons; integration health). Resolves DNS for known and candidate names. Imports collector results (Proxmox, guests, Caddy/Nginx/Traefik, UniFi). | `snapshots` table: one immutable snapshot per run |
| Your edits | Name, icon, category, order, preferred URL, extra URLs, hidden, disabled, notes, favorites, manual apps and devices | `overrides`, `manual`, `prefs`: never touched by discovery |
| Health checks (every 5 min) | DNS → TCP → TLS → one unauthenticated GET. Management UIs get HTTP at most every 6 h. | `endpoint_state`, `checks` (30 days) |
| Events and digest | Changes between snapshots, health transitions, certificate expiry, broken and stale entries. Daily at 07:00 and on demand. | `events`, `digests` |

Endpoint vocabulary, from strongest to weakest:
- **verified**: a check answered.
- **configured**: in DNS or proxy config.
- **discovered**: a listening port was seen.
- **inferred**: convention only, for example Proxmox on :8006.

Health vocabulary: **up**, **login** (401/403 or a redirect to a login page; the app is up), **degraded**, **down** (refused or 5xx), **DNS failed**, **unreachable from collector** (timeout or firewall; *not* proof the app is down), **unverified**, **stopped**, **disabled**.

## Install / run locally

```bash
cd "Website Dashbard"
python3 -m server.app --set-password   # choose the admin password (stored as a PBKDF2 hash)
python3 -m server.app                  # http://<host>:8088
```

`data/config.json` (created on first run, mode 600):

| key | default | meaning |
|---|---|---|
| `port` / `listen` | 8088 / 0.0.0.0 | HTTP listener |
| `ha_url_file`, `ha_token_file` | `~/.config/ha-agent/url`, `…/token` | Files holding the HA URL and a **read-only** long-lived token. Only the backend reads them. They are never sent to the browser, put in snapshots, or exported. |
| `secure_cookie` | false | Set true when served over HTTPS (e.g. behind Caddy) |
| `collector_label` | auto (`hostname (ip)`) | Shown next to every check result |

Settings such as intervals, digest hour, certificate warning and login-to-view are edited in **Admin → Settings**.

Run the tests: `python3 -m unittest discover -s tests -v`

## Collecting data you can't reach from here

See [collectors/README.md](collectors/README.md). Upload the resulting `.tar.gz` in **Admin → Import / export → Upload collector results** (or copy it into `data/incoming/`). Rediscovery starts automatically.

## Backup, restore, update

```bash
./deploy/backup.sh /path/to/backups          # online-safe SQLite backup + config + uploads
systemctl stop homelab-dashboard
DASH_DATA=/var/lib/homelab-dashboard ./deploy/restore.sh homelab-dashboard-backup-<ts>.tar.gz
systemctl start homelab-dashboard
```

**Update:** `./deploy/backup.sh`, then `git pull` (or copy the new folder), `python3 -m unittest discover -s tests`, `systemctl restart homelab-dashboard`. The schema only adds tables and columns (`CREATE … IF NOT EXISTS`).
**Roll back:** check out the previous commit and restore the backup taken just before.

Admin → Import / export also gives a portable JSON of all your edits, manual entries and settings. It never includes credentials.

## Deployment (not done yet; needs your approval)

The proposal and rollback steps are in [docs/REPORT.md](docs/REPORT.md#deployment-proposal). Nothing has been installed on any production host.

## Security notes

- Discovery and checks are read-only: no restarts, no config changes, no logins attempted, no port sweeps. Only known endpoints are checked, and diagnostics can only target endpoints already in the inventory (rate-limited).
- Admin endpoints need a session cookie (`HttpOnly`, `SameSite=Strict`) **and** an `X-Dashboard` header. Logins are throttled (5 failures / 5 min). Strict CSP: no inline or third-party scripts. Icons load from `cdn.jsdelivr.net` (images only).
- The dashboard has no shell execution, no arbitrary URL fetching, and no way to modify infrastructure. "Remove" only hides a dashboard row.
