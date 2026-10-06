// Engine-side registration of challenge.attempt — the SAME kernels the
// browser page will call, so user and agent attempts are indistinguishable
// at the compute layer (same goal, constraints, budget accounting in the
// caller). Node-only import chain (mujoco wasm VFS).
import { registerSkillRunner } from '../skills/executor'
import { executeSpec } from '../experiments/protocol'
import { runChallenge, validateSpec, DEFAULT_LEVELS, type SceneSpec } from './kernel'

registerSkillRunner('challenge.attempt', async (input, opts) => {
  const i = input as {
    challenge: keyof typeof DEFAULT_LEVELS
    changes?: Record<string, number | number[]>
    level?: Record<string, unknown>
  }
  const base = (i.level && (i.level as { kind?: string }).kind ? i.level : DEFAULT_LEVELS[i.challenge]) as unknown as SceneSpec
  // apply the manipulable surface (same clamps the store uses)
  const spec: SceneSpec = { ...base } as SceneSpec
  const c = i.changes ?? {}
  if (spec.kind === 'projectile') {
    if (typeof c.angleDeg === 'number') spec.angleDeg = c.angleDeg
    if (typeof c.speed === 'number') spec.speed = c.speed
  } else if (spec.kind === 'pendulum') {
    if (typeof c.length === 'number') spec.length = c.length
    if (typeof c.angleDeg === 'number') spec.angleDeg = c.angleDeg
  } else if (spec.kind === 'tubes' && Array.isArray(c.offsets)) {
    spec.offsets = (c.offsets as number[]).map((v) => Math.min(1, Math.max(0, v)))
  }
  const invalid = validateSpec(spec)
  if (invalid) throw new Error(invalid)

  return executeSpec(
    {
      kind: 'challenge.attempt',
      params: {},
      seed: 0,
      model: { challenge: spec.kind, level: base, changes: c, spec },
    },
    { engine: 'challenge-kernel', version: '0.1' },
    () => runChallenge(spec),
    { parentRunId: opts.parentRunId },
  )
})
