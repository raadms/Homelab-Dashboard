#!/usr/bin/env bash
# Back up the dashboard's data directory (database, config, collector uploads).
# Uses SQLite's online backup so it is safe while the service runs.
#   DASH_DATA=/var/lib/homelab-dashboard ./deploy/backup.sh [dest_dir]
set -euo pipefail
DATA="${DASH_DATA:-$(cd "$(dirname "$0")/.." && pwd)/data}"
DEST="${1:-$PWD}"
TS=$(date -u +%Y%m%dT%H%M%SZ)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
python3 - "$DATA/dashboard.db" "$TMP/dashboard.db" <<'PY'
import sqlite3, sys
src = sqlite3.connect(sys.argv[1]); dst = sqlite3.connect(sys.argv[2])
src.backup(dst); dst.close(); src.close()
PY
cp -p "$DATA/config.json" "$TMP/" 2>/dev/null || true
[ -d "$DATA/incoming" ] && cp -rp "$DATA/incoming" "$TMP/"
umask 077
tar -czf "$DEST/homelab-dashboard-backup-$TS.tar.gz" -C "$TMP" .
echo "$DEST/homelab-dashboard-backup-$TS.tar.gz"
# config.json holds the admin password hash and file paths, never the HA token itself.
