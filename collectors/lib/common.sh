# Shared helpers for the read-only collectors. Each collector embeds a copy of this
# file at build time (see collectors/build.sh) so every script stays a single file.
#
# Output layout: $OUT/<name>.txt|json per command, plus manifest.tsv with
# name, exit code, seconds, and the command that ran. Everything is redacted
# before it is written. The directory is tarred at the end.

set -u
umask 077
COLLECTOR_VERSION="1.0.0"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
HOST_SHORT="$(hostname -s 2>/dev/null || hostname 2>/dev/null || echo unknown)"
CMD_TIMEOUT="${CMD_TIMEOUT:-20}"

have() { command -v "$1" >/dev/null 2>&1; }

# Redact values whose key or flag name looks secret. Over-redaction is fine;
# leaking is not. Covers KEY=value, key: value, "key":"value", --flag value.
redact() {
  if have perl; then
    perl -pe '
      s/("[^"]*(?:pass|passwd|password|secret|token|apikey|api_key|api-key|psk|passphrase|private|credential|auth_key|wpa|sshkeys|cipassword|hash|cookie|session)[^"]*"\s*:\s*)"[^"]*"/$1"<redacted>"/gi;
      s/(^|[\s,;])([\w.-]*(?:pass|passwd|password|secret|token|apikey|api_key|psk|passphrase|credential|private_key|cookie|sshkeys|cipassword)[\w.-]*)(\s*[:=]\s*)[^\s,;]+/$1$2$3<redacted>/gi;
      s/\$2[aby]\$\d\d\$[.\/A-Za-z0-9]{53}/<redacted-bcrypt>/g;
      s/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]{8,}/$1 <redacted>/g;
      s/-----BEGIN [A-Z ]*PRIVATE KEY-----.*/<redacted-private-key>/;
      s#(://[^:/@\s]+:)[^@/\s]+@#$1<redacted>@#g;
    '
  else
    # Fallback (no perl): case-sensitive subset, portable sed.
    sed -E -e 's/("[^"]*([Pp]ass|[Ss]ecret|[Tt]oken|[Kk]ey|psk|PSK)[^"]*"[[:space:]]*:[[:space:]]*)"[^"]*"/\1"<redacted>"/g' \
           -e 's/([A-Za-z_]*([Pp]ass|PASS|[Ss]ecret|SECRET|[Tt]oken|TOKEN|psk|PSK)[A-Za-z_]*[[:space:]]*[:=][[:space:]]*)[^[:space:],;]+/\1<redacted>/g'
  fi
}

init_out() {
  OUT="${OUTDIR:-$PWD}/$1-${HOST_SHORT}-${TS}"
  mkdir -p "$OUT"
  printf 'name\texit\tseconds\tcommand\n' > "$OUT/manifest.tsv"
  {
    echo "collector=$1"
    echo "collector_version=$COLLECTOR_VERSION"
    echo "hostname=$(hostname 2>/dev/null)"
    echo "collected_at_utc=$TS"
    echo "user=$(id -un 2>/dev/null)"
    echo "kernel=$(uname -sr 2>/dev/null)"
  } > "$OUT/_meta.txt"
  echo "[collector] writing to $OUT" >&2
}

# run NAME CMD...  -> runs with timeout, redacts, records result. Never aborts.
run() {
  local name="$1"; shift
  local start end rc
  start=$(date +%s)
  if have timeout; then
    timeout "$CMD_TIMEOUT" "$@" 2>&1 | redact > "$OUT/$name.txt"; rc=${PIPESTATUS[0]}
  else
    "$@" 2>&1 | redact > "$OUT/$name.txt"; rc=${PIPESTATUS[0]}
  fi
  end=$(date +%s)
  printf '%s\t%s\t%s\t%s\n' "$name" "$rc" "$((end-start))" "$*" >> "$OUT/manifest.tsv"
  [ "$rc" = 124 ] && echo "[collector] timeout: $name" >&2
  return 0
}

# run_sh NAME 'shell snippet'
run_sh() { local n="$1"; shift; run "$n" sh -c "$1"; }

# Common Linux facts, used by host and guest collectors.
collect_linux_basics() {
  run os_release cat /etc/os-release
  run uptime uptime
  run ip_addr ip -br addr
  run ip_addr_json ip -j addr
  run ip_route ip route
  run resolv cat /etc/resolv.conf
  run hosts_file cat /etc/hosts
  run listening ss -H -tulpn
  run_sh cpu_mem 'nproc; free -m; df -hPT -x tmpfs -x devtmpfs -x overlay 2>/dev/null'
  if have systemctl; then
    run systemd_running systemctl list-units --type=service --state=running --no-pager --no-legend --plain
    run systemd_failed systemctl list-units --state=failed --no-pager --no-legend --plain
    run systemd_enabled systemctl list-unit-files --type=service --state=enabled --no-pager --no-legend
  fi
}

