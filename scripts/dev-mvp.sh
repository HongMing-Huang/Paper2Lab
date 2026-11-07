#!/bin/zsh
# MVP launcher (CLI-151 step 1): Python parse backend + Node science/research
# backend + Vite dev server, each with an identity CHECK — an HTTP 200 from the
# wrong process is a hard failure. Never kills a listener owned by another app;
# reuses ports already verified as ours.
#
#   zsh scripts/dev-mvp.sh                # defaults: 8788 / 8790 / 5178
#   PAPER2LAB_API_PORT=8791 ... override
set -eu
cd "$(dirname "$0")/.."
api_port=${PAPER2LAB_API_PORT:-8788}
node_port=${PAPER2LAB_NODE_PORT:-8790}
web_port=${PAPER2LAB_WEB_PORT:-5178}
node_db=${PAPER2LAB_DATABASE_URL:-postgresql:///paper2lab_node_dev?host=/tmp}
command -v tmux >/dev/null || { print -u2 'tmux missing'; exit 1 }

api_ok()   { curl -fsS -m 3 "http://127.0.0.1:$api_port/openapi.json" 2>/dev/null | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{process.exit(JSON.parse(s).info.title==="Paper2Lab backend"?0:1)}catch{process.exit(1)}})' }
node_ok()  { curl -fsS -m 3 "http://127.0.0.1:$node_port/api/v1/science/health" 2>/dev/null | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const j=JSON.parse(s);process.exit(j.backend==="paper2lab-node-science"&&j.ok===true?0:1)}catch{process.exit(1)}})' }
web_ok()   {
  curl -fsS -m 3 "http://127.0.0.1:$web_port/src/main.tsx" 2>/dev/null | rg -q 'RenderTestRoute' || return 1
  curl -fsS -m 3 "http://127.0.0.1:$web_port/api/agent/health" 2>/dev/null | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{process.exit(typeof JSON.parse(s).backend==="string"?0:1)}catch{process.exit(1)}})' &&
  curl -fsS -m 3 "http://127.0.0.1:$web_port/api/v1/science/health" 2>/dev/null | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{process.exit(JSON.parse(s).backend==="paper2lab-node-science"?0:1)}catch{process.exit(1)}})'
}

claim_port() {
  local port=$1 what=$2
  if lsof -nP -iTCP:$port -sTCP:LISTEN >/dev/null 2>&1; then
    print -u2 "Port $port is occupied by a non-$what process. Choose another port; nothing was stopped."
    exit 1
  fi
}

# --- Python parse backend (Docling/VLM; serves /api/agent, /api/ingest) ---
if ! api_ok; then
  claim_port $api_port 'Paper2Lab API'
  tmux new-session -d -s "p2l-api-$api_port" -c "$PWD" \
    "exec server/.venv/bin/uvicorn server.main:app --host 127.0.0.1 --port $api_port > /tmp/p2l-api-$api_port.log 2>&1"
  for i in {1..40}; do api_ok && break; sleep 1; done
  api_ok || { print -u2 "API not ready; see /tmp/p2l-api-$api_port.log"; exit 1; }
fi

# --- Node science + research backend (owns /api/v1/**, port 8790) ---
if ! node_ok; then
  claim_port $node_port 'Paper2Lab Node science'
  tmux new-session -d -s "p2l-node-$node_port" -c "$PWD" \
    "PAPER2LAB_DATABASE_URL='$node_db' PAPER2LAB_NODE_PORT=$node_port exec node --import tsx server/node/main.ts > /tmp/p2l-node-$node_port.log 2>&1"
  for i in {1..40}; do node_ok && break; sleep 1; done
  node_ok || { print -u2 "Node backend not ready; see /tmp/p2l-node-$node_port.log"; exit 1; }
fi

# --- Vite dev server (proxies /api/v1 → Node, /api → Python) ---
if ! web_ok; then
  claim_port $web_port 'Paper2Lab Vite'
  tmux new-session -d -s "p2l-web-$web_port" -c "$PWD" \
    "PAPER2LAB_API_PORT=$api_port PAPER2LAB_NODE_PORT=$node_port pnpm exec vite --host 127.0.0.1 --port $web_port --strictPort > /tmp/p2l-web-$web_port.log 2>&1"
  for i in {1..30}; do web_ok && break; sleep 1; done
  web_ok || { print -u2 "Web not ready; see /tmp/p2l-web-$web_port.log"; exit 1; }
fi

print "Paper2Lab MVP: http://127.0.0.1:$web_port (研究控制台入口在首页)"
print "  · Python 解析后端  http://127.0.0.1:$api_port  (/openapi.json → Paper2Lab backend)"
print "  · Node 科学/研究后端 http://127.0.0.1:$node_port  (/api/v1/science/health → paper2lab-node-science)"
print "  · Vite 代理: /api/v1/* → $node_port, 其余 /api/* → $api_port"
print "AI 回合需 PAPER2LAB_QWEN_API_KEY（或 DASHSCOPE_API_KEY）；缺失时研究回合如实 blocked，不假 AI。"
