"""Docling ingestion core: PDF → normalized JSON (page/bbox/kind/latex kept).

Shared by the FastAPI server (server/main.py) and the fixture generator
(scripts/run_ingest_fixture.py) so tests run against the same code path the
browser hits.
"""
from __future__ import annotations

import uuid
from typing import Any

from docling.document_converter import DocumentConverter, FormatOption, PdfFormatOption
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.datamodel.base_models import InputFormat

# docling label → client ItemKind (client keeps unknown → text)
KIND_MAP = {
    "title": "title",
    "section_header": "section_header",
    "paragraph": "text",
    "text": "text",
    "formula": "formula",
    "picture": "figure",
    "table": "table",
    "document_index": "table",
    "caption": "caption",
    "list_item": "list_item",
    "footnote": "footnote",
    "page_header": "text",
    "page_footer": "text",
    "code": "text",
}

_converter: DocumentConverter | None = None


def get_converter() -> DocumentConverter:
    global _converter
    if _converter is None:
        import os
        from pathlib import Path

        opts = PdfPipelineOptions()
        opts.do_formula_enrichment = True
        # offline deployments: a pre-populated artifacts dir means the
        # converter NEVER touches the Hub ("Network is unreachable" fix)
        artifacts = os.environ.get("DOCLING_ARTIFACTS_PATH") or os.environ.get(
            "PAPER2LAB_DOCLING_ARTIFACTS"
        )
        if artifacts:
            opts.artifacts_path = Path(artifacts)
        _converter = DocumentConverter(
            format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)}
        )
    return _converter


def _ocr_probe() -> str:
    """minimal RapidOCR run on a tiny synthetic image — returns its failure
    reason verbatim (or 'ok' when OCR itself works, meaning the empty output
    came from elsewhere, e.g. docling's page OCR being disabled)"""
    try:
        import io

        from PIL import Image, ImageDraw
        from rapidocr import RapidOCR

        img = Image.new("RGB", (400, 80), "white")
        ImageDraw.Draw(img).text((20, 25), "OCR PROBE 123", fill="black")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        engine = RapidOCR()
        result = engine(buf.getvalue())
        texts = [r[1] for r in (result.txts or [])] if hasattr(result, "txts") else []
        return f"ok ({texts[:2]})"
    except Exception as exc:  # noqa: BLE001 — the probe's job IS to report
        return f"FAILED {type(exc).__name__}: {exc}"[:400]


def convert_pdf(path: str, title_hint: str = "Untitled paper") -> dict[str, Any]:
    import docling

    doc = get_converter().convert(path).document
    # a scanned PDF with missing/failing OCR yields an EMPTY document — the
    # old code returned "done" with 0 items and the failure only surfaced
    # later as a confusing routing refusal. Fail HERE with the real cause.
    if not doc.pages:
        raise RuntimeError(
            "解析产出 0 页——文件可能损坏或为空扫描件"
        )
    pages: list[dict[str, Any]] = []
    for no, page in doc.pages.items():
        size = page.size
        pages.append(
            {"page": int(no), "width": float(size.width), "height": float(size.height)}
        )

    items: list[dict[str, Any]] = []
    n = 0
    title = None
    for item, _lvl in doc.iterate_items():
        prov = getattr(item, "prov", None)
        if not prov:
            continue
        p = prov[0]
        b = p.bbox
        page_no = int(p.page_no)
        pg = next((x for x in pages if x["page"] == page_no), None)
        if pg is None:
            continue
        # normalize to top-left-origin page fractions
        l, t, r, bt = float(b.l), float(b.t), float(b.r), float(b.b)
        if l > r:
            l, r = r, l
        if bt > t:
            t, bt = bt, t
        top = pg["height"] - t if str(b.coord_origin).endswith("BOTTOMLEFT") else t
        x = max(0.0, min(1.0, l / pg["width"]))
        y = max(0.0, min(1.0, top / pg["height"]))
        w = max(0.0, min(1.0 - x, (r - l) / pg["width"]))
        h = max(0.0, min(1.0 - y, (t - bt) / pg["height"]))

        label = str(getattr(item, "label", "") or "")
        # docling labels may be enum values like 'section_header'
        label_val = getattr(label, "value", label)
        kind = KIND_MAP.get(label_val, "text")
        text = (getattr(item, "text", "") or "").strip()

        if kind == "title" and title is None:
            title = text

        entry: dict[str, Any] = {
            "id": f"p{page_no}-i{n}",
            "kind": kind,
            "page": page_no,
            "bbox": {"x": round(x, 5), "y": round(y, 5), "w": round(w, 5), "h": round(h, 5)},
        }
        if kind == "formula":
            entry["latex"] = text
        elif text:
            entry["text"] = text[:600]
        # tables keep their structure (columns + rows), not just an empty label
        if kind == "table" and hasattr(item, "export_to_dataframe"):
            try:
                df = item.export_to_dataframe()
                entry["table"] = {
                    "columns": [str(c) for c in df.columns],
                    "rows": [
                        ["" if v != v else str(v) for v in row]
                        for row in df.itertuples(index=False)
                    ][:200],
                }
            except Exception:  # noqa: BLE001 — structure is best-effort; bbox stays
                entry["tableError"] = "table structure export failed"
        # figures link the caption docling associated with them, when present
        if kind == "figure":
            cap = getattr(item, "caption", None)
            if isinstance(cap, list):
                cap = cap[0] if cap else None
            cap_text = getattr(cap, "text", None) if cap is not None else None
            if cap_text:
                entry["captionText"] = str(cap_text).strip()[:300]

        items.append(entry)
        n += 1

    if not items:
        # pages exist but NOTHING was extracted — scanned PDF whose OCR
        # produced no text. Run a MINIMAL direct OCR probe so the real
        # cloud-side cause (engine init failure / model load error) ships
        # in the error message instead of staying silent.
        raise RuntimeError(f"解析产出 0 个条目——扫描件需要 OCR 但未产出文本。OCR 探针：{_ocr_probe()}")
    return {
        "docId": f"doc-{uuid.uuid4().hex[:10]}",
        "engine": "docling",
        "doclingVersion": getattr(docling, "__version__", "unknown"),
        "title": title or title_hint,
        "pages": pages,
        "items": items,
    }
