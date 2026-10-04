#!/usr/bin/env bash
# One-time setup for an Ubuntu 24.04 server (e.g. an AWS Lightsail instance).
# Installs Node 22 + Caddy, runs the terminal as a systemd service under
# BASE_PATH, and puts Caddy (automatic HTTPS) in front of it.
#
#   sudo ORIGIN_DOMAIN=mothership-origin.example.com ORIGIN_SECRET=... bash setup.sh
#
# ORIGIN_DOMAIN must already point at this server (DNS A record) so Caddy can get
# a certificate. ORIGIN_SECRET must match the X-Origin-Secret header your CDN
# (CloudFront) adds; anything else gets 403, so nobody can bypass the CDN.
set -euo pipefail

: "${ORIGIN_DOMAIN:?set ORIGIN_DOMAIN}"
: "${ORIGIN_SECRET:?set ORIGIN_SECRET}"
BASE_PATH="${BASE_PATH:-/mothership}"
REPO="${REPO:-https://github.com/shawnblakesley/mothership-terminal.git}"
APP_DIR=/opt/mothership
DATA_DIR=/var/lib/mothership

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg git debian-keyring debian-archive-keyring apt-transport-https

# 1 GB instances: add swap so the neural voice model can't OOM the box.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Node 22
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# Caddy
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y caddy
fi

# App
id mothership >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin mothership
if [ ! -d "$APP_DIR/.git" ]; then git clone "$REPO" "$APP_DIR"; fi
mkdir -p "$DATA_DIR"
chown -R mothership:mothership "$APP_DIR" "$DATA_DIR"
sudo -u mothership bash -c "cd $APP_DIR && npm ci --omit=dev"

cat > /etc/systemd/system/mothership.service <<EOF
[Unit]
Description=Mothership terminal
After=network-online.target
Wants=network-online.target

[Service]
User=mothership
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=BASE_PATH=$BASE_PATH
Environment=DATA_DIR=$DATA_DIR
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR $APP_DIR/node_modules
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

sed -e "s|{ORIGIN_DOMAIN}|$ORIGIN_DOMAIN|g" -e "s|{ORIGIN_SECRET}|$ORIGIN_SECRET|g" "$APP_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile
chmod 640 /etc/caddy/Caddyfile && chown root:caddy /etc/caddy/Caddyfile

systemctl daemon-reload
systemctl enable --now mothership
systemctl restart caddy

echo "Done. Health check: curl -s http://localhost:3000$BASE_PATH/healthz"
