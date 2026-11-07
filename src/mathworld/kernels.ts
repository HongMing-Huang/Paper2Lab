// Presentation-only preview kernels for MathWorld (CLI-129).
//
// Dragging must feel immediate, so the world previews the SAME expression
// compiled by the SAME Cortex engine on a coarse grid — never a different
// model. Preview numbers are not evidence: they never reach the Goal, never
// become a Run, and the UI marks them "预览·不计分". The formal numbers always
// come from executeSkill (formula.plot / formula.evaluate / model.solve).
//
// The ODE compile below mirrors the private helpers in src/skills/executor.ts
// (safeLatexSymbols + sanitizeSymbols): Cortex folds bare single letters and
// greek macros (I → EulerGamma·…, \gamma → 0.5772) into constants, so the
// preview has to apply the identical rename or it would preview a different
// system than the formal run integrates.
import { compile, type MathJsonExpression } from '@cortex-js/compute-engine'
import { getEngine } from '../formula/engine'
import { compileFormula } from '../formula/compile'
import { fibonacciDirections } from '../kakeya/directions'
import { applyOffsets, makeTubes, type Offset3, type Tube3 } from '../kakeya/tubes'
import { computeVoxelCoverage } from '../kakeya/voxels3d'
import type { KakeyaModel } from './definition'

export interface CompiledExpression {
  run: (vars: Record<string, number>) => number
  freeSymbols: string[]
}

/** formula.plot's compile path: LaTeX → MathJSON, `y = …` contributes its RHS */
export function compileFormulaExpression(latex: string): CompiledExpression {
  const box = getEngine().parse(latex)
  if (box.errors.length > 0 || !box.isValid) throw new Error(`表达式无法解析：${latex}`)
  let expr = box.json as MathJsonExpression
  if (Array.isArray(expr) && expr[0] === 'Equal' && expr.length >= 3) expr = expr[2] as MathJsonExpression
  const compiled = compile(expr, { to: 'javascript' })
  if (!compiled || typeof compiled.run !== 'function') throw new Error('Cortex 无法把表达式编译为 JavaScript')
  const raw = compiled.run
  return {
    run: (vars) => {
      const v = raw(vars)
      return typeof v === 'number' ? v : Number(v)
    },
    freeSymbols: [...(compiled.freeSymbols ?? [])],
  }
}

function safeLatexSymbols(latex: string, names: string[]): string {
  let out = latex
  for (const n of names) out = out.replace(new RegExp(`\\\\${n}(?![a-zA-Z])`, 'g'), `\\mathrm{${n}}`)
  return out
}

function sanitizeSymbols(expr: MathJsonExpression, map: Map<string, string>): MathJsonExpression {
  if (typeof expr === 'string') return map.get(expr) ?? expr
  if (Array.isArray(expr)) {
    return expr.map((e, i) => (i === 0 && typeof e === 'string' ? e : sanitizeSymbols(e as MathJsonExpression, map))) as unknown as MathJsonExpression
  }
  if (expr && typeof expr === 'object' && 'fn' in (expr as Record<string, unknown>)) {
    const wrapped = expr as unknown as { fn?: unknown; sym?: unknown }
    const inner = sanitizeSymbols((wrapped.fn ?? wrapped.sym) as MathJsonExpression, map)
    return ('sym' in wrapped ? { sym: inner } : { fn: inner }) as unknown as MathJsonExpression
  }
  return expr
}

export interface CompiledSystem {
  states: string[]
  /** derivative of the state vector at y with the given parameter values */
  rhs: (y: number[], params: Record<string, number>) => number[]
  /** symbols the compiled right-hand sides need that are neither states nor params */
  unknownSymbols: string[]
}

/** model.solve's compile path (states + params renamed to v0, v1, …) */
export function compileOdeSystem(states: string[], rhs: Record<string, string>, paramNames: string[]): CompiledSystem {
  const map = new Map<string, string>()
  const all = [...states, ...paramNames]
  all.forEach((name, i) => map.set(name, `v${i}`))
  const known = new Set(map.values())
  const unknown = new Set<string>()
  const fns = states.map((s) => {
    const latex = String(rhs[s] ?? '')
    const box = getEngine().parse(safeLatexSymbols(latex, all))
    if (box.errors.length > 0 || !box.isValid) throw new Error(`状态 ${s} 的右端无法解析：${latex}`)
    let expr = box.json as MathJsonExpression
    if (Array.isArray(expr) && expr[0] === 'Equal' && expr.length >= 3) expr = expr[2] as MathJsonExpression
    let safe = sanitizeSymbols(expr, map)
    // same fix as the executor: a BARE renamed symbol (ẋ = y → "v1") compiles
    // as the subscript `v_1`, which no env key binds; inside an expression the
    // name compiles verbatim, so it is wrapped as the identical v1 + 0
    if (typeof safe === 'string') safe = ['Add', safe, 0] as unknown as MathJsonExpression
    const compiled = compileFormula(safe)
    if (!compiled) throw new Error(`状态 ${s} 的右端无法编译：${latex}`)
    for (const sym of compiled.freeSymbols) if (!known.has(sym)) unknown.add(sym)
    return compiled
  })
  return {
    states,
    unknownSymbols: [...unknown].sort(),
    rhs: (y, params) => {
      const env: Record<string, number> = {}
      states.forEach((s, i) => { env[map.get(s)!] = y[i] })
      for (const p of paramNames) env[map.get(p)!] = params[p]
      return fns.map((f) => f.run(env))
    },
  }
}

