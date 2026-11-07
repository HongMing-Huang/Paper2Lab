"""VLM fast-path (#15 speed): render PDF pages and let the provider's native
multimodal model read them concurrently. Covered here WITHOUT any network:

- _parse_model_items shape tolerance (fenced / bare array / truncated output)
- _pipe_table_to_structured → the SAME {columns, rows} Docling emits
- vlm_chat_url SSRF guard (loopback/private rejected, public passes)
- parse_pdf_with_vlm orchestration via a fake _extract_page: anchors, provenance
  labels, stage passthrough, per-page retry, and the honest 0-items failure
- /api/ingest mode routing: vlm branch wiring, explicit unavailable-provider
  error (no silent docling fallback), unknown mode rejected

No credentials live in this file: the provider dicts carry an env-derived
placeholder value, and the endpoint test injects the key via monkeypatch.setenv.
"""
import asyncio
import json
import os
from pathlib import Path

import pytest
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient

from server import vlm_parse
from server.vlm_parse import (
    _parse_model_items,
    _pipe_table_to_structured,
    parse_pdf_with_vlm,
    vlm_chat_url,
)

PDF = b"%PDF-1.4\n%%EOF\n"
REAL_PDF = str(Path(__file__).parent.parent.parent / "public" / "papers" / "ode-lotka-volterra.pdf")

FAKE_ITEMS = [
    {"kind": "text", "text": "Population Cycles in a Dimension–Prey System"},
    {"kind": "formula", "latex": "\\dot{x} = x - xy."},
    {"kind": "table", "text": "x | y\n0.0 | 0.00\n0.5 | 1.42"},
]

# placeholder provider secret: read from the environment (empty in CI) so no
# credential literal is ever committed
_KEY_PLACEHOLDER = os.environ.get("PAPER2LAB_TEST_VLM_KEY", "")


def _provider():
    return {
        "base_url": "https://vendor.example/v1",
        "api_key": _KEY_PLACEHOLDER,
        "model": "vision-model",
        "timeout_s": 30.0,
    }


class TestModelOutputShapes:
    def test_fenced_json(self):
        content = "```json\n" + json.dumps({"items": FAKE_ITEMS}) + "\n```"
        items = _parse_model_items(content)
        assert [i["kind"] for i in items] == ["text", "formula", "table"]
        assert items[1]["latex"] == "\\dot{x} = x - xy"  # trailing period stripped

    def test_bare_top_level_array(self):
        items = _parse_model_items(json.dumps(FAKE_ITEMS))
        assert len(items) == 3

    def test_truncated_json_is_repaired(self):
        truncated = '{"items": [' + json.dumps(FAKE_ITEMS[0]) + "," + json.dumps(FAKE_ITEMS[1])[:20]
        items = _parse_model_items(truncated)
        assert items and items[0]["kind"] == "text"

    def test_garbage_yields_empty(self):
        assert _parse_model_items("抱歉，我无法读取该图片。") == []

    def test_pipe_table_to_structured(self):
        t = _pipe_table_to_structured("x (s) | y (mm)\n--- | ---\n0.0 | 0.00\n0.5 | 1.42")
        assert t is not None
        assert t["columns"] == ["x (s)", "y (mm)"]
        assert t["rows"] == [["0.0", "0.00"], ["0.5", "1.42"]]

    def test_pipe_table_rejects_non_tabular(self):
        assert _pipe_table_to_structured("只有一行") is None


class TestUrlGuard:
    def test_loopback_rejected(self):
        with pytest.raises(RuntimeError, match="rejected"):
            vlm_chat_url("http://127.0.0.1:8787/v1")

    def test_private_rejected(self):
        with pytest.raises(RuntimeError, match="rejected"):
            vlm_chat_url("http://10.1.2.3/v1")

    def test_public_ok(self):
        assert vlm_chat_url("https://discovery-api.intern-ai.org.cn/v1").endswith("/chat/completions")


