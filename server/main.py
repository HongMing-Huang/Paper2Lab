"""Paper2Lab ingestion backend: POST /api/ingest (multipart pdf) → Docling JSON.

Run:  server/.venv/bin/uvicorn server.main:app --port 8787
Vite dev server proxies /api → 127.0.0.1:8787 (vite.config.ts).
"""
from __future__ import annotations

import os
import tempfile
import threading

from fastapi import FastAPI, File, HTTPException, UploadFile

from server.ingest_core import convert_pdf

app = FastAPI(title="Paper2Lab ingestion", version="0.1")

# Docling models are heavy and not thread-safe → serialize conversions
_convert_lock = threading.Lock()


@app.get("/api/health")
def health() -> dict:
    import docling

    return {"ok": True, "engine": "docling", "version": getattr(docling, "__version__", "?")}


@app.post("/api/ingest")
def ingest(file: UploadFile = File(...)) -> dict:
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="only PDF is supported in 0.1")
    suffix = os.path.splitext(file.filename)[1]
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(file.file.read())
        tmp_path = tmp.name
    try:
        with _convert_lock:
            result = convert_pdf(tmp_path, title_hint=os.path.splitext(file.filename)[0])
    except Exception as exc:  # noqa: BLE001 — surface parser errors to the client
        raise HTTPException(status_code=422, detail=f"docling failed: {exc}") from exc
    finally:
        os.unlink(tmp_path)
    return result
