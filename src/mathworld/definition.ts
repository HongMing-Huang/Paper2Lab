// MathWorld definition types (Linear CLI-129 · U2.1 local playable slice).
//
// A WorldDefinition is DATA. The same React scene renders any valid
// definition: changing the expression, the conditions or the goal yields a
// different experiment without touching the page. This file only DESCRIBES;
// every number the world shows comes from a registered Scientific Skill run
// (formula.plot / formula.evaluate / model.build / model.solve).
//
// Provenance: the definitions shipped under public/assets/mathworld/worlds are
// DEVELOPMENT SAMPLES hand-written from textbook equations. They are not PDF
// parses and not model (Qwen) output, and each one says so in `origin`.

export const WORLD_SCHEMA = 'paper2lab.mathworld/v1'

/** a tunable constant; `operable` is the ControlPolicy bit (math contract §6) */
export interface ParamDecl {
  name: string
  label?: string
  initial: number
  min: number
  max: number
  /** chip scrubbing granularity */
  step?: number
  operable: boolean
}

/** an ODE state; initial values are scenario conditions unless operable */
export interface StateDecl {
  name: string
  label?: string
  initial: number
  operable?: boolean
  min?: number
  max?: number
}

/** one explicit function y = f(x; params), sampled by formula.plot */
export interface FormulaModel {
  kind: 'formula'
  /** LaTeX right-hand side, e.g. `a\\sin(b x)+c` (a leading `y=` is allowed) */
  expression: string
  independent: string
  output: string
  range: [number, number]
  samples: number
  params: ParamDecl[]
}

/** N-state autonomous ODE system solved by model.solve (fixed-step RK4) */
export interface OdeModel {
  kind: 'ode'
  states: StateDecl[]
  /** state name → LaTeX right-hand side (autonomous: no explicit t) */
  rhs: Record<string, string>
  params: ParamDecl[]
  tSpan: [number, number]
  steps: number
  /** declared numeric policy: the formal run is repeated at 2× steps and the
   * largest state difference must stay below tol — a convergence ESTIMATE,
   * not a certified error bound */
  refineCheck: { tol: number }
}

export type MathModel = FormulaModel | OdeModel | KakeyaModel

// ---- Kakeya (方向之室 · CLI-149) -------------------------------------------
// The Wang–Zahl room: a FIXED δ-tube family (canonical Fibonacci directions,
// frozen lengths/radii) the player rearranges as clusters inside the scoring
// cube [0,1]³. Geometry and measurement come from the SAME canonical input
// (deltaExp/nTubes/packing/offsets → makeTubes/applyOffsets/computeVoxelCoverage).

/** one draggable group of tubes; operable=false marks a FIXED cluster (a
 *  scene condition the player must design around, not a knob) */
export interface KakeyaClusterDecl {
  id: string
  label?: string
  /** indices of this cluster's tubes in the canonical Fibonacci family */
  tubes: number[]
  operable?: boolean
  /** initial cluster offset in cube coordinates (default 0,0,0) */
  offset?: { x: number; y: number; z: number }
}

export interface KakeyaModel {
  kind: 'kakeya'
  /** δ = 2^-deltaExp — every tube's radius (frozen) */
  deltaExp: number
  /** number of tubes in the canonical family (frozen) */
  nTubes: number
  /** segment length of every tube (frozen). Must satisfy 2δ + length ≤ 1 so
   *  EVERY direction's whole capsule fits inside the scoring cube — a unit
   *  length would make near-axis directions unplaceable. */
  length: number
  /** baseline layout of the family: 0 = spread … 1 = sticky at the centre */
  packing: number
  /** formal measurement resolution; the goal's convergence estimate re-runs at refineRes */
  res: number
  refineRes: number
  clusters: KakeyaClusterDecl[]
}

/** drag a whole tube cluster inside the scoring cube (a camera-facing plane
 *  through the cluster); release commits a formal kakeya.measure */
export interface ClusterDragDecl {
  kind: 'cluster-drag'
  id: string
  cluster: string
  label?: string
}

export type ControlDecl = CurveHandleDecl | InitialPointDecl | ClusterDragDecl

/** Kakeya: |⋃T ∩ [0,1]³| (voxel estimate at `res`) must stay ≤ maxVolume.
 *  The score run is repeated at refineRes: |V(res) − V(refineRes)| > convTol
 *  ⇒ unknown (a coarse grid never passes); radius finer than ~1 voxel
 *  (2δ·res < 1) is also unknown. */
export interface KakeyaVolumeConstraint {
  kind: 'kakeya-volume'
  id: string
  label?: string
  maxVolume: number
  convTol: number
}

