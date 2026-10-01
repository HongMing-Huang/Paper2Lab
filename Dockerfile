# Paper2Lab 0.1 — single-origin production image
# Stage 1: build the frontend (vite) → dist/
# Stage 2: python runtime (docling + agentscope + fastapi) serving the API
#          and the built SPA from one origin (server/main.py mounts dist/).
#
# Build:  docker build -t paper2lab:0.1 .
# Run:    docker run -p 8787:8787 -e DASHSCOPE_API_KEY=... paper2lab:0.1
# Verify: curl -s localhost:8787/api/ready && curl -s -o /dev/null -w '%{http_code}\n' localhost:8787/

FROM node:22-slim AS web
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM python:3.12-slim AS api
WORKDIR /app
# torch cpu wheels keep the image smaller than the cuda default
ENV PIP_NO_CACHE_DIR=1
COPY server/requirements.txt server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt \
    --extra-index-url https://download.pytorch.org/whl/cpu || \
    pip install --no-cache-dir -r server/requirements.txt
COPY server/ server/
COPY --from=web /app/dist/ dist/
COPY public/ public/
ENV PAPER2LAB_DATA_DIR=/app/data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s \
  CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8787/api/health')" || exit 1
CMD ["uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "8787"]
