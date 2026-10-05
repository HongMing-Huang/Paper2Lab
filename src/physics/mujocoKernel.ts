// MuJoCo WASM kernel (Stage A of the physics base) — runs the SAME official
// single-threaded build the upstream demo uses (@mujoco/mujoco@3.12.0, the
// dependency locked by zalo/mujoco_wasm@f6b202ca…), headless in Node inside
// the engine, or in the browser page later.
//
// Loading follows the upstream headless pattern (test_load.mjs @f6b202c):
// load the module, mount a MEMFS directory, write the VENDORED scene tree
// into it (src/physics/scenes, sha256-manifested, DOCTYPE/ENTITY-free), then
// mj_loadXML → MjData → mj_step. Parameters are applied to mjModel.opt
// BEFORE stepping (gravity z, wind x, timestep) — every number in the result
// was computed by MuJoCo itself.
import load_mujoco from '@mujoco/mujoco'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MUJOCO_ENGINE = { engine: 'mujoco-wasm', version: '3.12.0' } as const

export interface MjParams {
  /** gravity z component (m/s², MuJoCo default −9.81) */
  gravityZ?: number
  /** wind x component (m/s) */
  windX?: number
  /** integrator timestep (s; scene default when omitted) */
  timestep?: number
}

export interface MjSimulateResult {
  scene: string
  steps: number
  sampleEvery: number
  nq: number
  /** sampled time stamps (length = ceil(steps/sampleEvery)+1) */
  t: number[]
  /** qpos sampled at those stamps: number[T][nq] */
  qpos: number[][]
  metrics: {
    finalTime: number
    qposNormFinal: number
    qvelNormFinal: number
    qaccNormMean: number
    comZFinal: number | null
    allFinite: boolean
  }
}

type MujocoModule = Awaited<ReturnType<typeof load_mujoco>> & {
  FS: {
    mkdir(p: string): void
    mount(type: unknown, opts: Record<string, unknown>, at: string): void
    writeFile(p: string, data: Uint8Array): void
    unlink?(p: string): void
  }
  MEMFS: unknown
  MjModel: { mj_loadXML(p: string): unknown }
  // typed accessors used below (the d.ts exposes these on instances)
}

let modulePromise: Promise<MujocoModule> | null = null
let scenesSeeded = false

const here = dirname(fileURLToPath(import.meta.url))
const SCENES_DIR = resolve(here, 'scenes')

/** the manifest written by scripts/vendor_mujoco_scenes.ts (upstream lock) */
export function scenesManifest(): { upstream: string; commit: string; scenes: string[]; files: Record<string, string> } {
  return JSON.parse(readFileSync(join(SCENES_DIR, 'manifest.json'), 'utf8')) as never
}

export function listScenes(): string[] {
  return scenesManifest().scenes
}

/** boot the wasm module once and seed the VFS with the vendored scenes */
export async function getMujoco(): Promise<MujocoModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const mod = (await load_mujoco()) as MujocoModule
      if (!scenesSeeded) {
        mod.FS.mkdir('/working')
        mod.FS.mount(mod.MEMFS, { root: '.' }, '/working')
        const write = (dir: string, base = '') => {
          for (const name of readdirSync(dir)) {
            const full = join(dir, name)
            const rel = base ? `${base}/${name}` : name
            if (statSync(full).isDirectory()) {
              try { mod.FS.mkdir(`/working/${rel}`) } catch { /* exists */ }
              write(full, rel)
            } else {
              mod.FS.writeFile(`/working/${rel}`, new Uint8Array(readFileSync(full)))
            }
          }
        }
        write(SCENES_DIR)
        scenesSeeded = true
      }
      return mod
    })()
  }
  return modulePromise
}

function finite(v: number): boolean {
  return Number.isFinite(v)
}

