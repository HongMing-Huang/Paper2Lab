"""A0.2 — oversized tool results become STRUCTURED summaries with artifact
selectors: the full authorized result is retained server-side behind an
artifactRef + sha256 integrity mark (never silently dropped), and the SSE
wrapper closes its inner event generator deterministically on disconnect."""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from server.agent import _tool_output_json, get_result_artifact  # noqa: E402


pytestmark = [pytest.mark.asyncio]


class TestStructuredSummaryWithSelectors:
    def test_oversized_result_degrades_to_a_summary_pointing_at_the_full_copy(self):
        big = {"status": "ok", "runs": [{"runId": f"r{i}", "metrics": {"m": "x" * 3000}} for i in range(4)]}
        s = _tool_output_json(big)
        slim = json.loads(s)  # valid JSON always
        assert slim["truncated"] is True
        assert len(slim["runIds"]) == 4  # per-run selectors
        ref = slim.get("artifactRef")
        assert ref, "the summary must carry an artifactRef to the retained full result"
        # the FULL authorized result survives untouched behind the ref
        assert get_result_artifact(ref) == big
        # integrity mark: the retained copy is verifiable against the summary
        assert slim["artifactSha256"].startswith("sha256:")
        import hashlib
        digest = hashlib.sha256(json.dumps(big, ensure_ascii=False).encode()).hexdigest()
        assert slim["artifactSha256"] == f"sha256:{digest}"

    def test_an_error_batch_keeps_its_semantics_in_the_degraded_summary(self):
        fail = {"status": "error", "runs": [{"runId": f"r{i}", "metrics": {"m": "y" * 3000}} for i in range(4)], "message": "terminal op failed"}
        slim = json.loads(_tool_output_json(fail))
        assert slim["truncated"] is True and slim["status"] == "error"
        assert "terminal op failed" in slim["message"]
        assert get_result_artifact(slim["artifactRef"]) == fail

    def test_a_small_result_is_verbatim_and_registers_nothing(self):
        small = {"status": "ok", "runs": [{"runId": "r1", "metrics": {"peak": 3}}]}
        s = _tool_output_json(small)
        assert json.loads(s) == small
        assert "artifactRef" not in s

    def test_a_huge_comparison_never_busts_the_budget(self):
        huge_cmp = {"rows": [{"key": f"k{i}", "a": 1, "b": 2, "delta": 3, "pad": "c" * 400} for i in range(20)]}
        big = {"status": "ok", "runs": [{"runId": "r1", "metrics": {"peak": 1}}], "comparison": huge_cmp}
        s = _tool_output_json(big)
        assert len(s) <= 8000, f"comparison guard failed: {len(s)}"
        slim = json.loads(s)
        assert slim["truncated"] is True and slim["artifactRef"]
        assert "comparison" not in slim or len(json.dumps(slim.get("comparison"))) < 8000
        assert get_result_artifact(slim["artifactRef"]) == big  # full copy incl. the huge comparison

    def test_the_metrics_tier_is_actually_reachable_when_it_fits(self):
        # 8 runs × 1200-char metrics: the FULL result busts the budget, but the
        # LAST-4 metrics fit alongside the selectors → metrics must be attached
        big = {"status": "ok", "runs": [{"runId": f"r{i}", "metrics": {"m": "v" * 1200}} for i in range(8)]}
        full_len = len(json.dumps(big, ensure_ascii=False))
        assert full_len > 8000  # precondition: degradation actually triggers
        s = _tool_output_json(big)
        slim = json.loads(s)
        assert slim["truncated"] is True and len(slim["runIds"]) == 8
        assert "metrics" in slim and len(slim["metrics"]) == 4  # the richer tier won
        assert len(s) <= 8000

    def test_every_degradation_level_stays_within_budget_and_valid(self):
        for pad_metrics, pad_cmp, n_runs, is_error in [
            (3000, 0, 4, False), (100, 9000, 2, False), (4400, 0, 2, False),
            (3000, 0, 4, True), (100, 9000, 2, True), (6000, 6000, 6, True),
        ]:
            payload = {
                "status": "error" if is_error else "ok",
                "runs": [{"runId": f"r{i}", "metrics": {"m": "x" * pad_metrics}} for i in range(n_runs)],
            }
            if pad_cmp:
                payload["comparison"] = {"pad": "y" * pad_cmp}
            if is_error:
                payload["message"] = "terminal op failed"
            assert len(json.dumps(payload, ensure_ascii=False)) > 8000, (pad_metrics, pad_cmp, n_runs)  # precondition
            s = _tool_output_json(payload)
            assert len(s) <= 8000, (pad_metrics, pad_cmp, n_runs, len(s))
            slim = json.loads(s)
            assert slim["truncated"] is True and slim["artifactRef"]
            assert get_result_artifact(slim["artifactRef"]) == payload
            if is_error:
                assert slim["status"] == "error" and "terminal op failed" in slim["message"]

    def test_the_artifact_registry_is_bounded_and_evicts_oldest(self):
        from server.agent import _RESULT_ARTIFACT_LIMIT

        big = {"status": "ok", "runs": [{"runId": f"r{j}", "metrics": {"m": "z" * 3000}} for j in range(4)]}
        refs = []
        for i in range(_RESULT_ARTIFACT_LIMIT + 1):
            slim = json.loads(_tool_output_json({**big, "note": f"batch-{i}"}))
            refs.append(slim["artifactRef"])
        assert len(set(refs)) == _RESULT_ARTIFACT_LIMIT + 1
        assert get_result_artifact(refs[0]) is None  # oldest evicted
        assert get_result_artifact(refs[-1]) is not None  # newest retained


class TestSseDeterministicClose:
    async def test_client_disconnect_closes_the_event_generator_deterministically(self):
        from server.agent import _sse

        closed = asyncio.Event()
        produced = asyncio.Event()
        events_seen: list[dict] = []

        async def events():
            try:
                for i in range(5):
                    events_seen.append({"i": i})
                    yield {"i": i}
                    await asyncio.sleep(0.02)
                yield {"i": "done"}
            finally:
                closed.set()  # the inner generator MUST be closed by _sse

        gen_factory = events()
        response = _sse(gen_factory)
        body = response.body_iterator
        # consume one chunk, then disconnect (aclose) like starlette would
        first = await body.__anext__()
        assert b'"i": 0' in first
        await body.aclose()
        assert await asyncio.wait_for(closed.wait(), timeout=1.0), (
            "_sse must deterministically close the inner event generator on disconnect"
        )
        # and the wrapper itself yields nothing more afterwards
        with pytest.raises(StopAsyncIteration):
            await asyncio.wait_for(body.__anext__(), timeout=0.2)
