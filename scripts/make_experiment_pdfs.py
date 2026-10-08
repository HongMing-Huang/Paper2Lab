#!/usr/bin/env python3
"""Generate the four REAL experiment-acceptance PDFs (#24 五: 每类两篇条件
不同的真实论文) with tectonic — pure LaTeX text+math+tabular, NO figures
(known docling quirk: figure-heavy pages drop words / mathtext classifies as
picture). Each paper carries what the router NEEDS: ODE papers state two
\\dot-equations + explicit initials in prose; fit papers state the model plus
a measurement table.

Papers:
  ode-lotka-volterra.pdf    predator–prey in dimensionless form, x(0)=2, y(0)=0.5
  ode-damped-oscillator.pdf \\dot x=y, \\dot y=-x-0.5y, x(0)=1.5, y(0)=0
  fit-exponential-decay.pdf y = a e^{-bx} + measured table
  fit-sine-fit.pdf          y = a sin(bx) + measured table
"""
import pathlib
import subprocess
import sys

SRC = pathlib.Path("/tmp/p2l-pdf-src")
OUT = pathlib.Path(__file__).parent.parent / "public" / "papers"

PAPERS = {
    "ode-lotka-volterra": r"""\documentclass[11pt]{article}
\usepackage[margin=1.1in]{geometry}
\usepackage{amsmath}
\title{Population Cycles in a Dimensionless\\ Predator--Prey System}
\author{B.~Fieldwork}
\date{October 2026}
\begin{document}
\maketitle
\begin{abstract}
We examine the classical predator--prey interaction after rescaling to
dimensionless variables, where the prey density is $x$ and the predator
density is $y$. The oscillation period and the phase lag between the two
populations follow from the trajectory starting at the field-observed
initial state.
\end{abstract}
\section{The dimensionless system}
In dimensionless form the dynamics read
\begin{equation}
\dot{x} = x - x y,
\end{equation}
\begin{equation}
\dot{y} = x y - y.
\end{equation}
\section{Field observations}
The pond was seeded from the survey counts, giving the initial state
$x(0) = 2$ and $y(0) = 0.5$. All trajectories reported below start from
these values; the predator peak follows the prey peak by roughly a quarter
cycle, as expected for this system.
\section{Discussion}
Small perturbations of the initial state preserve the closed orbits, which
is the stabilising property exploited by the field census design.
\end{document}
""",
    "ode-damped-oscillator": r"""\documentclass[11pt]{article}
\usepackage[margin=1.1in]{geometry}
\usepackage{amsmath}
\title{Free Decay of a Linearly Damped Oscillator:\\ A Benchmark Note}
\author{C.~Bench}
\date{October 2026}
\begin{document}
\maketitle
\begin{abstract}
A unit-mass, unit-stiffness oscillator with viscous damping coefficient
$0.5$ is released from rest conditions in the bench fixture. We record the
decay envelope and the zero crossings of the displacement $x$ with velocity
$y$.
\end{abstract}
\section{Equations of motion}
With the state vector $(x, y)$ the dynamics read
\begin{equation}
\dot{x} = y,
\end{equation}
\begin{equation}
\dot{y} = -x - 0.5\, y.
\end{equation}
\section{Release conditions}
The arm is clamped at a displacement of one and a half units and released
from rest: the initial state is $x(0) = 1.5$ and $y(0) = 0$. The motion is
underdamped, so the amplitude envelope decays geometrically while the sign
of $x$ alternates each half period.
\section{Stability note}
Both eigenvalues have negative real part, so every trajectory converges to
the origin regardless of the release displacement.
\end{document}
""",
    "fit-exponential-decay": r"""\documentclass[11pt]{article}
\usepackage[margin=1.1in]{geometry}
\usepackage{amsmath}
\title{Signal Attenuation Through a Lossy Cable:\\ Fitting the Decay Model}
\author{D.~Measure}
\date{October 2026}
\begin{document}
\maketitle
\begin{abstract}
A tone is injected into a lossy cable and the received amplitude is recorded
against distance. We fit the measured data to the two-parameter decay model
and report the residual of the fit.
\end{abstract}
\section{The model}
The received amplitude follows the exponential decay law
\begin{equation}
y = a\, e^{-b x},
\end{equation}
where $x$ is distance in metres, $y$ the measured amplitude, $a$ the
launch amplitude and $b$ the attenuation constant.
\section{Measurements}
The bench data used for the fit are:
\begin{center}
\begin{tabular}{rr}
$x$ (m) & $y$ (mV) \\
0.0 & 1.98 \\
1.0 & 1.21 \\
2.0 & 0.74 \\
3.0 & 0.45 \\
4.0 & 0.28 \\
\end{tabular}
\end{center}
\section{Fit quality}
The least-squares fit of the model to the measured data above is assessed
by its residual pattern; a systematic residual indicates a non-exponential
loss channel.
\end{document}
""",
    "fit-sine-fit": r"""\documentclass[11pt]{article}
\usepackage[margin=1.1in]{geometry}
\usepackage{amsmath}
\title{Tuning-Fork Calibration:\\ Fitting a Pure Sine to Sampled Data}
\author{E.~Tone}
\date{October 2026}
\begin{document}
\maketitle
\begin{abstract}
A tuning fork is struck and the displacement is sampled at fixed intervals.
We fit the sampled points to the pure sine model and use the fitted
frequency as the calibration value.
\end{abstract}
\section{The model}
The displacement follows
\begin{equation}
y = a \sin(b x),
\end{equation}
with amplitude $a$ and angular frequency $b$; the independent variable $x$
is time in seconds.
\section{Sampled points}
The calibration data used for the fit are:
\begin{center}
\begin{tabular}{rr}
$x$ (s) & $y$ (mm) \\
0.0 & 0.00 \\
0.5 & 1.42 \\
1.0 & 2.00 \\
1.5 & 1.41 \\
2.0 & 0.03 \\
\end{tabular}
\end{center}
\section{Calibration remark}
The fit residual against the sampled data determines whether a second
harmonic is present; for the fork in question the pure sine suffices.
\end{document}
""",
}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    rc = 0
    for name, tex in PAPERS.items():
        SRC.mkdir(parents=True, exist_ok=True)
        src = SRC / f"{name}.tex"
        src.write_text(tex)
        out_pdf = OUT / f"{name}.pdf"
        proc = subprocess.run(
            ["tectonic", "--outdir", str(SRC), str(src)],
            capture_output=True, text=True,
        )
        if proc.returncode != 0:
            print(f"FAIL {name}: {proc.stderr[-400:]}", file=sys.stderr)
            rc = 1
            continue
        (SRC / f"{name}.pdf").replace(out_pdf)
        print(f"built {out_pdf.name} ({out_pdf.stat().st_size} bytes)")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
