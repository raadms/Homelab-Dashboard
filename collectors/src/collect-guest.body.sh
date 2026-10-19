# collect-guest.sh — RUN ON: any Linux machine that is not a Proxmox host:
#   every VM (Arr-Stack, Mediaserver, TrueNAS SCALE shell, Frigate, NAS…),
#   the Caddy server (proxy, 50.50.50.10), Raspberry Pis (PiKVM, …),
#   and other physical servers. Run with sudo for full port→process detail.
# Read-only: lists OS facts, listening ports, services, Docker/Podman
# containers and Compose apps, and any reverse proxy config (Caddy, Nginx,
# Traefik, HAProxy) including Caddy's live config from its admin API.

init_out guest

collect_linux_basics
collect_containers
collect_proxies
run_sh compose_files 'find / -xdev -maxdepth 5 \( -name docker-compose.yml -o -name docker-compose.yaml -o -name compose.yml -o -name compose.yaml \) -not -path "*/proc/*" 2>/dev/null | head -100'
run_sh snap_flatpak 'snap list 2>/dev/null; flatpak list 2>/dev/null'
run_sh virt 'systemd-detect-virt 2>/dev/null; cat /sys/class/dmi/id/product_name 2>/dev/null; cat /proc/device-tree/model 2>/dev/null'
# Appliance-specific, all read-only
have midclt && run truenas_info midclt call system.info
have midclt && run truenas_apps midclt call app.query '[]' '{"select":["name","state","active_workloads"]}'
[ -f /etc/kvmd/main.yaml ] && run pikvm_version cat /etc/kvmd/main.yaml
have tailscale && run tailscale_status tailscale status
have wg && run_sh wireguard 'wg show interfaces'

finish
