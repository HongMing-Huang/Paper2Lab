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
        opts = PdfPipelineOptions()
        opts.do_formula_enrichment = True
        _converter = DocumentConverter(
            format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)}
        )
    return _converter


def convert_pdf(path: str, title_hint: str = "Untitled paper") -> dict[str, Any]:
    import docling

    doc = get_converter().convert(path).document
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

        items.append(
            {
                "id": f"p{page_no}-i{n}",
                "kind": kind,
                "page": page_no,
                "bbox": {"x": round(x, 5), "y": round(y, 5), "w": round(w, 5), "h": round(h, 5)},
                **({"latex": text} if kind == "formula" else {}),
                **({"text": text[:600]} if kind != "formula" and text else {}),
            }
        )
        n += 1

    return {
        "docId": f"doc-{uuid.uuid4().hex[:10]}",
        "engine": "docling",
        "doclingVersion": getattr(docling, "__version__", "unknown"),
        "title": title or title_hint,
        "pages": pages,
        "items": items,
    }
