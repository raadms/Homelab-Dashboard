#!/usr/bin/env bash
# Restore a backup made by backup.sh. Stop the service first.
#   systemctl stop homelab-dashboard
#   DASH_DATA=/var/lib/homelab-dashboard ./deploy/restore.sh homelab-dashboard-backup-XXXX.tar.gz
#   systemctl start homelab-dashboard
set -euo pipefail
ARCHIVE="$1"
DATA="${DASH_DATA:-$(cd "$(dirname "$0")/.." && pwd)/data}"
if [ -f "$DATA/dashboard.db" ]; then
  KEEP="$DATA.before-restore-$(date -u +%Y%m%dT%H%M%SZ)"
  cp -rp "$DATA" "$KEEP"
  echo "Current data kept in $KEEP"
fi
mkdir -p "$DATA"
rm -f "$DATA/dashboard.db-wal" "$DATA/dashboard.db-shm"
tar -xzf "$ARCHIVE" -C "$DATA"
chmod 600 "$DATA/dashboard.db" "$DATA/config.json" 2>/dev/null || true
echo "Restored into $DATA"
