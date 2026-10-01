#!/usr/bin/env python3
"""One-off probe: dump the Docling item structure of the sample PDF so the
normalizer can be written against the real library, not guesses."""
import json
from docling.document_converter import DocumentConverter
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.datamodel.base_models import InputFormat
from docling.document_converter import FormatOption, PdfFormatOption

opts = PdfPipelineOptions()
opts.do_formula_enrichment = True
conv = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)})
doc = conv.convert("public/papers/sample-harmonic.pdf").document

print("PAGES", {n: (p.size.width, p.size.height) for n, p in doc.pages.items()})
for i, (item, lvl) in enumerate(doc.iterate_items()):
    prov = getattr(item, "prov", None)
    if not prov:
        print(i, type(item).__name__, "NO-PROV")
        continue
    p = prov[0]
    b = p.bbox
    txt = (getattr(item, "text", "") or "")[:60].replace("\n", " ")
    print(json.dumps({
        "i": i, "cls": type(item).__name__,
        "label": getattr(item, "label", None),
        "page": p.page_no,
        "bbox": [b.l, b.t, b.r, b.b],
        "origin": str(b.coord_origin),
        "text": txt,
    }, ensure_ascii=False))
