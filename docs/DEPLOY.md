# Deploy: GitHub → container → Traefik

## 1. Put the code on GitHub (once)

1. On github.com create a repository, e.g. `homelab-dashboard`. A private repo is fine.
2. In this folder, run:
   ```bash
   git remote add origin https://github.com/<you>/homelab-dashboard.git
   git push -u origin main
   ```
3. GitHub Actions (`.github/workflows/image.yml`) runs the tests, builds the image for amd64 and arm64, and publishes it as
   `ghcr.io/<you>/homelab-dashboard:latest`. Watch it under the repo's **Actions** tab. A push to `main` rebuilds `latest`; a tag such as `v1.2.0` also gets its own version tag.
4. **Private repo only:** the Docker host needs permission to pull. Create a GitHub token (Settings → Developer settings → Personal access tokens → Fine-grained, permission **Packages: read**), then on the Docker host run:
   ```bash
   echo <token> | docker login ghcr.io -u <you> --password-stdin
   ```

## 2. Run it next to your Traefik

On the VM that runs Traefik (it must be on the `proxy` Docker network, which yours uses):

```bash
mkdir -p ~/homelab-dashboard && cd ~/homelab-dashboard
# copy deploy/docker-compose.yml and deploy/.env.example (renamed to .env) here
nano .env          # set DASH_IMAGE, DASH_HOST, CERT_RESOLVER
docker compose up -d
docker compose logs -f
```

| Setting | Meaning |
|---|---|
| `DASH_IMAGE` | `ghcr.io/<you>/homelab-dashboard:latest` (lower-case) |
| `DASH_HOST` | The hostname Traefik serves, e.g. `dashbard.safrani.co`. Add a local DNS record for it pointing at this VM. |
| `CERT_RESOLVER` | The resolver name from your Traefik static config (`certificatesResolvers:`) |

The compose file uses your existing conventions: entrypoints `http`/`https`, an http→https redirect, and network `proxy`.

**Resources:** about 60 MB RAM (capped at 256 MB) and 0.5 CPU. Storage is one named volume, `dashboard-data`, holding the database, settings, saved tokens and uploaded scans (a few MB).

**Network:** the VM running the container must be allowed through your firewall to reach the Proxmox nodes (TCP 8006) and the hosts and ports you want health-checked. Give it the same rule you gave 10.10.35.6.

## 3. First start

1. Open `https://<DASH_HOST>/#/admin` and create the admin account.
2. Go to **Admin → Connections → Proxmox VE** and follow the "How do I get this?" steps. Paste the token and click **Save & test**.
3. Optional: add Portainer, UniFi and Home Assistant connections. For Home Assistant, create a dedicated non-admin user; don't reuse an owner token.
4. **No API access?** Choose **Offline** and upload `collect-proxmox.sh` results in **Backup & import**.

## 4. Update, back up, restore, roll back

| Task | How |
|---|---|
| Update | `docker compose pull && docker compose up -d`. Watchtower can also do this; the label is set. |
| Back up settings | Admin → Backup & import → **Dashboard setup (.json)**. This includes your edits, manual entries and settings, but not tokens. |
| Full backup (incl. tokens) | `docker run --rm -v homelab-dashboard_dashboard-data:/d -v $PWD:/b alpine tar czf /b/dashboard-data.tgz -C /d .` |
| Restore full backup | `docker compose down`, then `docker run --rm -v homelab-dashboard_dashboard-data:/d -v $PWD:/b alpine sh -c "rm -rf /d/* && tar xzf /b/dashboard-data.tgz -C /d"`, then `docker compose up -d` |
| Roll back a bad version | Set `DASH_IMAGE=ghcr.io/<you>/homelab-dashboard:<previous sha or version>` in `.env`, then `docker compose up -d` |
| Remove completely | `docker compose down -v`. This deletes the container and its data. Nothing on your servers was ever changed by it. |

## Security notes

- Every integration is read-only: a Proxmox `PVEAuditor` token, a Portainer read-only user, a UniFi read-only API key, and an HA non-admin user.
- Tokens are stored in the data volume (`secrets.json`, mode 600). They are never returned to the browser, and never included in exports or logs.
- The container runs as a non-root user, with a read-only root filesystem and `no-new-privileges`. It has no shell access to anything, and it can't fetch arbitrary URLs: diagnostics only test addresses that are already in the inventory.
- Admin requires a sign-in. Turn on **Admin → Checks & schedule → Require sign-in to view** if the dashboard should be private too.
