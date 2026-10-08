#!/usr/bin/env python3
"""Pre-download the Docling models so PDF parsing NEVER touches the Hub.

Fixes the user-facing failure:
  docling failed: ConnectError: [Errno 101] Network is unreachable
  ... cannot find the appropriate snapshot folder ... on the local disk

Two modes:
  default          warm the standard HF cache (~/.cache/huggingface) by
                   building the converter + converting a tiny PDF
  --artifacts DIR  download INTO a portable artifacts dir; then export
                   DOCLING_ARTIFACTS_PATH=DIR (and PAPER2LAB_DOCLING_OFFLINE=1
                   to pin the workers offline) — what Docker/offline use.

Run inside the server venv:
  server/.venv/bin/python scripts/download_docling_models.py --artifacts /tmp/docling-artifacts
"""
from __future__ import annotations

import argparse
import os
import pathlib
import sys
import tempfile

REPO = pathlib.Path(__file__).resolve().parent.parent


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--artifacts", default=None, help="portable artifacts dir to populate")
    args = ap.parse_args()

    if args.artifacts:
        art = pathlib.Path(args.artifacts).resolve()
        art.mkdir(parents=True, exist_ok=True)
        # SINGLE mechanism (#43 hotfix): docling ≥2.13 pulls ALL its models
        # (layout-heron, tableformer, CodeFormula…) through the HF hub into
        # HF_HOME. Setting artifacts_path here would make docling look for a
        # manual layout INSIDE that dir and miss the hub-downloaded ones
        # (cloud repro: "Model 'docling-project/docling-layout-heron' not
        # found in artifacts"). So: warm ONE hub cache, point HF_HOME at it.
        os.environ["HF_HOME"] = str(art)
    else:
        art = None

    sys.path.insert(0, str(REPO))
    from server.ingest_core import convert_pdf, get_converter

    get_converter()  # builds the pipeline → pulls layout/tableformer/formula models
    # warm with a REAL, parseable PDF from the corpus so model loads and
    # layout+formula inference both actually run
    warm_pdf = REPO / "public" / "papers" / "fit-sine-fit.pdf"
    try:
        doc = convert_pdf(str(warm_pdf), title_hint="warmup")
        print(f"warm parse ok: {len(doc.get('items', []))} items")
    except Exception as exc:  # noqa: BLE001 — models still landed even if this parse hiccups
        print(f"warm convert note: {exc}")

    print("MODELS_WARM")
    if art is not None:
        hub = art / "hub"
        models = sorted(p.name for p in hub.glob("models--*")) if hub.exists() else []
        print(f"HF cache dir: {art} ({len(models)} models: {', '.join(models[:6])})")
        assert any("docling" in m for m in models), "docling models did not land in HF_HOME"
        print("export HF_HOME=" + str(art))
        print("export PAPER2LAB_DOCLING_OFFLINE=1   # workers never touch the Hub")
    else:
        print("HF cache warmed — parses now work offline after the first run.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