class TestOrchestration:
    @pytest.mark.asyncio
    async def test_full_parse_shape_and_provenance(self, monkeypatch):
        calls = []

        async def fake_extract(pn, png, base_url, key, model, timeout):
            calls.append((pn, len(png)))
            return pn, _parse_model_items(json.dumps({"items": FAKE_ITEMS}))

        monkeypatch.setattr(vlm_parse, "_extract_page", fake_extract)
        stages = []
        reported = []
        doc = await parse_pdf_with_vlm(
            REAL_PDF,
            _provider(),
            on_stage=stages.append,
            on_page=lambda pn, items: reported.append((pn, len(items))),
        )
        assert stages == ["vlm-reading"]
        assert calls and calls[0][1] > 1000  # a real rendered PNG
        # CLI-151: every read page reports its fragments once, before settling
        assert sorted(pn for pn, _ in reported) == [p["page"] for p in doc["pages"]]
        assert all(n == len(FAKE_ITEMS) for _, n in reported)
        assert doc["coverage"]["parsedPages"] == [p["page"] for p in doc["pages"]]
        # a page slice keeps GLOBAL page numbers and never claims the whole file
        two_pages = str(Path(REAL_PDF).parent / "sample-harmonic.pdf")
        sliced = await parse_pdf_with_vlm(two_pages, _provider(), page_range=(2, 2))
        assert [p["page"] for p in sliced["pages"]] == [2]
        assert {i["page"] for i in sliced["items"]} == {2}
        assert sliced["coverage"]["complete"] is False
        assert [s["name"] for s in sliced["_timing"]["spans"]] == ["vlm.render", "vlm.infer"]
        assert doc["engine"] == "vlm"
        assert doc["doclingVersion"] == "vision-model@fast-path"
        assert doc["_vlm"]["model"] == "vision-model"
        assert doc["_vlm"]["pages"] == len(doc["pages"])
        # docId is uuid-based: concurrent same-millisecond jobs must never
        # collide in persist_doc (review finding)
        doc2 = await parse_pdf_with_vlm(REAL_PDF, _provider())
        assert doc["docId"] != doc2["docId"]
        # formulas keep latex; tables gain the structured form
        formulas = [i for i in doc["items"] if i["kind"] == "formula"]
        tables = [i for i in doc["items"] if i["kind"] == "table"]
        assert formulas[0]["latex"] == "\\dot{x} = x - xy"
        assert tables[0]["table"]["rows"] == [["0.0", "0.00"], ["0.5", "1.42"]]
        # every item carries a page-scoped anchor in 0..1
        for it in doc["items"]:
            b = it["bbox"]
            assert 0 <= b["x"] <= 1 and 0 <= b["y"] <= 1

    @pytest.mark.asyncio
    async def test_per_page_retry_then_success(self, monkeypatch):
        state = {"n": 0}

        async def flaky(pn, png, base_url, key, model, timeout):
            state["n"] += 1
            if state["n"] == 1:
                return pn, []  # transient empty read
            return pn, [{"kind": "text", "text": "recovered"}]

        monkeypatch.setattr(vlm_parse, "_extract_page", flaky)
        doc = await parse_pdf_with_vlm(REAL_PDF, _provider())
        assert state["n"] == 2
        assert [i["text"] for i in doc["items"]] == ["recovered"]

    @pytest.mark.asyncio
    async def test_twice_failed_page_fails_loudly(self, monkeypatch):
        async def dead(pn, png, base_url, key, model, timeout):
            raise RuntimeError("boom")

        monkeypatch.setattr(vlm_parse, "_extract_page", dead)
        with pytest.raises(RuntimeError, match="page 1"):
            await parse_pdf_with_vlm(REAL_PDF, _provider())

    @pytest.mark.asyncio
    async def test_invalid_endpoint_fails_before_any_render(self, monkeypatch):
        async def must_not_run(*args, **kwargs):
            raise AssertionError("no request may happen for an invalid endpoint")

        monkeypatch.setattr(vlm_parse, "_extract_page", must_not_run)
        bad = _provider()
        bad["base_url"] = "http://127.0.0.1/v1"
        with pytest.raises(RuntimeError, match="rejected"):
            await parse_pdf_with_vlm(REAL_PDF, bad)

    @pytest.mark.asyncio
    async def test_over_limit_paper_is_rejected_not_half_parsed(self, monkeypatch, tmp_path):
        """reviewer consensus (Copilot+Codex): a >_MAX_PAGES paper must be
        REFUSED with actionable guidance — never handed back as success with
        pages silently missing (routing/experiments would reason over half a
        paper)"""
        from pypdf import PdfReader, PdfWriter

        reader = PdfReader(REAL_PDF)
        writer = PdfWriter()
        for _ in range(vlm_parse._MAX_PAGES + 2):
            writer.add_page(reader.pages[0])
        long_pdf = tmp_path / "26page.pdf"
        with long_pdf.open("wb") as fh:
            writer.write(fh)

        async def must_not_extract(*args, **kwargs):
            raise AssertionError("no provider call may happen for an over-limit paper")

        monkeypatch.setattr(vlm_parse, "_extract_page", must_not_extract)
        with pytest.raises(vlm_parse.VLMLimitError, match="精读定位"):
            await parse_pdf_with_vlm(str(long_pdf), _provider())


