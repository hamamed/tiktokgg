#!/usr/bin/env bash
# Update tiktokgg from GitHub: pulls the latest code, reinstalls packages, restarts.
# Keeps the access token and the nginx/HTTPS setup.
# Usage: sudo bash /opt/tiktokgg/deploy/update.sh
set -Eeuo pipefail
APP_DIR="${APP_DIR:-/opt/tiktokgg}"
[[ $EUID -eq 0 ]] || { echo "Run as root (sudo)."; exit 1; }
[[ -d "$APP_DIR/.git" ]] || { echo "No git checkout in $APP_DIR. Run the install command from README."; exit 1; }
cd "$APP_DIR"
runuser -u tiktokgg -- git -c safe.directory="$APP_DIR" fetch --quiet origin
runuser -u tiktokgg -- git -c safe.directory="$APP_DIR" show "origin/$(runuser -u tiktokgg -- git -c safe.directory="$APP_DIR" rev-parse --abbrev-ref HEAD):deploy/install.sh" > /tmp/tiktokgg-install.sh
exec env APP_DIR="$APP_DIR" bash /tmp/tiktokgg-install.sh
