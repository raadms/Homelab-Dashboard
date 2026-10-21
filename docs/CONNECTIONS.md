# Connections: how to add and remove each one

Every connection is set up in **Admin → Connections**, and every one is optional and read-only. Tokens are stored on the dashboard server (`/data/secrets.json`, mode 600). They are never shown again and never included in exports.

| Connection | What it adds | Needs network access to |
|---|---|---|
| Proxmox VE (API token) | All VMs/LXCs, status, IPs, VLANs, CPU, memory and disk, live | nodes, TCP 8006 |
| **Docker agents** | Every container on each Docker host, live, including stacks, ports and Traefik routes | each Docker host, TCP 9180 |
| Portainer | Live container state from each Portainer | each Portainer, TCP 9443 |
| UniFi | Network/VLAN names, DHCP reservations, local DNS records, offline devices | gateway, TCP 443 |
| Home Assistant | Add-ons and network clients | HA, TCP 443/8123 |

## Proxmox VE

**Add:**
1. Proxmox: **Datacenter → Permissions → Users → Add**. User `dashboard`, realm *Proxmox VE authentication server*.
2. **Datacenter → Permissions → Add → User Permission**: path `/`, user `dashboard@pve`, role `PVEAuditor`.
3. **Datacenter → Permissions → API Tokens → Add**: user `dashboard@pve`, token ID `dash`, untick *Privilege Separation*.
4. Paste `dashboard@pve!dash=<secret>` into the dashboard and click **Save & test**.

**Remove:**
1. In the dashboard, click **Disconnect**.
2. In Proxmox, go to **API Tokens**, select the token and click **Remove**. Optionally remove the user `dashboard@pve` too.

## Docker agents (recommended for containers)

A tiny read-only container, `ghcr.io/raadms/homelab-dashboard-agent`, runs on each Docker host. It answers one question, "which containers run here?", by making a single Docker call: `GET /containers/json`.

What it returns: name, image, state, ports, Compose stack, and Traefik route/port labels.

What it never returns or does:
- environment variables, inspect data, or any other labels;
- logs or exec;
- starting or stopping anything. That code doesn't exist in it.

How it is protected:
- **Signed requests:** each request is signed with a per-host key (HMAC-SHA256) and expires after 60 s. The key never crosses the network.
- **Locked-down container:** read-only filesystem, all capabilities dropped, `no-new-privileges`, and the Docker socket mounted read-only.

**Add:**
1. Admin → Connections → Docker agents → **Add a Docker host** → enter the host IP → **Generate key**.
2. Copy the compose snippet and deploy it on that host as a stack named `homelab-agent`.
3. Allow the dashboard's host to reach that host on **TCP 9180**. Nothing else needs to reach it.
4. Click **Save & test**. Repeat for each Docker host; each gets its own key.

**Remove:**
1. In the dashboard, click **Remove** next to the host.
2. On the host, delete the `homelab-agent` stack. The key disappears with it.

## Portainer (one row per Portainer server)

**Add:**
1. In Portainer, go to **Users → Add user** `dashboard`. On Business Edition, give it the **Read-only user** role on each environment. Community Edition has no read-only role; there it's a normal user.
2. Log in as `dashboard` → **My account → Access tokens → Add access token**.
3. In the dashboard, click **Add another Portainer**, enter the address (e.g. `10.10.40.40:9443`) and the token, and click **Save & test**.

**Remove:**
1. In the dashboard, click **Remove** next to the server.
2. In Portainer, delete the token, or delete the `dashboard` user.

## UniFi Network

**Add:**
1. In UniFi Network, go to **Settings → Control Plane → Integrations → Create API Key**.
2. In the dashboard, enter the gateway address (e.g. `10.10.1.1`) and the key, and click **Save & test**.

**Remove:**
1. In the dashboard, click **Disconnect**.
2. In UniFi, under Integrations, delete the key.

## Home Assistant

**Add:**
1. In HA, create a **non-admin** user `dashboard`.
2. Log in as that user → profile → **Security → Long-lived access tokens → Create**.
3. In the dashboard, enter the HA address and the token, and click **Save & test**.

**Remove:**
1. In the dashboard, click **Disconnect**.
2. In HA, delete the token, or delete the user `dashboard`.
