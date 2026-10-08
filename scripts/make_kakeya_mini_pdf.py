#!/usr/bin/env python3
"""Generate the one-page Kakeya-mini fixture PDF (real LaTeX via tectonic).

Purpose: headless product tests that need the desk's KAKEYA-routed surface
(the grow-3d button + Run-driven 3D paper) without parsing the full 38-page
Wang–Zahl paper (Docling needs >8 minutes even locally for that). The mini
paper carries the router's deterministic Kakeya keywords plus one formula, so
adapterRouter picks 'kakeya' and the product path is exercised end-to-end.

Run: python3 scripts/make_kakeya_mini_pdf.py
Out: public/papers/kakeya-mini.pdf
"""
from __future__ import annotations

import pathlib
import subprocess

HERE = pathlib.Path(__file__).parent
OUT = HERE.parent / "public" / "papers" / "kakeya-mini.pdf"

TEX = r"""\documentclass[11pt]{article}
\usepackage[margin=1.2in]{geometry}
\usepackage{amsmath,amssymb}
\title{A Kakeya Set Miniature: Tubes in the Unit Cube}
\author{Test Fixture}
\date{}
\begin{document}
\maketitle

A \emph{Kakeya set} in $\mathbb{R}^{3}$ contains a unit line segment in every
direction. We study the Besicovitch--Kakeya conjecture at finite scale: a
family $\mathbb{T}$ of $\delta$-tubes pointing in $\delta$-separated
directions satisfies the Wolff axioms, and we measure the volume of its union
on a voxel grid.

\section{Setup}
Take $\delta = 2^{-4}$ and $N = 96$ tubes through directions sampled on the
Fibonacci hemisphere. The Kakeya maximal estimate we probe numerically is
\[
\Bigl|\bigcup_{T\in\mathbb{T}} Y(T)\Bigr| \;\ge\; \delta^{\varepsilon}
\lambda^{K} \sum_{T\in\mathbb{T}} |T|.
\]
Dragging the packing parameter from separated to sticky, all tubes converge
without changing directions; the multiplicity of the central voxel grows
toward $N$.

\section{Observation}
At finite resolution the union volume decreases as the family packs toward
the Kakeya configuration, in line with the sticky Kakeya phenomenon.

\end{document}
"""


def main() -> int:
    src = HERE / "kakeya-mini.tex"
    src.write_text(TEX)
    res = subprocess.run(["tectonic", "--keep-logs", str(src)], cwd=HERE, capture_output=True, text=True)
    if res.returncode != 0:
        print(res.stdout[-2000:])
        print(res.stderr[-2000:])
        return 1
    built = HERE / "kakeya-mini.pdf"
    built.replace(OUT)
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
