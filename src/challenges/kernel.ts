// Playable challenges (v0.6) — the base loop is: code-built model → REAL
// computation → direct manipulation → target feedback → retry & compare.
// Three levels, one contract:
//   projectile — drag angle/speed, land the ball on a target (PhET-style
//                error feedback, every attempt's trajectory is kept)
//   pendulum   — grab the bob to set the initial angle, change the rod
//                length, match a target PERIOD measured from the real swing
//   tubes      — move tube clusters (per-cluster offsets, not one global
//                packing scalar) to shrink the occupied volume under budget
//
// Everything a player sees (hit, error, period, score) is READ from computed
// results — never asserted. Deterministic: same params → identical result.
// Physics models are GENERATED as MJCF from structured SceneSpecs (the
// programmatic-model path this repo already verified via mj_loadXML).
import { computeVoxelCoverage } from '../kakeya/voxels3d'
import { fibonacciDirections } from '../kakeya/directions'
import { makeTubes, segmentOf, type Tube3 } from '../kakeya/tubes'
import { assertFiniteNumbers } from '../experiments/protocol'
import type { SceneSpec, ProjectileSpec, PendulumSpec, TubesSpec, ProjectileResult, PendulumResult, TubesResult, ChallengeResult } from './levels'

export type {
  ChallengeKind, SceneSpec, ProjectileSpec, PendulumSpec, TubesSpec,
  ProjectileResult, PendulumResult, TubesResult, ChallengeResult,
} from './levels'
export { DEFAULT_LEVELS } from './levels'

// ---------------------------------------------------------------- MJCF build
/** programmatic projectile MJCF: launcher at origin, ball fired at t=0,
 * target marker at targetX. Model/collision/display geometry are ONE. */
export function projectileMjcf(spec: ProjectileSpec): string {
  const rad = (spec.angleDeg * Math.PI) / 180
  const vx = Math.cos(rad) * spec.speed
  const vz = Math.sin(rad) * spec.speed
  return `<mujoco model="p2l-projectile">
  <option gravity="0 0 ${-spec.gravity}" timestep="0.002" integrator="RK4"/>
  <worldbody>
    <geom name="ground" type="plane" size="40 40 0.1" rgba="0.85 0.82 0.76 1"/>
    <body name="ball" pos="0 0 0.1">
      <freejoint name="ball"/>
      <geom name="ball-geom" type="sphere" size="0.1" mass="0.2" rgba="0.58 0.23 0.18 1"/>
    </body>
    <body name="target-marker" pos="${spec.targetX.toFixed(6)} 0 0.02">
      <geom name="target-geom" type="cylinder" size="${spec.tolerance.toFixed(6)} ${spec.tolerance.toFixed(6)} 0.01" mass="0" contype="0" conaffinity="0" rgba="0.18 0.36 0.54 0.35"/>
    </body>
  </worldbody>
  <keyframe>
    <key name="launch" qpos="0 0 0.1 1 0 0 0" qvel="${vx.toFixed(9)} 0 ${vz.toFixed(9)} 0 0 0"/>
  </keyframe>
</mujoco>`
}

/** programmatic pendulum MJCF: hinge at a fixed pivot, rod hanging DOWN at
 * qpos=0, released from angleDeg via keyframe — the period comes from the
 * MEASURED swing, never from the small-angle formula. */
export function pendulumMjcf(spec: PendulumSpec): string {
  const rad = (spec.angleDeg * Math.PI) / 180
  const l = spec.length
  return `<mujoco model="p2l-pendulum">
  <option gravity="0 0 ${-spec.gravity}" timestep="0.001" integrator="RK4"/>
  <worldbody>
    <geom name="post" type="capsule" fromto="0 0 2.2 0 0 2" size="0.02" mass="0" rgba="0.42 0.36 0.28 1"/>
    <body name="arm" pos="0 0 2">
      <joint name="hinge" type="hinge" axis="0 1 0" pos="0 0 0" damping="0"/>
      <geom name="rod" type="capsule" fromto="0 0 0 0 0 ${(-l).toFixed(9)}" size="0.012" mass="0.02" rgba="0.55 0.5 0.42 1"/>
      <geom name="bob" type="sphere" size="0.05" mass="1" pos="0 0 ${(-l).toFixed(9)}" rgba="0.58 0.23 0.18 1"/>
    </body>
  </worldbody>
  <keyframe>
    <key name="release" qpos="${rad.toFixed(9)}"/>
  </keyframe>
</mujoco>`
}

// ---------------------------------------------------------------- compute
const SCORE_MAX = 1000

/** write a GENERATED MJCF into the VFS and simulate it under a fixed name
 * (the programmatic-model path; the scene allowlist in mujocoKernel only
 * covers vendored demos, so generated scenes go through this side door with
 * the same entity guard) */
