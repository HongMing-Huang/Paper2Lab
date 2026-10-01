#!/bin/zsh
# Ensure the dev stack (vite + docling server) is up — the local sandbox
# reaps long-running background processes between tool calls, so call this
# before each verification round. Idempotent.
cd "$(dirname "$0")/.."

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux missing" >&2
  exit 1
fi

up() { curl -s -m 3 -o /dev/null "$1" 2>/dev/null }

if ! up http://127.0.0.1:8787/api/health; then
  tmux kill-session -t p2l-api 2>/dev/null
  tmux new-session -d -s p2l-api \
    'while true; do server/.venv/bin/uvicorn server.main:app --host 127.0.0.1 --port 8787 >> /tmp/uvicorn.log 2>&1; sleep 2; done'
  for i in {1..20}; do up http://127.0.0.1:8787/api/health && break; sleep 1; done
fi

if ! up http://localhost:5173/; then
  tmux kill-session -t p2l-web 2>/dev/null
  tmux new-session -d -s p2l-web \
    'while true; do npx vite --port 5173 --strictPort >> /tmp/vite.log 2>&1; sleep 2; done'
  for i in {1..20}; do up http://localhost:5173/ && break; sleep 1; done
fi

echo "api: $(curl -s -m 3 http://127.0.0.1:8787/api/health)"
echo "web: $(curl -s -m 3 -o /dev/null -w '%{http_code}' http://localhost:5173/)"