/** run one simulation — every returned number comes from mj_step itself */
export async function mujocoSimulate(
  scene: string,
  opts: { steps: number; sampleEvery: number; params?: MjParams } ,
): Promise<MjSimulateResult> {
  const manifest = scenesManifest()
  if (!manifest.scenes.includes(scene)) {
    throw new Error(`unknown scene '${scene}' — registered: ${manifest.scenes.join(', ')}`)
  }
  const steps = Math.floor(opts.steps)
  const sampleEvery = Math.max(1, Math.floor(opts.sampleEvery))
  if (!(steps >= 1) || steps > 100000) throw new Error(`steps must be in [1, 100000]: ${steps}`)
  const { gravityZ, windX, timestep } = opts.params ?? {}
  for (const v of [gravityZ, windX, timestep]) {
    if (v !== undefined && (!finite(v) || Math.abs(v) > 1e4)) throw new Error(`param out of range: ${v}`)
  }

  const mujoco = await getMujoco()
  const model = mujoco.MjModel.mj_loadXML(`/working/${scene}`) as {
    nq: number
    nv: number
    nbody: number
    opt: { gravity: { z?: number } & Record<string, unknown>; wind: Record<string, unknown>; timestep: number }
    delete(): void
  }
  if (!model) throw new Error(`mj_loadXML failed: ${scene}`)
  const data = new (mujoco as unknown as {
    MjData: new (m: unknown) => {
      time: number
      qpos: ArrayLike<number> & { size?: number }
      qvel: ArrayLike<number> & { size?: number }
      qacc: ArrayLike<number> & { size?: number }
      xpos: ArrayLike<number>
      delete(): void
    }
  }).MjData(model)

  // apply parameters BEFORE stepping (real mjModel.opt writes; gravity/wind
  // are Float64Array views on the model — index writes reach the wasm heap)
  const gravity = model.opt.gravity as unknown as Float64Array
  const wind = model.opt.wind as unknown as Float64Array
  if (gravityZ !== undefined) gravity[2] = gravityZ
  if (windX !== undefined) wind[0] = windX
  if (timestep !== undefined) model.opt.timestep = timestep

  const nq = model.nq
  const nv = model.nv
  const qposAt = (): number[] => {
    const out: number[] = []
    for (let i = 0; i < nq; i++) out.push(Number(data.qpos[i]))
    return out
  }
  const t: number[] = [Number(data.time)]
  const qpos: number[][] = [qposAt()]
  let qaccNormMean = 0
  let qaccCount = 0
  let allFinite = true

  const step = (m: unknown, d: unknown) =>
    (mujoco as unknown as { mj_step(m: unknown, d: unknown): void }).mj_step(m, d)

  for (let i = 1; i <= steps; i++) {
    step(model, data)
    let qaccNorm = 0
    for (let k = 0; k < nv; k++) {
      const a = Number(data.qacc[k])
      if (!finite(a)) allFinite = false
      qaccNorm += a * a
    }
    qaccNormMean += Math.sqrt(qaccNorm)
    qaccCount++
    if (i % sampleEvery === 0 || i === steps) {
      t.push(Number(data.time))
      qpos.push(qposAt())
    }
  }

  let qposNormFinal = 0
  let qvelNormFinal = 0
  for (let k = 0; k < nq; k++) {
    const q = Number(data.qpos[k])
    if (!finite(q)) allFinite = false
    qposNormFinal += q * q
  }
  for (let k = 0; k < nv; k++) {
    const v = Number(data.qvel[k])
    if (!finite(v)) allFinite = false
    qvelNormFinal += v * v
  }
  // world body 0 is at origin; body 1's z is a cheap "height of the first
  // non-world body" for fall-style scenes
  const comZFinal = model.nbody > 1 ? Number((data.xpos as ArrayLike<number>)[5]) : null

  const result: MjSimulateResult = {
    scene,
    steps,
    sampleEvery,
    nq,
    t,
    qpos,
    metrics: {
      finalTime: Number(data.time),
      qposNormFinal: Math.sqrt(qposNormFinal),
      qvelNormFinal: Math.sqrt(qvelNormFinal),
      qaccNormMean: qaccCount > 0 ? qaccNormMean / qaccCount : 0,
      comZFinal: comZFinal !== null && finite(comZFinal) ? comZFinal : null,
      allFinite,
    },
  }
  data.delete()
  model.delete()
  return result
}

/** deterministic checksum over the vendored scene tree (provenance for runs) */
export function scenesChecksum(): string {
  const files = scenesManifest().files
  const h = createHash('sha256')
  for (const name of Object.keys(files).sort()) h.update(name).update(files[name])
  return h.digest('hex').slice(0, 16)
}
