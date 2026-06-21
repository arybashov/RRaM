#!/usr/bin/env bash
# Деплой веб-клиента и серверного движка RRaM на VPS.
# Запускать на сервере под root: bash /root/rram/server-prototype/deploy/deploy-web.sh
set -euo pipefail

REPO=/root/rram
WEBROOT=/var/www/rram

cd "$REPO"
git pull

# Версия сборки должна совпадать в constants.js / game.js / index.html, иначе
# у игроков «не обновляется клиент». Падаем ДО выкладки, если разъехалось.
node "$REPO/server-prototype/scripts/check-version.mjs"

# Клиент → веб-корень nginx (вне /root, чтобы www-data имел доступ)
mkdir -p "$WEBROOT"
cp -rf "$REPO/prototype-web/." "$WEBROOT/"

# Сервер: зависимости + перезапуск под PM2
cd "$REPO/server-prototype"
if ! command -v make >/dev/null 2>&1; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y build-essential python3
fi
npm ci
pm2 restart rram --update-env || HOST=0.0.0.0 PORT=8787 pm2 start src/index.js --name rram
pm2 save

# nginx-конфиг из репозитория
cp "$REPO/server-prototype/deploy/nginx-rram.conf" /etc/nginx/sites-available/rram.conf
ln -sf /etc/nginx/sites-available/rram.conf /etc/nginx/sites-enabled/rram.conf
nginx -t && systemctl reload nginx

echo "Deployed: https://rram.com.ru/"
