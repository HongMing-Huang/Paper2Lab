#!/usr/bin/env python3
"""Generate the un-prepared sample math PDF for ingestion closed-loop #1.

Two-page article typeset with real LaTeX via `tectonic` (Computer Modern,
display equations tagged (1)/(2)) plus one matplotlib figure embedded via
\\includegraphics. The PDF is *not* touched by any parser until Docling
ingests it — no side-channel metadata.

Known parser quirks baked into the design (verified by bisection):
- matplotlib text pages: keep stray line artists away from text (docling-parse
  7.22 can drop a whole page's words); use pdf.fonttype 42.
- matplotlib mathtext display equations classify as "picture", not "formula";
  real LaTeX display math classifies correctly.
"""
import pathlib
import subprocess
import sys

SRC = pathlib.Path(__file__).parent / "sample-src"
OUT = pathlib.Path(__file__).parent.parent / "public" / "papers" / "sample-harmonic.pdf"

TEX = r"""\documentclass[11pt]{article}
\usepackage[margin=1.1in]{geometry}
\usepackage{amsmath}
\usepackage{graphicx}
\title{Harmonic Distortion Notes:\\ The Two-Parameter Sine Model}
\author{A.~Researcher\thanks{Preliminary draft; worked example.}}
\date{October 2026}
\begin{document}
\maketitle
\begin{abstract}
We study the simplest two-parameter oscillation and ask how its amplitude and
frequency controls interact when a signal is sampled at fixed intervals.
Throughout the note the amplitude is written $a$ and the angular frequency is
written $b$; the independent variable is time, written $x$.
\end{abstract}

\section{The model}
The signal of interest is the pure sine with modulated amplitude:
\begin{equation}
  y = a \sin(bx).
  \label{eq:sine}
\end{equation}
Here $a$ controls the peak value of the signal and $b$ controls how fast the
oscillation repeats. Doubling $a$ stretches the curve vertically; doubling $b$
compresses it horizontally by one half. When $a$ is negative the curve flips.

\section{Envelope of a damped variant}
For comparison, the damped variant decays exponentially:
\begin{equation}
  u(t) = e^{-t}\cos(\omega t).
  \label{eq:damped}
\end{equation}
Both formulas are studied numerically in the accompanying worksheet; the
sweep below fixes the sampling grid and varies the two parameters of
\eqref{eq:sine}.

\section{A sampled trace}
A short sample of the model with $a = 1.5$ and $b = 2$ is plotted in
Figure~\ref{fig:trace}.
\begin{figure}[h]
  \centering
  \includegraphics[width=0.62\linewidth]{plot.pdf}
  \caption{One period-sampled trace of \eqref{eq:sine} at $a=1.5$, $b=2$.}
  \label{fig:trace}
\end{figure}

\end{document}
"""


def make_plot() -> None:
    import matplotlib

    matplotlib.use("Agg")
    matplotlib.rcParams["pdf.fonttype"] = 42
    import matplotlib.pyplot as plt
    import numpy as np

    fig, ax = plt.subplots(figsize=(5.4, 2.9))
    xs = np.linspace(0, 7, 300)
    ax.plot(xs, 1.5 * np.sin(2 * xs), lw=1.6, color="#2f5a8f")
    ax.set_xlabel("x")
    ax.set_ylabel("y")
    fig.tight_layout()
    fig.savefig(SRC / "plot.pdf")
    plt.close(fig)


def main() -> None:
    SRC.mkdir(exist_ok=True)
    make_plot()
    (SRC / "sample.tex").write_text(TEX)
    subprocess.run(
        ["tectonic", "--keep-logs", str(SRC / "sample.tex")],
        check=True,
        cwd=SRC,
        stdout=sys.stderr,
    )
    OUT.parent.mkdir(exist_ok=True)
    (SRC / "sample.pdf").replace(OUT)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
