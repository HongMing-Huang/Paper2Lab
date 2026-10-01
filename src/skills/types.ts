// Scientific Skills — every research capability is an explicitly registered
// skill with schemas, runtime and evidence type (AGENTS.md §2.6).
// Interaction contract: experiment > computation > visualization > explanation.
import { kakeya } from '../paper/kakeyaGraph'

export type SkillFamily = 'inspect' | 'simulate' | 'measure' | 'compare' | 'infer' | 'trace' | 'verify'
export type SkillRuntime = 'main' | 'worker' | 'pyodide-worker'
export type EvidenceType = 'PAPER' | 'CALCULATED' | 'AI_INFERENCE'

export interface JsonSchemaLike {
  type: 'object'
  properties: Record<string, { type: 'number' | 'string' | 'boolean' | 'object' | 'array'; description?: string }>
  required?: string[]
}

export interface SkillDeclaration<I = unknown, O = unknown> {
  id: string
  family: SkillFamily
  title: string
  description: string
  input_schema: JsonSchemaLike
  output_schema: JsonSchemaLike
  runtime: SkillRuntime
  evidence_type: EvidenceType
  /** kernel modules / cells / other skills this skill depends on */
  dependencies: string[]
  /** optional runtimes (e.g. Pyodide) may be unavailable offline */
  optional?: boolean
  run(input: I): O | Promise<O>
}

export interface SkillRunRecord {
  seq: number
  skillId: string
  at: number
  durationMs: number
  input: unknown
  output: unknown
  /** runtime cell versions at run time — the evidence stamp */
  cellVersions: Record<string, number>
}

const registry = new Map<string, SkillDeclaration>()
const evidenceLog: SkillRunRecord[] = []
const logListeners = new Set<() => void>()
let seq = 0

export function registerSkill<I, O>(s: SkillDeclaration<I, O>) {
  if (registry.has(s.id)) throw new Error(`skill '${s.id}' already registered`)
  registry.set(s.id, s as SkillDeclaration)
}

export function getSkill(id: string): SkillDeclaration {
  const s = registry.get(id)
  if (!s) throw new Error(`unknown skill '${id}'`)
  return s
}

export function listSkills(): SkillDeclaration[] {
  return [...registry.values()]
}

function typeOf(v: unknown): string {
  if (Array.isArray(v)) return 'array'
  if (v === null) return 'null'
  return typeof v
}

/** minimal structural validation against input_schema; returns error or null */
export function validateInput(s: SkillDeclaration, input: unknown): string | null {
  if (typeOf(input) !== 'object') return `input must be object`
  const obj = input as Record<string, unknown>
  for (const key of s.input_schema.required ?? []) {
    if (!(key in obj)) return `missing required input '${key}'`
  }
  for (const [key, spec] of Object.entries(s.input_schema.properties)) {
    if (!(key in obj)) continue
    const t = typeOf(obj[key])
    if (spec.type === 'number' && t !== 'number') return `input '${key}' must be number, got ${t}`
    if (spec.type === 'string' && t !== 'string') return `input '${key}' must be string, got ${t}`
    if (spec.type === 'boolean' && t !== 'boolean') return `input '${key}' must be boolean, got ${t}`
    if (spec.type === 'array' && t !== 'array') return `input '${key}' must be array, got ${t}`
    if (spec.type === 'object' && t !== 'object') return `input '${key}' must be object, got ${t}`
  }
  return null
}

export function getEvidenceLog(): readonly SkillRunRecord[] {
  return evidenceLog
}

export function subscribeLog(cb: () => void): () => void {
  logListeners.add(cb)
  return () => logListeners.delete(cb)
}

/** validated invocation; every run is stamped into the EvidenceLog */
export async function runSkill<O = unknown, I = unknown>(id: string, input: I): Promise<O> {
  const s = getSkill(id)
  const err = validateInput(s, input)
  if (err) throw new Error(`skill '${id}': ${err}`)
  const versions: Record<string, number> = {}
  for (const c of kakeya.describe()) versions[c.id] = c.version
  const t0 = performance.now()
  const output = await s.run(input)
  const rec: SkillRunRecord = {
    seq: ++seq,
    skillId: id,
    at: Date.now(),
    durationMs: Math.round(performance.now() - t0),
    input,
    output,
    cellVersions: versions,
  }
  evidenceLog.push(rec)
  if (evidenceLog.length > 200) evidenceLog.shift()
  for (const cb of logListeners) cb()
  return output as O
}