class TestEndpointRouting:
    async def _drain(self, client, job_id):
        for _ in range(120):
            st = (await client.get(f"/api/ingest/{job_id}")).json()
            if st["status"] in ("done", "error", "timeout", "superseded"):
                return st
            await asyncio.sleep(0.25)
        raise AssertionError(f"job {job_id} never settled")

    @pytest.mark.asyncio
    async def test_unknown_mode_rejected(self):
        from server.main import app

        async with LifespanManager(app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t") as client:
                r = await client.post(
                    "/api/ingest",
                    files={"file": ("p.pdf", PDF, "application/pdf")},
                    data={"mode": "turbo"},
                )
                assert r.status_code == 422
                assert "unknown parse mode" in r.text

    @pytest.mark.asyncio
    async def test_vlm_mode_routes_to_vlm_engine(self, monkeypatch):
        for name in ("PAPER2LAB_TEST_CONVERT", "PAPER2LAB_DISABLE_STARTUP_WARMUP"):
            monkeypatch.setenv(name, "1")
        monkeypatch.setenv("PAPER2LAB_AGENT_PROVIDER", "openai")
        monkeypatch.setenv("PAPER2LAB_AGENT_BASE_URL", "https://vendor.example/v1")
        monkeypatch.setenv("PAPER2LAB_AGENT_API_KEY", "test-key-from-env")
        monkeypatch.setenv("PAPER2LAB_AGENT_MODEL", "vision-model")

        captured = {}

        async def fake_parse(pdf_path, provider, on_stage=None, **_kwargs):
            captured["provider"] = provider
            if on_stage:
                on_stage("vlm-reading")
            return {
                "docId": "vlm-test",
                "engine": "vlm",
                "doclingVersion": "vision-model@fast-path",
                "title": "T",
                "pages": [{"page": 1, "width": 612, "height": 792}],
                "items": [{"id": "p1-i0", "kind": "text", "page": 1,
                           "bbox": {"x": 0.1, "y": 0.1, "w": 0.8, "h": 0.05}, "text": "hello"}],
                "_vlm": {"model": "vision-model", "pages": 1, "durationMs": 1},
            }

        import server.main as main_mod

        monkeypatch.setattr(main_mod, "parse_pdf_with_vlm", fake_parse)
        from server.main import app

        async with LifespanManager(app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t") as client:
                r = await client.post(
                    "/api/ingest",
                    files={"file": ("p.pdf", PDF, "application/pdf")},
                    data={"mode": "vlm"},
                )
                assert r.status_code == 202
                st = await self._drain(client, r.json()["jobId"])
                assert st["status"] == "done"
                assert st["mode"] == "vlm"
                assert st["docId"] == "vlm-test"
                # the provider dict came from the env-only layer, key included
                assert captured["provider"]["model"] == "vision-model"
                assert captured["provider"]["base_url"] == "https://vendor.example/v1"
                assert st["document"]["engine"] == "vlm"

    @pytest.mark.asyncio
    async def test_vlm_without_provider_is_an_explicit_error(self, monkeypatch):
        for name in ("PAPER2LAB_AGENT_PROVIDER", "PAPER2LAB_AGENT_BASE_URL",
                     "PAPER2LAB_AGENT_API_KEY", "PAPER2LAB_AGENT_MODEL", "DASHSCOPE_API_KEY"):
            monkeypatch.delenv(name, raising=False)
        from server.main import app

        async with LifespanManager(app) as mgr:
            async with AsyncClient(transport=ASGITransport(app=mgr.app), base_url="http://t") as client:
                r = await client.post(
                    "/api/ingest",
                    files={"file": ("p.pdf", PDF, "application/pdf")},
                    data={"mode": "vlm"},
                )
                assert r.status_code == 202
                st = await self._drain(client, r.json()["jobId"])
                assert st["status"] == "error"
                # honest, actionable — NOT a silent docling fallback
                assert "快速理解模式需要" in st["error"]
