#!/usr/bin/env bash
# =============================================================================
#  tiktokgg · TikTok LIVE Game Control: installer / updater for a Linux VPS
#
#  One-line install (as root):
#    curl -fsSL https://raw.githubusercontent.com/hamamed/tiktokgg/main/deploy/install.sh \
#      | sudo DOMAIN=tiktokgg.koydam.com EMAIL=admin@koydam.com bash
#
#  Options (environment variables):
#    DOMAIN=tiktokgg.koydam.com   Public hostname (DNS A record -> this server)
#    EMAIL=                       Let's Encrypt contact email (optional)
#    PORT=                        Internal port (localhost only). Default: first free in 3200-3299
#    APP_DIR=/opt/tiktokgg        Install folder
#    REPO=https://github.com/hamamed/tiktokgg.git   BRANCH=main
#    PROXY=auto|nginx|apache|caddy|none
#    NEW_TOKEN=1                  Generate a new access token (logs out every dashboard/game)
#
#  What it does:
#    • runs express-server/server.js as the systemd service "tiktokgg" on 127.0.0.1:PORT
#      (it serves the dashboard at / and the WebSocket at /ws)
#    • adds ONE reverse-proxy site for DOMAIN (+ HTTPS via Let's Encrypt)
#  Safe to run again (it updates the code and keeps the access token).
#  It never opens a public port and never touches your other sites (e.g. tiktok.koydam.com).
# =============================================================================
set -Eeuo pipefail
ERR_LINE=""; ERR_CMD=""; DIED=0
trap 'ERR_LINE=$LINENO; ERR_CMD=$BASH_COMMAND' ERR
trap 'rc=$?; if (( rc != 0 && DIED == 0 )) && [[ -n $ERR_LINE ]]; then printf "\033[31m✖ install.sh stopped at line %s: %s\033[0m\n" "$ERR_LINE" "$ERR_CMD" >&2; fi' EXIT

# Everything is inside main() so `curl | bash` reads the whole script before running it.
main() {
DOMAIN="${DOMAIN:-tiktokgg.koydam.com}"
EMAIL="${EMAIL:-}"
PORT_REQUESTED="${PORT:-}"
APP_DIR="${APP_DIR:-/opt/tiktokgg}"
REPO="${REPO:-https://github.com/hamamed/tiktokgg.git}"
BRANCH="${BRANCH:-main}"
PROXY="${PROXY:-auto}"
SERVICE="tiktokgg"
APP_USER="tiktokgg"
ENV_DIR="/etc/tiktokgg"
ENV_FILE="$ENV_DIR/env"
EXPECTED_IP="46.224.86.198"

c_ok()   { printf '\033[32m✔ %s\033[0m\n' "$*"; }
c_info() { printf '\033[36m➜ %s\033[0m\n' "$*"; }
c_warn() { printf '\033[33m⚠ %s\033[0m\n' "$*"; }
die()    { DIED=1; printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }
as_app() { runuser -u "$APP_USER" -- env HOME="$APP_DIR" "$@"; }
g()      { as_app git -c safe.directory="$APP_DIR" -C "$APP_DIR" "$@"; }

[[ $EUID -eq 0 ]] || die "Run as root (sudo)."
if command -v apt-get >/dev/null; then PKG=apt
elif command -v dnf >/dev/null; then PKG=dnf
else die "Unsupported OS: need apt (Debian/Ubuntu) or dnf (RHEL/Alma/Rocky)."; fi
pkg_install() { if [[ $PKG == apt ]]; then DEBIAN_FRONTEND=noninteractive apt-get install -y "$@" </dev/null; else dnf install -y "$@" </dev/null; fi; }

# --- 1. Tools: git, curl, Node.js (>= 20) --------------------------------------
command -v git >/dev/null && command -v curl >/dev/null || { [[ $PKG == apt ]] && apt-get update </dev/null; pkg_install git curl ca-certificates; }
node_major() { command -v node >/dev/null && node -p 'process.versions.node.split(".")[0]' || echo 0; }
if (( $(node_major) < 20 )); then
  c_info "Installing Node.js 22..."
  if [[ $PKG == apt ]]; then curl -fsSL https://deb.nodesource.com/setup_22.x | bash - </dev/null; else curl -fsSL https://rpm.nodesource.com/setup_22.x | bash - </dev/null; fi
  pkg_install nodejs
fi
c_ok "Node $(node -v), git $(git --version | awk '{print $3}')"

# --- 2. App user + code from GitHub ---------------------------------------------
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"
if [[ -d "$APP_DIR/.git" ]]; then
  c_info "Updating code in $APP_DIR..."
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
  g fetch --quiet origin "$BRANCH"
  g reset --quiet --hard "origin/$BRANCH"
else
  [[ -z "$(ls -A "$APP_DIR" 2>/dev/null)" ]] || die "$APP_DIR exists and is not a git checkout. Move it away or set APP_DIR=..."
  c_info "Downloading $REPO ($BRANCH)..."
  chown "$APP_USER:$APP_USER" "$APP_DIR"
  as_app git clone --quiet --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
c_ok "Code: $(g log -1 --pretty='%h %s')"

# --- 3. Dependencies (only the small trigger server is needed on the VPS) ---------
c_info "Installing npm packages for express-server..."
( cd "$APP_DIR/express-server" && as_app npm ci --omit=dev --no-audit --no-fund --loglevel=error </dev/null )
c_ok "Packages installed"

# --- 4. Access token (kept across updates) ------------------------------------------
mkdir -p "$ENV_DIR"
chmod 750 "$ENV_DIR"
TOKEN=""
[[ -f "$ENV_FILE" ]] && TOKEN="$(sed -n 's/^WS_TOKEN=//p' "$ENV_FILE" | head -1)"
if [[ -z "$TOKEN" || "${NEW_TOKEN:-0}" == "1" ]]; then
  TOKEN="$(node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))")"
  c_ok "New access token generated"
