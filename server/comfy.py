"""ComfyUI asset generation (Lane E) — external task API client.

Assets are PRESENTATIONAL, never scientific evidence: every generated asset is
stamped kind="AIGENERATED" and stored with its ComfyUI prompt id + graph
checksum, so nothing it produces can masquerade as a CALCULATED ExperimentRun.

Hardening (Mimosa constraints):
  * endpoint ONLY from PAPER2LAB_COMFY_URL / PAPER2LAB_COMFY_TOKEN env — no
    literals anywhere, missing config = explicit unavailable
  * http/https only; host validated before any request; loopback/private/
    reserved addresses rejected (public ComfyUI endpoints only)
"""
from __future__ import annotations

import hashlib
import ipaddress
import json
import os
import socket
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

ASSET_KIND = "AIGENERATED"
_TIMEOUT = httpx.Timeout(30.0, read=180.0)


class ComfyUnavailable(RuntimeError):
    """raised when ComfyUI is not configured (the honest answer)"""


def _validate_public_https_url(url: str) -> None:
    u = urlparse(url)
    if u.scheme not in ("http", "https"):
        raise ComfyUnavailable(f"ComfyUI endpoint must be http/https: {u.scheme!r}")
    host = u.hostname or ""
    if not host:
        raise ComfyUnavailable("ComfyUI endpoint has no host")
    try:
        infos = socket.getaddrinfo(host, u.port or (443 if u.scheme == "https" else 80), proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise ComfyUnavailable(f"ComfyUI host does not resolve: {host}") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_loopback or ip.is_private or ip.is_reserved or ip.is_link_local or ip.is_unspecified:
            raise ComfyUnavailable("ComfyUI endpoint must be a public host (loopback/private/reserved rejected)")


class ComfyClient:
    """Minimal ComfyUI task-API client: submit prompt → poll history → fetch outputs."""

    def __init__(self) -> None:
        base = os.environ.get("PAPER2LAB_COMFY_URL", "").rstrip("/")
        token = os.environ.get("PAPER2LAB_COMFY_TOKEN", "")
        if not base:
            raise ComfyUnavailable("ComfyUI not configured (set PAPER2LAB_COMFY_URL; optional PAPER2LAB_COMFY_TOKEN)")
        _validate_public_https_url(base)
        self._base = base
        self._headers = {"Authorization": f"Bearer {token}"} if token else {}

    def _url(self, path: str) -> str:
        return f"{self._base}{path}"

    def generate(self, graph: dict[str, Any], *, prompt: str | None = None) -> dict[str, Any]:
        """submit a ComfyUI graph, wait for completion, download the outputs.

        Returns {assetIds, files, promptId, graphSha256, kind} — the asset
        records live in DATA_DIR/assets/index.json for traceability."""
        client_id = uuid.uuid4().hex
        graph_sha = hashlib.sha256(json.dumps(graph, sort_keys=True).encode()).hexdigest()[:16]
        with httpx.Client(timeout=_TIMEOUT, headers=self._headers) as http:
            r = http.post(
                self._url("/prompt"),
                json={"prompt": graph, "client_id": client_id},
            )
            r.raise_for_status()
            prompt_id = r.json()["prompt_id"]

            deadline = time.monotonic() + 240.0
            outputs: dict[str, Any] | None = None
            while time.monotonic() < deadline:
                h = http.get(self._url(f"/history/{prompt_id}"))
                h.raise_for_status()
                entry = h.json().get(prompt_id)
                if entry:
                    outputs = entry.get("outputs")
                    break
                time.sleep(2.0)
            if outputs is None:
                raise TimeoutError(f"ComfyUI prompt {prompt_id} did not finish in 240s")

            assets_dir = Path(os.environ.get("PAPER2LAB_DATA_DIR", "server/data")) / "assets"
            assets_dir.mkdir(parents=True, exist_ok=True)
            files: list[str] = []
            for node_out in outputs.values():
                for img in node_out.get("images", []):
                    sub = img.get("subfolder", "")
                    fname = img["filename"]
                    view = http.get(
                        self._url("/view"),
                        params={"filename": fname, "subfolder": sub, "type": img.get("type", "output")},
                    )
                    view.raise_for_status()
                    asset_id = f"asset-{uuid.uuid4().hex[:10]}"
                    dest = assets_dir / f"{asset_id}{Path(fname).suffix or '.png'}"
                    dest.write_bytes(view.content)
                    files.append(dest.name)
                    _append_index(
                        assets_dir,
                        {
                            "assetId": asset_id,
                            "file": dest.name,
                            "kind": ASSET_KIND,
                            "comfyPromptId": prompt_id,
                            "graphSha256": graph_sha,
                            "prompt": prompt,
                            "bytes": len(view.content),
                        },
                    )
            return {"assetFiles": files, "promptId": prompt_id, "graphSha256": graph_sha, "kind": ASSET_KIND}


def _append_index(assets_dir: Path, record: dict[str, Any]) -> None:
    index = assets_dir / "index.json"
    rows: list[dict[str, Any]] = []
    if index.exists():
        try:
            rows = json.loads(index.read_text())
        except ValueError:
            rows = []
    rows.append(record)
    index.write_text(json.dumps(rows, ensure_ascii=False, indent=1))


def comfy_configured() -> bool:
    return bool(os.environ.get("PAPER2LAB_COMFY_URL"))


# ---------------------------------------------------------------- API routes
from fastapi import APIRouter, HTTPException  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

router = APIRouter(prefix="/api/assets", tags=["assets"])


class GenerateBody(BaseModel):
    graph: dict[str, Any] = Field(default_factory=dict)
    prompt: str | None = Field(default=None, max_length=2000)


@router.post("/generate")
def generate(body: GenerateBody) -> dict[str, Any]:
    """submit a ComfyUI graph → wait → assets land in DATA_DIR/assets (kind
    AIGENERATED). Not configured → 503 with the honest reason."""
    if not comfy_configured():
        raise HTTPException(status_code=503, detail="asset generation not configured (PAPER2LAB_COMFY_URL)")
    try:
        client = ComfyClient()
        return client.generate(body.graph, prompt=body.prompt)
    except ComfyUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except (httpx.HTTPError, TimeoutError) as exc:
        raise HTTPException(status_code=502, detail=f"ComfyUI request failed: {exc}") from exc


@router.get("/status")
def status() -> dict[str, Any]:
    return {"configured": comfy_configured(), "kind": ASSET_KIND}
