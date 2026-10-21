# Connections: how to add and remove each one

Every connection is set up in **Admin → Connections**, and every one is optional and read-only. Tokens are stored on the dashboard server (`/data/secrets.json`, mode 600). They are never shown again and never included in exports.

| Connection | What it adds | Needs network access to |
|---|---|---|
| Proxmox VE (API token) | All VMs/LXCs, status, IPs, VLANs, CPU, memory and disk, live | nodes, TCP 8006 |
| **Deep scan (SSH)** | Everything **inside** VMs and LXCs: containers, stacks, ports, Traefik/Caddy routes | nodes, TCP 22 |
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

## Deep scan (sees inside VMs and LXCs)

The dashboard runs the read-only `collect-proxmox.sh` on each node over SSH. Its key is installed with a *forced command*: `command="/usr/local/sbin/homelab-collect --stdout",restrict`. Whatever is asked, the node runs only that script. There is no shell, no other command, and no port, agent or X11 forwarding. VMs additionally need the QEMU guest agent to be seen inside.

**Add:**
1. Admin → Connections → Deep scan → **How do I add this?** → copy the command. It contains this dashboard's own public key.
2. Paste it into a shell on **each** Proxmox node. It should print `homelab-dashboard deep scan installed`.
3. Allow the dashboard's host to reach the nodes on TCP 22.
4. Enter the node addresses and click **Save & scan**. Scans then repeat on the schedule set in Checks & schedule.

**Remove:**
1. In the dashboard, clear the addresses and click **Save & scan**.
2. On each node, run the following. `--follow-symlinks` matters because `authorized_keys` is a symlink into the cluster filesystem:
   ```bash
   sed -i --follow-symlinks '/homelab-dashboard$/d' /root/.ssh/authorized_keys; rm -f /usr/local/sbin/homelab-collect
   ```

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