fi

# --- 5. Internal port: localhost only, never a port another program uses -----------
port_free() { node -e "const s=require('net').createServer();s.once('error',()=>process.exit(1));s.listen($1,'127.0.0.1',()=>s.close(()=>process.exit(0)))"; }
public_port_free() { node -e "const s=require('net').createServer();s.once('error',()=>process.exit(1));s.listen($1,'0.0.0.0',()=>s.close(()=>process.exit(0)))"; }
OUR_PORT="$(sed -n 's/^PORT=//p' "$ENV_FILE" 2>/dev/null | head -1 || true)"
if [[ -n "$PORT_REQUESTED" ]]; then
  PORT="$PORT_REQUESTED"
  [[ "$PORT" == "$OUR_PORT" ]] || port_free "$PORT" || die "Port $PORT is used by another program. Pick another: PORT=xxxx"
elif [[ -n "$OUR_PORT" ]]; then PORT="$OUR_PORT"
else
  PORT=""
  for p in $(seq 3200 3299); do if port_free "$p"; then PORT="$p"; break; fi; done
  [[ -n "$PORT" ]] || die "No free port between 3200 and 3299. Set one: PORT=xxxx"
fi
c_ok "Internal port: 127.0.0.1:$PORT (not reachable from the internet)"

umask 077
cat > "$ENV_FILE" <<EOF
# tiktokgg settings, read by systemd (tiktokgg.service). Re-running install.sh keeps WS_TOKEN.
PORT=$PORT
HOST=127.0.0.1
WS_TOKEN=$TOKEN
ALLOWED_ORIGINS=https://$DOMAIN,http://$DOMAIN
NODE_ENV=production
EOF
umask 022
chown root:"$APP_USER" "$ENV_FILE"
chmod 640 "$ENV_FILE"

# --- 6. systemd service ----------------------------------------------------------
cat > /etc/systemd/system/$SERVICE.service <<EOF
[Unit]
Description=tiktokgg · TikTok LIVE Game Control ($DOMAIN)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR/express-server
EnvironmentFile=$ENV_FILE
# Writable home under /var/lib/tiktokgg (the rest of the filesystem is read-only for the service).
StateDirectory=$SERVICE
Environment=HOME=/var/lib/$SERVICE
ExecStart=$(command -v node) $APP_DIR/express-server/server.js
Restart=always
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1
systemctl restart "$SERVICE"
for _ in 1 2 3 4 5 6 7 8 9 10; do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 1; done
systemctl is-active --quiet "$SERVICE" || { journalctl -u "$SERVICE" -n 40 --no-pager; die "Service failed to start"; }
curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && c_ok "Server running on 127.0.0.1:$PORT" || c_warn "Server started but /health did not answer yet"

