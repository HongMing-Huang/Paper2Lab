"""backend test suite fixtures: the startup hot-path warmup is a PRODUCTION
optimization — in tests every app instance would re-load docling models and
the suite crawls. Off globally here (env opt-out already exists)."""
import os

os.environ.setdefault("PAPER2LAB_DISABLE_STARTUP_WARMUP", "1")
