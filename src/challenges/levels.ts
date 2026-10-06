// Browser-safe challenge types + default frozen levels — NO node imports.
// The Challenges page imports THIS module; the compute kernels (which need
// the wasm VFS) stay in kernel.ts and are reached through the backend engine.
export type ChallengeKind = 'projectile' | 'pendulum' | 'tubes'

export interface ProjectileSpec {
  kind: 'projectile'
  /** launch angle in degrees above horizon (0..85) */
  angleDeg: number
  /** launch speed in m/s (1..30) */
  speed: number
  /** gravity in m/s² (downward magnitude; the challenge freezes it) */
  gravity: number
  /** target distance from the launcher along ground (m) */
  targetX: number
  /** hit tolerance radius (m) */
  tolerance: number
}

export interface PendulumSpec {
  kind: 'pendulum'
  /** rod length in m (0.2..2) */
  length: number
  /** initial angular displacement in degrees (5..90) */
  angleDeg: number
  /** gravity in m/s² */
  gravity: number
  /** period to match (s) */
  targetPeriod: number
  /** tolerance (s) */
  tolerance: number
}

export interface TubesSpec {
  kind: 'tubes'
  /** per-cluster offsets in [0,1]: each cluster of tubes translates its
   * origins — the player manipulates each cluster individually */
  offsets: number[]
  /** fixed by the level (constraints): direction count, δ, grid */
  nTubes: number
  deltaExp: number
  res: number
  /** occupied-volume budget to beat (fraction of the unit cube) */
  budget: number
}

export type SceneSpec = ProjectileSpec | PendulumSpec | TubesSpec

export interface ProjectileResult {
  kind: 'projectile'
  t: number[]
  x: number[]
  z: number[]
  landingX: number
  targetX: number
  error: number
  hit: boolean
  tolerance: number
  score: number
}

export interface PendulumResult {
  kind: 'pendulum'
  t: number[]
  theta: number[]
  measuredPeriod: number | null
  targetPeriod: number
  error: number | null
  matched: boolean
  tolerance: number
  score: number
}

export interface TubesResult {
  kind: 'tubes'
  occupiedVolume: number
  budget: number
  withinBudget: boolean
  score: number
}

export type ChallengeResult = ProjectileResult | PendulumResult | TubesResult

/** default frozen levels (goals + constraints + budgets) */
export const DEFAULT_LEVELS: Record<string, SceneSpec> = {
  projectile: { kind: 'projectile', angleDeg: 30, speed: 10, gravity: 9.81, targetX: 22.9, tolerance: 0.5 },
  pendulum: { kind: 'pendulum', length: 0.6, angleDeg: 25, gravity: 9.81, targetPeriod: 2.0, tolerance: 0.05 },
  tubes: { kind: 'tubes', offsets: [0, 0, 0, 0], nTubes: 32, deltaExp: 4, res: 24, budget: 0.19 },
}