# --- 7. Reverse proxy + HTTPS (adds one site; your other sites are untouched) ---------
PANEL=""
[[ -d /usr/local/psa ]] && PANEL="Plesk"
[[ -d /usr/local/cpanel ]] && PANEL="cPanel"
[[ -d /www/server/panel ]] && PANEL="aaPanel"
[[ -d /home/clp ]] && PANEL="CloudPanel"
[[ -d /usr/local/CyberCP ]] && PANEL="CyberPanel"
[[ -d /usr/local/hestia ]] && PANEL="HestiaCP"
if [[ $PROXY == auto ]]; then
  if [[ -n $PANEL ]]; then PROXY=none
  elif systemctl is-active --quiet nginx 2>/dev/null; then PROXY=nginx
  elif systemctl is-active --quiet apache2 2>/dev/null || systemctl is-active --quiet httpd 2>/dev/null; then PROXY=apache
  elif systemctl is-active --quiet caddy 2>/dev/null || { public_port_free 80 && public_port_free 443; }; then PROXY=caddy
  else PROXY=none; fi
fi

SERVER_IP="$(curl -fsS4 --max-time 5 https://api.ipify.org 2>/dev/null || echo "$EXPECTED_IP")"
DNS_IP="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)"
DNS_OK=0
SUB="${DOMAIN%%.*}"
if [[ "$DNS_IP" == "$SERVER_IP" ]]; then DNS_OK=1; c_ok "DNS: $DOMAIN -> $DNS_IP"
else c_warn "DNS: $DOMAIN resolves to '${DNS_IP:-nothing}', this server is $SERVER_IP. Set ONE A record: $SUB -> $SERVER_IP (and delete any CNAME to github.io)"; fi

certbot_flags() { if [[ -n $EMAIL ]]; then echo "-m $EMAIL"; else echo "--register-unsafely-without-email"; fi; }
open_firewall() {
  if command -v ufw >/dev/null && ufw status | grep -q active; then ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; fi
  if command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then firewall-cmd --permanent --add-service=http --add-service=https >/dev/null; firewall-cmd --reload >/dev/null; fi
}

case $PROXY in
  nginx)
    c_info "Configuring nginx (one new site: $DOMAIN)..."
    CONF=/etc/nginx/conf.d/$DOMAIN.conf
    [[ -d /etc/nginx/sites-enabled ]] && CONF=/etc/nginx/sites-available/$DOMAIN.conf
    if [[ ! -f "$CONF" ]] || ! grep -q "listen 443" "$CONF"; then   # keep certbot's HTTPS edits on re-runs
      # The map variable name is unique ($tiktokgg_upgrade) so it can't clash with other sites' maps.
      cat > "$CONF" <<EOF
# tiktokgg: $DOMAIN -> 127.0.0.1:$PORT (dashboard + WebSocket /ws)
map \$http_upgrade \$tiktokgg_upgrade { default upgrade; '' close; }
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    client_max_body_size 1m;
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$tiktokgg_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }
}
EOF
    else
      sed -i "s#proxy_pass http://127.0.0.1:[0-9]*;#proxy_pass http://127.0.0.1:$PORT;#" "$CONF"
    fi
    [[ -d /etc/nginx/sites-enabled ]] && ln -sf "$CONF" /etc/nginx/sites-enabled/
    nginx -t || die "nginx config test failed; nothing reloaded. Check $CONF"
    systemctl reload nginx
    open_firewall
    if (( DNS_OK )) && ! grep -q "listen 443" "$CONF"; then
      command -v certbot >/dev/null || pkg_install certbot python3-certbot-nginx
      certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect $(certbot_flags) </dev/null && c_ok "HTTPS enabled"
    elif (( ! DNS_OK )); then c_warn "Skipped HTTPS. When DNS points here: certbot --nginx -d $DOMAIN --redirect"; fi
    ;;
  apache)
    c_info "Configuring Apache (one new site: $DOMAIN)..."
    if [[ $PKG == apt ]]; then a2enmod proxy proxy_http proxy_wstunnel rewrite headers >/dev/null; CONF=/etc/apache2/sites-available/$DOMAIN.conf; SVC=apache2
    else CONF=/etc/httpd/conf.d/$DOMAIN.conf; SVC=httpd; fi
    if [[ ! -f "$CONF" ]]; then
      cat > "$CONF" <<EOF
