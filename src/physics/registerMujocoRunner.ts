// Engine-side registration of mujoco.simulate (Node-only: the kernel seeds
// an Emscripten VFS via node:fs). Imported by scripts/engine_server.ts and
// by the Node test-suite — NEVER by browser code (the browser answer for the
// skill is an honest "engine-only" unsupported message).
import { registerSkillRunner } from '../skills/executor'
import { executeSpec } from '../experiments/protocol'
import { mujocoSimulate, scenesChecksum, MUJOCO_ENGINE } from './mujocoKernel'

registerSkillRunner('mujoco.simulate', async (input, opts) => {
  const i = input as {
    scene: string
    steps: number
    sampleEvery?: number
    params?: { gravityZ?: number; windX?: number; timestep?: number; forces?: Array<{ bodyId: number; f: [number, number, number]; p: [number, number, number] }> }
  }
  const sampleEvery = typeof i.sampleEvery === 'number' ? i.sampleEvery : 10
  const params = i.params ?? {}
  return executeSpec(
    {
      kind: 'mujoco.sim',
      params: {
        ...(params.gravityZ !== undefined ? { gravityZ: params.gravityZ } : {}),
        ...(params.windX !== undefined ? { windX: params.windX } : {}),
        ...(params.timestep !== undefined ? { timestep: params.timestep } : {}),
        ...(params.forces !== undefined ? { forces: params.forces.length } : {}),
      },
      seed: 0,
      model: { scene: i.scene, steps: i.steps, sampleEvery, params, scenesChecksum: scenesChecksum() },
    },
    MUJOCO_ENGINE,
    () => mujocoSimulate(i.scene, { steps: i.steps, sampleEvery, params }),
    { parentRunId: opts.parentRunId },
  )
})