/** drag a point of a formula curve vertically; the host inverts ONE
 * parameter on its current continuous branch (no silent branch jumps) */
export interface CurveHandleDecl {
  kind: 'curve-handle'
  id: string
  param: string
  atX: number
  label?: string
}

/** drag the starting point of an ODE trajectory inside the plane of two
 * operable states (direct parameter control of initial conditions) */
export interface InitialPointDecl {
  kind: 'initial-point'
  id: string
  states: [string, string]
  label?: string
}

/** formula: y(x) must lie in [min,max] — checked with an exact formula.evaluate run */
export interface GateConstraint { kind: 'gate'; id: string; label?: string; x: number; min: number; max: number }
/** formula: the curve must not enter the box — checked on the formal curve's samples */
export interface AvoidBoxConstraint { kind: 'avoid-box'; id: string; label?: string; xMin: number; xMax: number; yMin: number; yMax: number }
/** ode: max over the trajectory samples of `state` must stay ≤ max */
export interface SeriesMaxConstraint { kind: 'series-max'; id: string; label?: string; state: string; max: number }
/** ode: the state's value at t1 must lie in [min,max] (either side optional) */
export interface FinalRangeConstraint { kind: 'final-range'; id: string; label?: string; state: string; min?: number; max?: number }
/** ode: some trajectory sample must come within `radius` of `center` (Euclidean in the listed states) */
export interface ReachBallConstraint { kind: 'reach-ball'; id: string; label?: string; center: Record<string, number>; radius: number }

export type ConstraintDecl =
  | GateConstraint
  | AvoidBoxConstraint
  | SeriesMaxConstraint
  | FinalRangeConstraint
  | ReachBallConstraint
  | KakeyaVolumeConstraint

/** model space → three.js space. three.js is Y-up: axes.y is the vertical. */
export interface AxisDecl {
  /** symbol on this axis: independent/output (formula), a state or 't' (ode) */
  source: string
  min: number
  max: number
  /** world units the [min,max] span occupies (default 10 for x, 6 for y/z) */
  length?: number
  label?: string
}

/** a paper anchor that LOCALIZES the reference: 1-based page in the source
 *  PDF (the #page=N fragment PDF viewers honour) and an optional bbox on that
 *  page in normalized [0,1] page coordinates (x,y,w,h from top-left). `note`
 *  keeps the honest human explanation (e.g. "关卡设计参照的思想出处"). */
export interface PaperAnchor {
  page: number
  bbox?: { x: number; y: number; w: number; h: number }
  note?: string
}

export interface WorldDefinition {
  schema: typeof WORLD_SCHEMA
  id: string
  title: string
  /** shown in the UI: dev sample / edited by user — never "PDF" or "AI" */
  origin: { kind: 'dev-sample' | 'edited'; note: string }
  /** optional link back to the source paper this room was designed from —
   *  honest provenance only: it names where the DESIGN came from, never claims
   *  the level itself is a paper result. anchor may be a plain string or a
   *  structured PaperAnchor ({ page, bbox? }) that localizes the reference */
  paperRef?: { url: string; title: string; anchor?: string | PaperAnchor }
  premise: string
  objective: string
  model: MathModel
  controls: ControlDecl[]
  goal: { mode?: 'explore' | 'challenge'; constraints: ConstraintDecl[]; attempts: number }
  scene: { axes: { x: AxisDecl; y: AxisDecl; z?: AxisDecl } }
  rules?: string[]
}

// ---- outcomes -------------------------------------------------------------

export type CheckStatus = 'pass' | 'fail' | 'unknown'

export interface ConstraintCheck {
  constraintId: string
  label: string
  kind: ConstraintDecl['kind']
  status: CheckStatus
  /** formatted measured quantity, e.g. "y(2) = 0.909" */
  measured: string
  /** formatted requirement, e.g. "1.6 ≤ y(2) ≤ 2.4" */
  requirement: string
  /** signed distance to violation (>0 satisfied), when meaningful */
  margin: number | null
  /** the specific reason, written from the computed numbers */
  explanation: string
  /** how the number was obtained (exact point run / finite sampling / …) */
  scope: string
  runIds: string[]
}

export interface QualityReport {
  method: 'step-refinement'
  steps: [number, number]
  maxDiff: number
  tol: number
  status: 'provisional' | 'unknown'
  runIds: [string, string]
  note: string
}

export interface Assessment {
  outcome: 'success' | 'fail' | 'unknown' | 'invalid'
  checks: ConstraintCheck[]
  quality?: QualityReport
  summary: string
  evaluator: string
}