# Containers: docker and podman. Never dumps Env.
collect_containers() {
  local eng
  for eng in docker podman; do
    have "$eng" || continue
    run "${eng}_version" "$eng" version --format '{{.Server.Version}}'
    run "${eng}_ps" "$eng" ps -a --no-trunc --format '{{json .}}'
    run_sh "${eng}_inspect" "$eng"' ps -aq | xargs -r '"$eng"' inspect --format "{{json .Name}}|{{json .Config.Image}}|{{json .State.Status}}|{{json .State.StartedAt}}|{{json .RestartCount}}|{{json .State.Health}}|{{json .HostConfig.NetworkMode}}|{{json .NetworkSettings.Ports}}|{{json .Config.Labels}}|{{range \$k,\$v := .NetworkSettings.Networks}}{{\$k}}={{\$v.IPAddress}} {{end}}"'
    run "${eng}_networks" "$eng" network ls --format '{{json .}}'
    run_sh "${eng}_compose_ls" "$eng compose ls -a --format json 2>/dev/null || ${eng}-compose ls -a 2>/dev/null"
  done
}

# Reverse proxies on this machine (Caddy, Nginx, Traefik, HAProxy) and in containers.
collect_proxies() {
  if have caddy || [ -d /etc/caddy ] || ls /etc/caddy* >/dev/null 2>&1; then
    run caddy_version caddy version
    run_sh caddy_files 'ls -la /etc/caddy /etc/caddy/* 2>/dev/null'
    run_sh caddy_caddyfile 'for f in /etc/caddy/Caddyfile /etc/caddy/*.caddy /etc/caddy/*/*.caddy /etc/caddy/conf.d/* /etc/caddy/sites/*; do [ -f "$f" ] && { echo "### $f"; cat "$f"; }; done'
    run_sh caddy_adapt 'caddy adapt --config /etc/caddy/Caddyfile --pretty 2>/dev/null'
  fi
  # Admin API (read-only GET of the running config). Default port 2019.
  if have curl; then
    run_sh caddy_runtime_config 'curl -s -m 5 http://127.0.0.1:2019/config/ 2>/dev/null'
    run_sh traefik_api 'for p in 8080 8082; do curl -s -m 4 "http://127.0.0.1:$p/api/http/routers" && echo && curl -s -m 4 "http://127.0.0.1:$p/api/http/services" && break; done 2>/dev/null'
  fi
  if have nginx; then run nginx_config nginx -T; fi
  [ -d /etc/traefik ] && run_sh traefik_files 'find /etc/traefik -maxdepth 3 -type f \( -name "*.yml" -o -name "*.yaml" -o -name "*.toml" \) -exec sh -c "echo \"### \$1\"; cat \"\$1\"" _ {} \;'
  [ -f /etc/haproxy/haproxy.cfg ] && run haproxy_config cat /etc/haproxy/haproxy.cfg
  # Proxies running in containers: copy their config out read-only.
  local eng c
  for eng in docker podman; do
    have "$eng" || continue
    for c in $("$eng" ps --format '{{.Names}} {{.Image}}' 2>/dev/null | awk 'tolower($2) ~ /caddy|traefik|nginx|npm|swag|haproxy/ {print $1}'); do
      run_sh "proxy_${eng}_${c}" "$eng exec $c sh -c 'cat /etc/caddy/Caddyfile /config/Caddyfile 2>/dev/null; wget -qO- http://127.0.0.1:2019/config/ 2>/dev/null; nginx -T 2>/dev/null; ls /etc/traefik 2>/dev/null; cat /etc/traefik/*.yml /etc/traefik/*.toml 2>/dev/null; wget -qO- http://127.0.0.1:8080/api/http/routers 2>/dev/null'"
    done
  done
}

finish() {
  local tarball="$OUT.tar.gz"
  if [ "${STDOUT_MODE:-0}" = 1 ]; then
    # Called by the dashboard over SSH: stream the result, leave nothing behind.
    tar -czf - -C "$(dirname "$OUT")" "$(basename "$OUT")" 2>/dev/null >&3
    rm -rf "$(dirname "$OUT")"
    return 0
  fi
  tar -czf "$tarball" -C "$(dirname "$OUT")" "$(basename "$OUT")" 2>/dev/null && \
    echo "[collector] done: $tarball" >&2 && echo "$tarball"
}
