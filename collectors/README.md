# Collection scripts

All scripts are **read-only**. They don't restart, install, reload, or change anything. Every command has a timeout, missing tools are skipped, and output is redacted (passwords, tokens, keys, Wi‑Fi passphrases, bcrypt hashes, URL credentials, private keys). Container environment variables are never collected.

Each run writes one timestamped folder plus a `.tar.gz` in the current directory, e.g. `proxmox-pve-20261019T110000Z.tar.gz`. Send the `.tar.gz` files back. You can open them first to check what's inside.

The ready-to-run scripts are in `dist/`. Don't edit them directly; edit `src/` and `lib/`, then run `./build.sh`.

## Where to run what

| # | Script | Run on | Run as | How |
|---|---|---|---|---|
| 1 | `collect-proxmox.sh` | **pve (10.10.10.10)** shell | root | `bash collect-proxmox.sh` |
| 2 | `collect-proxmox.sh` | **pve-gtx (10.10.10.11)** shell | root | `bash collect-proxmox.sh` |
| 3 | `collect-guest.sh` | **Caddy-Proxy VM/LXC (50.50.50.10)** | sudo | `sudo bash collect-guest.sh` |
| 4 | `collect-guest.sh` | **each VM** (not LXCs, see note): Arr-Stack 10.10.30.30, Mediaserver 10.10.40.40, the guest at 10.10.30.40, Frigate 10.10.200.111, thread-route-manager 10.10.60.100, and any Windows-less Linux VM | sudo | `sudo bash collect-guest.sh` |
| 5 | `collect-guest.sh` | **TrueNAS** (NAS 10.10.10.2, Truenas-Secure 10.10.20.2, Truenas-Media 10.10.21.2): System → Shell | admin/sudo | `sudo bash collect-guest.sh` |
| 6 | `collect-guest.sh` | **Raspberry Pis / physical boxes**: PiKVM 10.10.10.87 (run `rw` first if root is read-only, then `ro` after), Home Assistant QA 10.10.60.20 only if it has a shell | sudo | `sudo bash collect-guest.sh` |
| 7 | `collect-unifi.sh` | **your Mac**, on the home network (not on the gateway) | you | `bash collect-unifi.sh` (asks for a read-only API key) |
| 8 | `collect-endpoints.sh` | **your Mac** at home | you | `LOCATION=lan bash collect-endpoints.sh` |
| 9 | `collect-endpoints.sh` | **your Mac off the home network** (iPhone hotspot, Wi‑Fi off). This is the only way to confirm external access | you | `LOCATION=external bash collect-endpoints.sh` |

Notes
- **LXCs are covered by #1/#2:** the Proxmox script runs read-only commands inside *running* LXCs via `pct exec` (`SKIP_LXC_EXEC=1` turns that off). It does **not** enter VMs. Run #4 inside VMs yourself.
- The Proxmox script asks running VMs' QEMU guest agent for IPs/hostname. VMs without the agent just show "agent not running".
- **UniFi API key:** UniFi Network → Settings → Control Plane → Integrations → *Create API Key*. Use a key you can delete afterwards. It's read from a hidden prompt or `UNIFI_API_KEY`, and never written to disk. Set `UNIFI_HOST` if the console isn't at 10.10.1.1.
- Copying a script to a host: `scp collectors/dist/collect-guest.sh user@host:` or paste it into a file in the web shell.
- Per-command timeout: `CMD_TIMEOUT=30 bash …` (default 20 s).

## Importing results

Put the `.tar.gz` files in `collected/incoming/` and run:

```
python3 server/import_collected.py
```

The dashboard rebuilds the inventory from them. Your manual edits are stored separately and aren't touched.
