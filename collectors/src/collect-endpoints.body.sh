# collect-endpoints.sh — RUN ON: your Mac. Run it twice if you want external
# access verified: once at home (LOCATION=lan) and once off the home network,
# e.g. iPhone hotspot with Wi-Fi off (LOCATION=external).
# Read-only: DNS lookup, TCP connect, one HTTP(S) GET (no redirects followed
# beyond 5, no credentials sent), TLS certificate expiry. One request per URL.
#
#   LOCATION=lan ./collect-endpoints.sh domains.txt
# domains.txt: one host or URL per line (the dashboard can export this list).
# With no file it uses the built-in list of known safrani.co names.

init_out "endpoints-${LOCATION:-lan}"
LIST="${1:-}"
DEFAULT="ha.safrani.co nas.safrani.co frigate.safrani.co frigate-gtx.safrani.co proxy.safrani.co plex.safrani.co sonarr.safrani.co arr.safrani.co unifi.safrani.co"
if [ -n "$LIST" ] && [ -f "$LIST" ]; then TARGETS=$(grep -v '^#' "$LIST"); else TARGETS="$DEFAULT"; fi
run_sh public_ip 'curl -s -m 5 https://api.ipify.org'
run_sh resolvers 'scutil --dns 2>/dev/null | grep nameserver | sort -u || cat /etc/resolv.conf'
i=0
for t in $TARGETS; do
  i=$((i+1)); host=$(echo "$t" | sed -E 's#^[a-z]+://##; s#[/:].*##')
  case "$t" in http*://*) url="$t";; *) url="https://$t/";; esac
  run_sh "t${i}_dns" "echo '$host'; dig +short +time=3 +tries=1 '$host' 2>/dev/null || host '$host' 2>/dev/null || nslookup '$host'"
  run_sh "t${i}_http" "curl -s --connect-timeout 5 -m 10 -o /dev/null -L --max-redirs 5 -w 'url=$url\ncode=%{http_code}\nfinal=%{url_effective}\nredirects=%{num_redirects}\nip=%{remote_ip}\nport=%{remote_port}\ntime=%{time_total}\nssl_verify=%{ssl_verify_result}\nctype=%{content_type}\n' '$url'"
  run_sh "t${i}_tls" "curl -skv --connect-timeout 5 -m 8 -o /dev/null 'https://$host/' 2>&1 | grep -Ei 'subject:|issuer:|expire date|start date|subjectAltName|SSL connection'"
done
finish
