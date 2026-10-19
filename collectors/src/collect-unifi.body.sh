# collect-unifi.sh — RUN ON: your Mac (on the home network), NOT on the gateway.
# Read-only GETs against the UniFi Network application on the Cloud Gateway
# Fiber. Collects networks/VLANs, active clients, all known clients (incl.
# offline + DHCP reservations), devices, local DNS records, port forwards.
#
# Needs a UniFi API key: UniFi Network → Settings → Control Plane →
# Integrations → Create API Key. It is read from the prompt (or $UNIFI_API_KEY),
# never written to disk. Wi-Fi passphrases and VPN secrets are redacted.
#
#   UNIFI_HOST=10.10.1.1 UNIFI_SITE=default ./collect-unifi.sh

init_out unifi
HOSTU="${UNIFI_HOST:-10.10.1.1}"
SITE="${UNIFI_SITE:-default}"
if [ -z "${UNIFI_API_KEY:-}" ]; then
  printf 'UniFi API key (input hidden): ' >&2; stty -echo 2>/dev/null; read -r UNIFI_API_KEY; stty echo 2>/dev/null; echo >&2
fi
have curl || { echo "curl is required" >&2; exit 1; }
export UNIFI_API_KEY
export B="https://$HOSTU/proxy/network"
# The key stays in the environment; command lines and the manifest never contain it.
G='curl -sk -m 20 -H "X-API-KEY: $UNIFI_API_KEY" -H "Accept: application/json"'

run_sh reach "curl -sk -m 5 -o /dev/null -w '%{http_code}' https://$HOSTU/"
run_sh sites_integration "$G \"\$B/integration/v1/sites\""
for ep in stat/sysinfo rest/networkconf stat/sta rest/user stat/device rest/portforward rest/routing stat/dynamicdns; do
  run_sh "api_$(echo "$ep" | tr '/' '_')" "$G \"\$B/api/s/$SITE/$ep\""
done
run_sh v2_static_dns "$G \"\$B/v2/api/site/$SITE/static-dns\""
run_sh v2_clients_history "$G \"\$B/v2/api/site/$SITE/clients/history?onlyNonBlocked=true&withinHours=720\""
run_sh v2_clients_active "$G \"\$B/v2/api/site/$SITE/clients/active\""
unset UNIFI_API_KEY
finish
