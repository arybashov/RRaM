#!/usr/bin/env bash
# Установка self-hosted GitHub Actions runner на VPS (RRaM).
# Запуск ОДНОЙ командой (registration-token — первым аргументом):
#   curl -sL https://raw.githubusercontent.com/arybashov/RRaM/main/server-prototype/deploy/setup-runner.sh | bash -s <TOKEN>
set -euo pipefail

TOKEN="${1:?Передайте registration-token первым аргументом}"
VER="2.335.0"
DIR="/opt/actions-runner"
REPO_URL="https://github.com/arybashov/RRaM"

mkdir -p "$DIR"
cd "$DIR"

if [ ! -f ./config.sh ]; then
  echo "→ Скачиваю runner v${VER}…"
  curl -o runner.tar.gz -L "https://github.com/actions/runner/releases/download/v${VER}/actions-runner-linux-x64-${VER}.tar.gz"
  tar xzf runner.tar.gz
  rm -f runner.tar.gz
fi

export RUNNER_ALLOW_RUNASROOT=1

# Снять прежний сервис, если переустанавливаем
./svc.sh stop 2>/dev/null || true
./svc.sh uninstall 2>/dev/null || true

echo "→ Регистрирую runner (метка rram-vps)…"
./config.sh --url "$REPO_URL" --token "$TOKEN" \
  --labels rram-vps --name rram-vps --unattended --replace

echo "→ Ставлю как systemd-сервис…"
./svc.sh install
./svc.sh start
sleep 2
./svc.sh status || true

echo
echo "✅ Runner установлен. Проверь в GitHub: Settings → Actions → Runners (rram-vps / Idle)."