async function simulateGenerated(name: string, xml: string, steps: number, sampleEvery: number, keyframe?: number) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('generated MJCF failed the entity guard')
  const { getMujoco, mujocoSimulate } = await import('../physics/mujocoKernel')
  const mujoco = await getMujoco()
  mujoco.FS.writeFile(`/working/${name}`, new TextEncoder().encode(xml))
  return mujocoSimulate(name, { steps, sampleEvery, params: keyframe === undefined ? undefined : { keyframe } })
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** validate a spec BEFORE any compute (finite numbers, level ranges) */
export function validateSpec(spec: SceneSpec): string | null {
  if (spec.kind === 'projectile') {
    if (!Number.isFinite(spec.angleDeg) || spec.angleDeg < 0 || spec.angleDeg > 85) return 'angleDeg must be in [0, 85]'
    if (!Number.isFinite(spec.speed) || spec.speed < 1 || spec.speed > 30) return 'speed must be in [1, 30] m/s'
    if (!Number.isFinite(spec.gravity) || spec.gravity <= 0 || spec.gravity > 30) return 'gravity must be in (0, 30]'
    if (!Number.isFinite(spec.targetX) || spec.targetX <= 0 || spec.targetX > 40) return 'targetX must be in (0, 40]'
    if (!Number.isFinite(spec.tolerance) || spec.tolerance <= 0) return 'tolerance must be positive'
  } else if (spec.kind === 'pendulum') {
    if (!Number.isFinite(spec.length) || spec.length < 0.2 || spec.length > 2) return 'length must be in [0.2, 2] m'
    if (!Number.isFinite(spec.angleDeg) || spec.angleDeg < 5 || spec.angleDeg > 90) return 'angleDeg must be in [5, 90]'
    if (!Number.isFinite(spec.gravity) || spec.gravity <= 0 || spec.gravity > 30) return 'gravity must be in (0, 30]'
    if (!Number.isFinite(spec.targetPeriod) || spec.targetPeriod <= 0) return 'targetPeriod must be positive'
    if (!Number.isFinite(spec.tolerance) || spec.tolerance <= 0) return 'tolerance must be positive'
  } else {
    if (!Array.isArray(spec.offsets) || spec.offsets.length === 0 || spec.offsets.length > 16) return 'offsets must be a non-empty array (≤16 clusters)'
    for (const o of spec.offsets) if (!Number.isFinite(o) || o < 0 || o > 1) return 'each offset must be in [0, 1]'
    if (!Number.isInteger(spec.nTubes) || spec.nTubes < 8 || spec.nTubes > 128) return 'nTubes must be an integer in [8, 128]'
    if (!Number.isInteger(spec.deltaExp) || spec.deltaExp < 3 || spec.deltaExp > 6) return 'deltaExp must be in [3, 6]'
    if (!Number.isInteger(spec.res) || spec.res < 8 || spec.res > 96) return 'res must be an integer in [8, 96]'
    if (!Number.isFinite(spec.budget) || spec.budget <= 0 || spec.budget > 1) return 'budget must be in (0, 1]'
  }
  return null
}

/** projectile: fly the REAL ball (MJCF keyframe launch), find ground contact */
export async function runProjectile(spec: ProjectileSpec): Promise<ProjectileResult> {
  const sim = await simulateGenerated('p2l-projectile.xml', projectileMjcf(spec), 4000, 10, 0)
  const t: number[] = []
  const x: number[] = []
  const z: number[] = []
  let landingX: number | null = null
  for (let i = 0; i < sim.t.length; i++) {
    const q = sim.qpos[i] // free joint: [x,y,z,qw,qx,qy,qz]
    if (q.length < 7) break
    const px = q[0]
    const pz = q[2]
    t.push(sim.t[i])
    x.push(px)
    z.push(pz)
    if (landingX === null && i > 0 && pz <= 0.1 + 0.02 && z[i - 1] > 0.1 + 0.02) {
      landingX = px
    }
  }
  if (landingX === null) landingX = x[x.length - 1] ?? 0 // didn't land in the window
  const error = Math.abs(landingX - spec.targetX)
  const hit = error <= spec.tolerance
  const result: ProjectileResult = {
    kind: 'projectile',
    t, x, z,
    landingX,
    targetX: spec.targetX,
    error,
    hit,
    tolerance: spec.tolerance,
    score: Math.round(SCORE_MAX * clamp(1 - error / (spec.targetX * 0.5), 0, 1)) + (hit ? 500 : 0),
  }
  assertFiniteNumbers({ landingX: result.landingX, error: result.error, score: result.score })
  return result
}

