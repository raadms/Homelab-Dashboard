# collect-proxmox.sh — RUN ON: each Proxmox host (pve 10.10.10.10, pve-gtx 10.10.10.11), as root.
# Read-only. Lists the cluster, every VM/LXC (running or stopped), their configs
# (secrets redacted), guest-agent network info for running VMs, and — inside
# running LXCs only — containers, listening ports and services via `pct exec`.
# VMs are NOT entered: run collect-guest.sh inside each VM yourself.
#
# Options (env): SKIP_LXC_EXEC=1 to not run anything inside LXCs.
#                CMD_TIMEOUT=20 per-command timeout in seconds.

init_out proxmox

run pveversion pveversion -v
run hostname_fqdn hostname -f
collect_linux_basics
collect_containers
collect_proxies
run pvecm_status pvecm status
run pvecm_nodes pvecm nodes
run cluster_resources pvesh get /cluster/resources --output-format json
run cluster_status pvesh get /cluster/status --output-format json
run storage pvesh get /storage --output-format json
run pvesm_status pvesm status
run_sh node_status 'pvesh get /nodes/$(hostname)/status --output-format json'
run_sh ha_status 'ha-manager status 2>/dev/null'
run_sh firewall_enabled 'pvesh get /cluster/firewall/options --output-format json 2>/dev/null'
run_sh network_config 'cat /etc/network/interfaces; ls /etc/network/interfaces.d 2>/dev/null'
run_sh tasks_recent 'pvesh get /nodes/$(hostname)/tasks --limit 200 --output-format json'

NODE="$(hostname)"
# VMs on this node
for id in $(qm list 2>/dev/null | awk 'NR>1 {print $1}'); do
  run "qm_${id}_config" qm config "$id"
  run "qm_${id}_status" qm status "$id" --verbose
  if qm status "$id" 2>/dev/null | grep -q running; then
    # Read-only guest-agent queries; fail fast when no agent.
    CMD_TIMEOUT=8 run "qm_${id}_agent_net" qm guest cmd "$id" network-get-interfaces
    CMD_TIMEOUT=8 run "qm_${id}_agent_os" qm guest cmd "$id" get-osinfo
    CMD_TIMEOUT=8 run "qm_${id}_agent_host" qm guest cmd "$id" get-host-name
  fi
done

# LXCs on this node
for id in $(pct list 2>/dev/null | awk 'NR>1 {print $1}'); do
  run "pct_${id}_config" pct config "$id"
  run "pct_${id}_status" pct status "$id" --verbose
  if [ "${SKIP_LXC_EXEC:-0}" != 1 ] && pct status "$id" 2>/dev/null | grep -q running; then
    # Everything here is read-only. `sh -c` inside the container; tools may be missing.
    CMD_TIMEOUT=25 run "pct_${id}_inside" pct exec "$id" -- sh -c '
      echo "## hostname"; hostname
      echo "## os"; cat /etc/os-release 2>/dev/null | head -3
      echo "## ip"; ip -br addr 2>/dev/null || ifconfig 2>/dev/null
      echo "## listening"; ss -H -tulpn 2>/dev/null || netstat -tulpn 2>/dev/null
      echo "## services"; systemctl list-units --type=service --state=running --no-pager --no-legend --plain 2>/dev/null || rc-status 2>/dev/null
      for e in docker podman; do command -v $e >/dev/null 2>&1 || continue
        echo "## $e ps"; $e ps -a --no-trunc --format "{{json .}}"
        echo "## $e compose"; $e compose ls -a --format json 2>/dev/null
        echo "## $e inspect"; $e ps -aq | xargs -r $e inspect --format "{{json .Name}}|{{json .Config.Image}}|{{json .State.Status}}|{{json .State.StartedAt}}|{{json .RestartCount}}|{{json .State.Health}}|{{json .NetworkSettings.Ports}}|{{json .Config.Labels}}"
      done
      echo "## caddy"; for f in /etc/caddy/Caddyfile /etc/caddy/*.caddy /etc/caddy/conf.d/*; do [ -f "$f" ] && { echo "### $f"; cat "$f"; }; done
      (curl -s -m 4 http://127.0.0.1:2019/config/ || wget -qO- -T 4 http://127.0.0.1:2019/config/) 2>/dev/null
      echo "## nginx"; nginx -T 2>/dev/null | head -2000
    '
  fi
done

finish
