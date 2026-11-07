#!/bin/zsh
# Start only Paper2Lab services; never kill a listener owned by another app.
set -eu
cd "$(dirname "$0")/.."
api_port=${PAPER2LAB_API_PORT:-8787}
web_port=${PAPER2LAB_WEB_PORT:-5173}
for port in "$api_port" "$web_port"; do
  if [[ "$port" != <-> ]] || (( port < 1024 || port > 65535 )); then
    print -u2 'Ports must be integers between 1024 and 65535'; exit 1
  fi
done
command -v tmux >/dev/null || { print -u2 'tmux missing'; exit 1; }
api="http://127.0.0.1:$api_port"
web="http://127.0.0.1:$web_port"
api_ok() {
  curl -fsS -m 3 "$api/openapi.json" 2>/dev/null |
    node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{process.exit(JSON.parse(s).info.title==="Paper2Lab backend"?0:1)}catch{process.exit(1)}})'
}
web_ok() {
  curl -fsS -m 3 "$web/src/main.tsx" 2>/dev/null | rg -q 'RenderTestRoute' || return 1
  curl -fsS -m 3 "$web/api/agent/health" 2>/dev/null |
    node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{process.exit(typeof JSON.parse(s).backend==="string" && typeof JSON.parse(s).provider?.provider==="string"?0:1)}catch{process.exit(1)}})'
}
# Fail visibly on an occupied port, even if its unrelated health endpoint is 200.
if ! api_ok; then
  if lsof -nP -iTCP:$api_port -sTCP:LISTEN >/dev/null 2>&1; then
    print -u2 "Port $api_port is not a Paper2Lab API. Choose PAPER2LAB_API_PORT; no process was stopped."; exit 1
  fi
  tmux new-session -d -s "p2l-api-$api_port" -c "$PWD" \
    "exec server/.venv/bin/uvicorn server.main:app --host 127.0.0.1 --port $api_port > /tmp/p2l-api-$api_port.log 2>&1"
  for i in {1..30}; do api_ok && break; sleep 1; done
  api_ok || { print -u2 "API not ready; see /tmp/p2l-api-$api_port.log"; exit 1; }
fi
if ! web_ok; then
  if lsof -nP -iTCP:$web_port -sTCP:LISTEN >/dev/null 2>&1; then
    print -u2 "Port $web_port is not a Paper2Lab Vite server. Choose PAPER2LAB_WEB_PORT."; exit 1
  fi
  tmux new-session -d -s "p2l-web-$web_port" -c "$PWD" \
    "PAPER2LAB_API_PORT=$api_port pnpm exec vite --host 127.0.0.1 --port $web_port --strictPort > /tmp/p2l-web-$web_port.log 2>&1"
  for i in {1..15}; do web_ok && break; sleep 1; done
  web_ok || { print -u2 "Web not ready; see /tmp/p2l-web-$web_port.log"; exit 1; }
fi
print "Paper2Lab: $web · API: $api"
print 'Use 精读定位 for local Docling; AI requires server-side provider configuration.'
