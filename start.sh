#!/usr/bin/env bash
# ============================================================
#  LaserCut Studio — запуск на Ubuntu / Linux / macOS
#  chmod +x start.sh && ./start.sh
#  Нужен Node.js 18+
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  cat <<'MSG'
[ошибка] Не найден Node.js.

Ubuntu / Debian:
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs

или через nvm:
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  nvm install 20
MSG
  exit 1
fi

echo "Node.js $(node -v)"

if [ ! -d node_modules ]; then
  echo "Устанавливаю зависимости (один раз)..."
  npm install
fi

echo "Собираю приложение..."
npm run build

export PORT="${PORT:-8084}"

cat <<MSG

============================================================
  LaserCut Studio: http://localhost:${PORT}
  Остановить: Ctrl+C
============================================================

MSG

# открыть браузер, если есть чем
if command -v xdg-open >/dev/null 2>&1; then
  ( sleep 1; xdg-open "http://localhost:${PORT}" >/dev/null 2>&1 || true ) &
elif command -v open >/dev/null 2>&1; then
  ( sleep 1; open "http://localhost:${PORT}" >/dev/null 2>&1 || true ) &
fi

exec npm run serve
