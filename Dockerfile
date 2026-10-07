# Paper2Lab 0.1 — single-origin production image (ModelScope Studio layout)
#
# Serves the built SPA + the FastAPI backend + the Node scientific engine
# (unified executor incl. MuJoCo WASM) from ONE origin on port 7860.
# Only /mnt/workspace persists on ModelScope — all run/job/session state
# goes there via PAPER2LAB_DATA_DIR.
#
# Build:  docker build -t paper2lab:0.1-ms .
# Run:    docker run -p 7860:7860 -v $(pwd)/data:/mnt/workspace paper2lab:0.1-ms
# Verify: curl -s localhost:7860/api/health && curl -s localhost:7860/api/ready

# ---- Stage 1: frontend bundle (vite) --------------------------------------
FROM node:22-slim AS web
WORKDIR /app
# registry.npmjs.org egress is unreliable from many build hosts — the
# npmmirror fallback serves the SAME integrity-pinned tarballs
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
COPY package.json pnpm-lock.yaml ./
# pin pnpm to the version the lockfile was written by (corepack default is newer)
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate \
  && (pnpm install --frozen-lockfile || pnpm install --frozen-lockfile --registry=https://registry.npmmirror.com)
COPY . .
RUN pnpm build

# ---- Stage 2: production node_modules for the engine (no browser deps) ----
# tsx is a RUNTIME dependency (the engine runs `node --import tsx` as a
# fallback); the primary engine artifact is a PREBUILT esbuild bundle —
# plain node boots it in <1s, no transpile (weak-cloud-CPU 504 root cause).
FROM node:22-slim AS engine-deps
WORKDIR /app
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
COPY package.json pnpm-lock.yaml ./
COPY src/ src/
COPY scripts/engine_server.ts scripts/engine_persist.ts /tmp/bundle-src/
# entry lives INSIDE /app so ../src relative imports resolve during bundling
RUN mkdir -p /app/bundle-entry \
  && cp /tmp/bundle-src/engine_server.ts /tmp/bundle-src/engine_persist.ts /app/bundle-entry/
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate \
  && pnpm install --frozen-lockfile \
  && ./node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/bin/esbuild \
       /app/bundle-entry/engine_server.ts \
       --bundle --packages=external --platform=node --format=esm \
       --outfile=/tmp/engine_server.bundle.mjs --log-level=warning \
  && mkdir -p scripts && cp /tmp/engine_server.bundle.mjs scripts/engine_server.bundle.mjs \
  && pnpm install --frozen-lockfile --prod \
  && pnpm store prune

# ---- Stage 3: python + node single-origin runtime --------------------------
FROM python:3.12-slim AS api
WORKDIR /app
# torch cpu wheels keep the image smaller than the cuda default
ENV PIP_NO_CACHE_DIR=1
COPY server/requirements.txt server/requirements.txt
# pypi egress can time out on build hosts — retry, then fall back to the
# aliyun mirror (same packages; torch still from the cpu index)
RUN pip install --no-cache-dir --timeout 120 --retries 5 -r server/requirements.txt \
    --extra-index-url https://download.pytorch.org/whl/cpu || \
    pip install --no-cache-dir --timeout 120 --retries 5 \
    -i https://mirrors.aliyun.com/pypi/simple/ \
    --extra-index-url https://download.pytorch.org/whl/cpu \
    -r server/requirements.txt

# node binary (static) + the engine's production node_modules (cortex,
# @mujoco/mujoco wasm, …) and the PREBUNDLED engine (bridge prefers
# engine_server.bundle.mjs; falls back to tsx when absent)
COPY --from=node:22-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=engine-deps /app/node_modules/ node_modules/
COPY --from=engine-deps /app/scripts/engine_server.bundle.mjs scripts/engine_server.bundle.mjs

# backend + engine sources
COPY server/ server/
COPY tsconfig.json ./

# built SPA + static papers; MuJoCo wasm served same-origin for the page
COPY --from=web /app/dist/ dist/
COPY public/ public/
RUN mkdir -p dist/assets/mujoco public/assets/mujoco \
  && cp node_modules/@mujoco/mujoco/mujoco.wasm dist/assets/mujoco/mujoco.wasm \
  && cp node_modules/@mujoco/mujoco/mujoco.wasm public/assets/mujoco/mujoco.wasm

# ModelScope Studio: listen on 7860 (8080 is platform-reserved); the only
# persistent path is /mnt/workspace — all job/doc/session state lives there
ENV PAPER2LAB_DATA_DIR=/mnt/workspace
# weak/shared CPUs need a long engine cold-boot window (tsx+wasm) and roomy
# request timeouts — the lifespan warmup covers the boot at deploy time
ENV PAPER2LAB_ENGINE_BOOT_TIMEOUT=300 \
    PAPER2LAB_ENGINE_TIMEOUT=600
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s \
  CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:7860/api/health')" || exit 1
CMD ["uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "7860"]
