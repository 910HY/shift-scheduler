#!/bin/sh
# Single public port for 渣板: FastAPI /api/* plus the Vite dist/ SPA.
# Render sets PORT (default 10000). One worker — OR-Tools is CPU and memory heavy.
set -eu
cd "$(dirname "$0")/.."
PORT="${PORT:-10000}"

if [ -x .venv/bin/gunicorn ]; then
  GUNICORN=".venv/bin/gunicorn"
elif command -v gunicorn >/dev/null 2>&1; then
  GUNICORN="gunicorn"
else
  echo "找不到 gunicorn。請先安裝 server/requirements-prod.txt。" >&2
  exit 1
fi

exec "$GUNICORN" server.app:app \
  -k uvicorn.workers.UvicornWorker \
  --bind "0.0.0.0:${PORT}" \
  --workers 1 \
  --timeout 180 \
  --graceful-timeout 30 \
  --access-logfile - \
  --error-logfile -
