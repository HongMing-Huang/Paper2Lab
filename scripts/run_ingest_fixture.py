#!/usr/bin/env python3
"""Regenerate the real-Docling fixture for the ingest tests:

    server/.venv/bin/python scripts/run_ingest_fixture.py

Runs the same conversion code path as the FastAPI server on the sample PDF
and writes src/ingest/fixtures/sample-harmonic.docling.json.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from server.ingest_core import convert_pdf  # noqa: E402


def main() -> None:
    out = convert_pdf(str(ROOT / "public" / "papers" / "sample-harmonic.pdf"))
    dest = ROOT / "src" / "ingest" / "fixtures" / "sample-harmonic.docling.json"
    dest.parent.mkdir(exist_ok=True)
    dest.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    formulas = [i for i in out["items"] if i["kind"] == "formula"]
    print(f"wrote {dest} · {len(out['items'])} items · {len(formulas)} formulas")
    for f in formulas:
        print("   formula:", f["latex"])


if __name__ == "__main__":
    main()
