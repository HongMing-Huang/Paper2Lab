#!/bin/zsh
# ModelScope image container smoke — REAL chain checks on port 7860:
#   1. /api/health + /api/ready (engine booted inside the container)
#   2. /api/engine/execute mujoco.simulate — wasm physics IN-CONTAINER
#   3. SPA + same-origin MuJoCo wasm asset served
#   4. /mnt/workspace persistence across a container restart (session file)
# Usage: ./scripts/ms-container-smoke.sh [image-tag]
set -u
IMG="${1:-paper2lab:0.1-ms}"
# image tags are strict docker names only — no shell metacharacters ever
if [[ ! "$IMG" =~ ^[A-Za-z0-9._/-]+:[A-Za-z0-9._-]+$ && ! "$IMG" =~ ^[A-Za-z0-9._/-]+$ ]]; then
  print -- "FAIL: image tag must be a plain docker reference: $IMG"; exit 1
fi
PORT=17860
DATA=$(mktemp -d /tmp/p2l-ms-data.XXXXXX)
fail=0
say() { print -- "$*" }

say "== run container (mount $DATA -> /mnt/workspace) =="
docker rm -f p2l-ms-smoke >/dev/null 2>&1
docker run -d --name p2l-ms-smoke -p 127.0.0.1:${PORT}:7860 -v "${DATA}:/mnt/workspace" "$IMG" >/dev/null || { say "FAIL: run"; exit 1 }

for i in {1..60}; do
  curl -sf -m 3 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 && break
  sleep 3
done
curl -sf -m 5 "http://127.0.0.1:${PORT}/api/health" >/dev/null || { say "FAIL: health never came up"; docker logs p2l-ms-smoke | tail -20; fail=1 }

say "-- health:  $(curl -s -m 5 http://127.0.0.1:${PORT}/api/health)"
READY=$(curl -s -m 60 http://127.0.0.1:${PORT}/api/ready)
say "-- ready:   $(print -- "$READY" | head -c 220)"
print -- "$READY" | grep -q '"ready": *true' || fail=1

say "-- engine mujoco (in-container wasm physics)"
MJ=$(curl -s -m 120 -X POST "http://127.0.0.1:${PORT}/api/engine/execute" \
  -H 'content-type: application/json' \
  -d '{"skill":"mujoco.simulate","input":{"scene":"simple.xml","steps":100,"sampleEvery":50},"planId":"p-smoke"}')
say "   $(print -- "$MJ" | head -c 260)"
print -- "$MJ" | grep -q '"status":"ok"' || fail=1
print -- "$MJ" | grep -q '"engine":"mujoco-wasm"' || fail=1

say "-- SPA + wasm same-origin"
SPA=$(curl -s -o /dev/null -w '%{http_code}' -m 20 "http://127.0.0.1:${PORT}/")
WASM=$(curl -s -o /dev/null -w '%{http_code}' -m 20 "http://127.0.0.1:${PORT}/assets/mujoco/mujoco.wasm")
say "   / -> $SPA ; /assets/mujoco/mujoco.wasm -> $WASM"
[[ "$SPA" == 200 ]] || fail=1
[[ "$WASM" == 200 ]] || fail=1

say "-- write session state into /mnt/workspace (server-mode agent turn)"
TURN_PAYLOAD=$(cat <<'JSON'
{"sessionId":"ms-smoke","intent":"把重力设为 -3","context":{"deskKind":"mujoco","execution":"server","params":["gravityZ"],"base":{"scene":"simple.xml","steps":100,"sampleEvery":50,"params":{"gravityZ":-9.81}}}}
JSON
)
TURN=$(curl -sN -m 180 -X POST "http://127.0.0.1:${PORT}/api/agent/turn" \
  -H 'content-type: application/json' \
  --data-binary "$TURN_PAYLOAD")
say "   turn tail: $(print -- "$TURN" | tail -c 220)"
SESS_HOST=$(ls "$DATA"/agent-session-ms-smoke.json 2>/dev/null)
[[ -n "$SESS_HOST" ]] || fail=1
say "   session file on host mount: ${SESS_HOST:-MISSING}"

say "-- Lane E: engine runs survive restart and CONTINUE (read original run, fork it)"
# record a real run BEFORE restart
PRE=$(curl -s -m 120 -X POST "http://127.0.0.1:${PORT}/api/engine/execute" \
  -H 'content-type: application/json' \
  -d '{"skill":"formula.plot","input":{"expression":["Multiply","a",["Sin","x"]],"parameters":["a","x"],"values":{"a":1,"x":0},"independent":"x","range":[-7,7],"samples":61},"planId":"p-pre"}')
PRE_ID=$(print -- "$PRE" | python3 -c "import json,sys;print(json.load(sys.stdin)['outcome']['run']['runId'])")
say "   pre-restart run: $PRE_ID"

say "-- restart container; state must survive"
docker rm -f p2l-ms-smoke >/dev/null 2>&1
docker run -d --name p2l-ms-smoke -p 127.0.0.1:${PORT}:7860 -v "${DATA}:/mnt/workspace" "$IMG" >/dev/null
for i in {1..60}; do curl -sf -m 3 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 && break; sleep 3; done
[[ -f "$DATA/agent-session-ms-smoke.json" ]] || fail=1
say "   after restart, session file still present: $(ls "$DATA"/agent-session-ms-smoke.json 2>/dev/null || echo MISSING)"

# the ORIGINAL run must still be resolvable in the restarted engine, and a
# FORK of it must execute — the experiment CONTINUES, not just files exist
POST=$(curl -s -m 120 -X POST "http://127.0.0.1:${PORT}/api/agent/turn" \
  -H 'content-type: application/json' \
  -d "{\"sessionId\":\"ms-smoke-cont\",\"intent\":\"把 a 加倍\",\"context\":{\"deskKind\":\"formula\",\"execution\":\"server\",\"params\":[\"a\"],\"baseRunId\":\"$PRE_ID\"}}" )
CONT_ID=$(print -- "$POST" | grep -o '"targetRunId": *"[^"]*"' | head -1 | sed 's/.*: *"//;s/"$//')
say "   continue-from-run target: ${CONT_ID:-MISSING}"
[[ -n "$CONT_ID" ]] || fail=1

docker rm -f p2l-ms-smoke >/dev/null 2>&1
rm -rf "$DATA"
if [[ $fail -eq 0 ]]; then say "PASS: ModelScope container smoke ($IMG)"; else say "FAIL: see above"; exit 1; fi