# tiktokgg: $DOMAIN -> 127.0.0.1:$PORT (dashboard + WebSocket /ws)
<VirtualHost *:80>
    ServerName $DOMAIN
    ProxyPreserveHost On
    ProxyTimeout 3600
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} =websocket [NC]
    RewriteRule /(.*) ws://127.0.0.1:$PORT/\$1 [P,L]
    ProxyPass / http://127.0.0.1:$PORT/
    ProxyPassReverse / http://127.0.0.1:$PORT/
</VirtualHost>
EOF
    else
      sed -i "s#127.0.0.1:[0-9]*/#127.0.0.1:$PORT/#g" "$CONF"
    fi
    [[ $PKG == apt ]] && a2ensite "$DOMAIN" >/dev/null
    systemctl reload "$SVC"
    open_firewall
    if (( DNS_OK )); then
      command -v certbot >/dev/null || pkg_install certbot python3-certbot-apache
      certbot --apache -d "$DOMAIN" --non-interactive --agree-tos --redirect $(certbot_flags) </dev/null && c_ok "HTTPS enabled"
    else c_warn "Skipped HTTPS. When DNS points here: certbot --apache -d $DOMAIN --redirect"; fi
    ;;
  caddy)
    c_info "Configuring Caddy (one new site: $DOMAIN)..."
    if ! command -v caddy >/dev/null; then
      if [[ $PKG == apt ]]; then
        pkg_install debian-keyring debian-archive-keyring apt-transport-https gnupg
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg --yes
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
        apt-get update </dev/null && pkg_install caddy
      else dnf install -y 'dnf-command(copr)' </dev/null && dnf copr enable -y @caddy/caddy </dev/null && pkg_install caddy; fi
    fi
    mkdir -p /etc/caddy/sites
    grep -q 'import sites/\*' /etc/caddy/Caddyfile 2>/dev/null || {
      if grep -q '^:80' /etc/caddy/Caddyfile 2>/dev/null; then echo 'import sites/*' > /etc/caddy/Caddyfile; else echo 'import sites/*' >> /etc/caddy/Caddyfile; fi
    }
    printf '%s {\n    encode gzip\n    reverse_proxy 127.0.0.1:%s\n}\n' "$DOMAIN" "$PORT" > /etc/caddy/sites/$DOMAIN.caddy
    open_firewall
    systemctl enable caddy >/dev/null 2>&1
    systemctl reload caddy 2>/dev/null || systemctl restart caddy
    c_ok "Caddy configured (HTTPS is issued automatically once DNS points here)."
    ;;
  none|*)
    c_warn "Reverse proxy NOT configured automatically${PANEL:+ (detected $PANEL)}."
    cat <<EOF

  In your hosting panel, for the subdomain $DOMAIN:
    1. Enable SSL (Let's Encrypt).
    2. Add a reverse proxy to:  http://127.0.0.1:$PORT
       with WebSocket support (Upgrade/Connection headers) and a long read timeout.
EOF
    ;;
esac

# --- 8. Summary --------------------------------------------------------------------
echo
c_ok "Installed: $(g log -1 --pretty='%h')"
echo "   Dashboard      : https://$DOMAIN/?token=$TOKEN"
echo "                    (opening this link once saves the token in the browser)"
echo "   Game WebSocket : wss://$DOMAIN/ws?token=$TOKEN"
echo "   Access token   : $TOKEN   (new one: sudo NEW_TOKEN=1 bash $APP_DIR/deploy/install.sh)"
echo "   Update         : sudo bash $APP_DIR/deploy/update.sh"
echo "   Logs           : journalctl -u $SERVICE -f"
}

main "$@"