/** coarse curve for the drag preview; null when any sample is non-finite */
export function sampleCurve(
  fn: CompiledExpression,
  params: Record<string, number>,
  independent: string,
  range: [number, number],
  samples: number,
): Array<[number, number]> | null {
  const [x0, x1] = range
  const out: Array<[number, number]> = []
  for (let i = 0; i < samples; i++) {
    const x = x0 + ((x1 - x0) * i) / (samples - 1)
    const y = fn.run({ ...params, [independent]: x })
    if (!Number.isFinite(y)) return null
    out.push([x, y])
  }
  return out
}

/** coarse fixed-step RK4 for the drag preview; null on divergence */
export function integratePreview(
  sys: CompiledSystem,
  params: Record<string, number>,
  initial: number[],
  tSpan: [number, number],
  steps: number,
): { t: number[]; series: number[][] } | null {
  const [t0, t1] = tSpan
  const h = (t1 - t0) / steps
  let y = initial.slice()
  const t: number[] = [t0]
  const series = initial.map((v) => [v])
  const emit = Math.max(1, Math.round(steps / 120))
  for (let i = 1; i <= steps; i++) {
    const k1 = sys.rhs(y, params)
    const k2 = sys.rhs(y.map((v, j) => v + (h / 2) * k1[j]), params)
    const k3 = sys.rhs(y.map((v, j) => v + (h / 2) * k2[j]), params)
    const k4 = sys.rhs(y.map((v, j) => v + h * k3[j]), params)
    y = y.map((v, j) => v + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]))
    if (y.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e8)) return null
    if (i % emit === 0 || i === steps) {
      t.push(t0 + i * h)
      y.forEach((v, j) => series[j].push(v))
    }
  }
  return { t, series }
}

// ---- Kakeya room (方向之室 · CLI-149) ---------------------------------------
// Preview and the formal run share the SAME canonical chain: fibonacci family
// → makeTubes(deltaExp, packing) → applyOffsets → computeVoxelCoverage. The
// preview only differs in resolution (coarse grid, presentation-only).

/** cluster id → its current offset; tubes not in any cluster keep offset 0 */
export function kakeyaTubes(model: KakeyaModel, clusterOffsets: Record<string, Offset3>): Tube3[] {
  const base = makeTubes(fibonacciDirections(model.nTubes), 2 ** -model.deltaExp, model.packing, 20250224, model.length)
  const offsets: Offset3[] = base.map((_, i) => {
    const cluster = model.clusters.find((c) => c.tubes.includes(i))
    return (cluster && clusterOffsets[cluster.id]) || { x: 0, y: 0, z: 0 }
  })
  return applyOffsets(base, offsets)
}

/** coarse drag preview: same kernel, low resolution, never scored */
export function kakeyaPreview(model: KakeyaModel, clusterOffsets: Record<string, Offset3>, res = 24): { occupiedVolume: number; maxMultiplicity: number } {
  const m = computeVoxelCoverage(kakeyaTubes(model, clusterOffsets), res)
  return { occupiedVolume: m.occupiedVolume, maxMultiplicity: m.maxMultiplicity }
}

/** per-cluster admissible offset box (cube coords): the intersection of every
 *  member tube's centre box (capsule fully inside [0,1]³) shifted by its base
 *  centre — dragging a cluster is clamped to this, so an illegal layout can
 *  never even be previewed, let alone committed */
export function kakeyaClusterBox(model: KakeyaModel, clusterId: string): { min: Offset3; max: Offset3 } | null {
  const cluster = model.clusters.find((c) => c.id === clusterId)
  if (!cluster) return null
  const base = makeTubes(fibonacciDirections(model.nTubes), 2 ** -model.deltaExp, model.packing, 20250224, model.length)
  let min = { x: -Infinity, y: -Infinity, z: -Infinity }
  let max = { x: Infinity, y: Infinity, z: Infinity }
  const half = model.length / 2
  for (const i of cluster.tubes) {
    const t = base[i]
    if (!t) return null
    const box = { min: { x: t.radius + (Math.abs(t.dir.x) * half), y: t.radius + (Math.abs(t.dir.y) * half), z: t.radius + (Math.abs(t.dir.z) * half) }, max: { x: 1 - t.radius - (Math.abs(t.dir.x) * half), y: 1 - t.radius - (Math.abs(t.dir.y) * half), z: 1 - t.radius - (Math.abs(t.dir.z) * half) } }
    min = { x: Math.max(min.x, box.min.x - t.center.x), y: Math.max(min.y, box.min.y - t.center.y), z: Math.max(min.z, box.min.z - t.center.z) }
    max = { x: Math.min(max.x, box.max.x - t.center.x), y: Math.min(max.y, box.max.y - t.center.y), z: Math.min(max.z, box.max.z - t.center.z) }
  }
  if (min.x > max.x || min.y > max.y || min.z > max.z) return null // δ too large: no legal position
  return { min, max }
}