/** pendulum: measure the period from the REAL swing (zero crossings) */
export async function runPendulum(spec: PendulumSpec): Promise<PendulumResult> {
  const sim = await simulateGenerated('p2l-pendulum.xml', pendulumMjcf(spec), 6000, 5, 0)
  const t = sim.t
  const theta: number[] = sim.qpos.map((q) => q[0]) // hinge angle
  // zero crossings with rising direction → full-period markers
  const crossings: number[] = []
  for (let i = 1; i < theta.length; i++) {
    if (theta[i - 1] < 0 && theta[i] >= 0) {
      const f = -theta[i - 1] / (theta[i] - theta[i - 1] || 1e-12)
      crossings.push(t[i - 1] + f * (t[i] - t[i - 1]))
    }
  }
  let measuredPeriod: number | null = null
  if (crossings.length >= 2) {
    const gaps = crossings.slice(1).map((c, i) => c - crossings[i])
    const median = gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
    measuredPeriod = median
  }
  const error = measuredPeriod === null ? null : Math.abs(measuredPeriod - spec.targetPeriod)
  const matched = error !== null && error <= spec.tolerance
  const result: PendulumResult = {
    kind: 'pendulum',
    t, theta,
    measuredPeriod,
    targetPeriod: spec.targetPeriod,
    error,
    matched,
    tolerance: spec.tolerance,
    score: error === null ? 0 : Math.round(SCORE_MAX * clamp(1 - error / (spec.targetPeriod * 0.5), 0, 1)) + (matched ? 500 : 0),
  }
  if (result.measuredPeriod !== null) assertFiniteNumbers({ p: result.measuredPeriod, score: result.score })
  return result
}

/** count tubes whose whole segment exits the unit cube — the defensive gate:
 * the measurement region is [0,1]³, so any tube outside it must fail the
 * attempt, never lower the score (#21) */
function countCubeViolations(tubes: Tube3[]): number {
  let violations = 0
  const eps = 1e-9
  for (const t of tubes) {
    const { a, b } = segmentOf(t)
    for (const q of [a, b]) {
      if (q.x < -eps || q.x > 1 + eps || q.y < -eps || q.y > 1 + eps || q.z < -eps || q.z > 1 + eps) violations++
    }
  }
  return violations
}

/** tubes: per-cluster offsets pull that cluster's tubes toward the cube
 * centre — the sticky Kakeya configuration, per cluster (the hero demo's
 * packing parameter, split into four independent clusters). The midpoint
 * interpolates between two points of the tube's admissible box, and the box
 * is convex, so every segment stays inside [0,1]³ BY CONSTRUCTION; the
 * volume comes from the same voxel counter the hero demo uses, and any
 * residual violation fails the attempt instead of rewarding it. */
export function runTubesSync(spec: TubesSpec): TubesResult {
  const delta = 2 ** -spec.deltaExp
  const dirs = fibonacciDirections(spec.nTubes)
  const base = makeTubes(dirs, delta, 0, 20250224)
  const per = Math.ceil(base.length / spec.offsets.length)
  const nClusters = Math.min(spec.offsets.length, Math.ceil(base.length / per))
  const packing = spec.offsets.slice(0, nClusters).map((o) => clamp(o, 0, 1))
  const moved: Tube3[] = base.map((tube, i) => {
    const cluster = Math.min(nClusters - 1, Math.floor(i / per))
    const p = packing[cluster]
    return {
      ...tube,
      center: {
        x: tube.center.x + p * (0.5 - tube.center.x),
        y: tube.center.y + p * (0.5 - tube.center.y),
        z: tube.center.z + p * (0.5 - tube.center.z),
      },
    }
  })
  const violations = countCubeViolations(moved)
  const measured = computeVoxelCoverage(moved, spec.res, 0)
  const withinBudget = violations === 0 && measured.occupiedVolume <= spec.budget
  const result: TubesResult = {
    kind: 'tubes',
    occupiedVolume: measured.occupiedVolume,
    budget: spec.budget,
    withinBudget,
    score: violations > 0
      ? 0
      : Math.round(SCORE_MAX * clamp(1 - measured.occupiedVolume / spec.budget, 0, 1)) + (withinBudget ? 500 : 0),
    packing,
    violations,
  }
  assertFiniteNumbers({ v: result.occupiedVolume, score: result.score })
  return result
}

/** default frozen levels (goals + constraints + budgets) — browser-safe */

/** dispatch — the ONLY entry the skill/store call */
export async function runChallenge(spec: SceneSpec): Promise<ChallengeResult> {
  const invalid = validateSpec(spec)
  if (invalid) throw new Error(invalid)
  if (spec.kind === 'projectile') return runProjectile(spec)
  if (spec.kind === 'pendulum') return runPendulum(spec)
  return runTubesSync(spec)
}
