#!/usr/bin/env bash
# Provision a fresh Ubuntu 22.04/24.04 EC2 instance to run the admin API.
#
#   scp -r backend ubuntu@<ip>:/tmp/backend
#   ssh ubuntu@<ip> 'sudo bash /tmp/backend/deploy/bootstrap.sh'
#
# Afterwards: fill in /opt/pl-admin-api/.env, then
#   sudo systemctl restart pl-admin-api
set -euo pipefail

APP_DIR=/opt/pl-admin-api
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOMAIN="${API_DOMAIN:-api.pratyushfitness.edastra.in}"

echo "==> packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates nginx
if ! command -v node >/dev/null || [[ "$(node -v)" != v2* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi

echo "==> service user"
id -u plapi &>/dev/null || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin plapi

echo "==> app -> $APP_DIR"
mkdir -p "$APP_DIR"
cp -r "$SRC_DIR"/{src,scripts,package.json} "$APP_DIR"/
[[ -f "$APP_DIR/.env" ]] || { cp "$SRC_DIR/.env.example" "$APP_DIR/.env"; echo "    wrote a template .env — fill it in"; }
cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund
chown -R plapi:plapi "$APP_DIR"
chmod 600 "$APP_DIR/.env"

echo "==> systemd"
cp "$SRC_DIR/deploy/pl-admin-api.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable pl-admin-api

echo "==> nginx"
sed "s/api\.pratyushfitness\.edastra\.in/$DOMAIN/" "$SRC_DIR/deploy/nginx.conf" > /etc/nginx/conf.d/pl-admin-api.conf
nginx -t && systemctl reload nginx

cat <<EOF

Done. Remaining steps:

  1. Point an A record for $DOMAIN at this instance's Elastic IP.
  2. Fill in the secrets:
       sudo -u plapi npm --prefix $APP_DIR run hash -- 'your-admin-password'
       sudo nano $APP_DIR/.env
  3. Start it:
       sudo systemctl restart pl-admin-api
       curl -s localhost:3005/health
  4. Get a certificate (the console is HTTPS, so the API must be too):
       sudo apt-get install -y certbot python3-certbot-nginx
       sudo certbot --nginx -d $DOMAIN

Security group: inbound 80 and 443 from anywhere, 22 from your IP only.
EOF