/** the per-tube offsets array a kakeya.measure call needs, from cluster offsets */
export function kakeyaOffsetArray(model: KakeyaModel, clusterOffsets: Record<string, Offset3>): Offset3[] {
  return Array.from({ length: model.nTubes }, (_, i) => {
    const cluster = model.clusters.find((c) => c.tubes.includes(i))
    return (cluster && clusterOffsets[cluster.id]) || { x: 0, y: 0, z: 0 }
  })
}

/** mean base-layout centre of each cluster (deterministic; for the witness
 *  search's centre-directed packing) */
export function kakeyaClusterMeans(model: KakeyaModel): Record<string, Offset3> {
  const base = makeTubes(fibonacciDirections(model.nTubes), 2 ** -model.deltaExp, model.packing, 20250224, model.length)
  const out: Record<string, Offset3> = {}
  for (const c of model.clusters) {
    let x = 0, y = 0, z = 0
    for (const i of c.tubes) { x += base[i].center.x / c.tubes.length; y += base[i].center.y / c.tubes.length; z += base[i].center.z / c.tubes.length }
    out[c.id] = { x, y, z }
  }
  return out
}

// ---- inverse solve for a curve handle (math contract §6) --------------------

export type InverseResult =
  | { status: 'ok'; value: number; residual: number; sensitivity: number; branches: number }
  | { status: 'no-solution'; reachable: [number, number] | null }
  | { status: 'ill-conditioned'; sensitivity: number }

/**
 * Solve g(p) = target for ONE parameter p in [lo, hi], staying on the branch
 * continuous with the current value. Scans the domain for sign changes,
 * bisects every bracket, and returns the root nearest `current` (branch
 * tracking, never "nearest to the mouse"). A target outside the reachable
 * range is no-solution; a parameter the point does not depend on
 * (∂g/∂p ≈ 0, e.g. a in a·sin(bx) where sin(bx)=0) is ill-conditioned.
 */
export function inverseSolve(
  g: (p: number) => number,
  target: number,
  current: number,
  lo: number,
  hi: number,
): InverseResult {
  const N = 240
  const ps: number[] = []
  const vs: number[] = []
  let vmin = Infinity
  let vmax = -Infinity
  for (let i = 0; i <= N; i++) {
    const p = lo + ((hi - lo) * i) / N
    const v = g(p)
    ps.push(p)
    vs.push(v)
    if (Number.isFinite(v)) {
      vmin = Math.min(vmin, v)
      vmax = Math.max(vmax, v)
    }
  }
  if (!Number.isFinite(vmin)) return { status: 'no-solution', reachable: null }
  const spread = vmax - vmin
  const scale = Math.max(1, Math.abs(target), Math.abs(vmax), Math.abs(vmin))
  const eps = (hi - lo) * 1e-6
  const deriv = (p: number) => (g(Math.min(hi, p + eps)) - g(Math.max(lo, p - eps))) / (Math.min(hi, p + eps) - Math.max(lo, p - eps))
  // the point barely moves with p anywhere in its domain → p is not identifiable here
  if (spread < 1e-9 * scale) return { status: 'ill-conditioned', sensitivity: Math.abs(deriv(current)) }
  const roots: number[] = []
  for (let i = 0; i < N; i++) {
    const a = vs[i] - target
    const b = vs[i + 1] - target
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue
    if (a === 0) { roots.push(ps[i]); continue }
    if (a * b < 0) {
      let l = ps[i]
      let r = ps[i + 1]
      let fl = a
      for (let k = 0; k < 60; k++) {
        const m = (l + r) / 2
        const fm = g(m) - target
        if (fl * fm <= 0) r = m
        else { l = m; fl = fm }
      }
      roots.push((l + r) / 2)
    }
  }
  if (vs[N] - target === 0) roots.push(ps[N])
  if (roots.length === 0) return { status: 'no-solution', reachable: [vmin, vmax] }
  let best = roots[0]
  for (const r of roots) if (Math.abs(r - current) < Math.abs(best - current)) best = r
  const sensitivity = Math.abs(deriv(best))
  if (sensitivity < 1e-6 * scale) return { status: 'ill-conditioned', sensitivity }
  return { status: 'ok', value: best, residual: Math.abs(g(best) - target), sensitivity, branches: roots.length }
}
