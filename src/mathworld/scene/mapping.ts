// Model space → three.js space for MathWorld scenes (presentation constants).
// three.js is Y-up: the definition's y-axis is vertical and its minimum sits
// on the floor (Y = 0); x and z axes are centred on the origin.
import * as THREE from 'three'
import type { AxisDecl, WorldDefinition } from '../definition'

export interface AxisInfo {
  source: string
  label: string
  min: number
  max: number
  length: number
  /** model value → world coordinate along this axis */
  toWorld: (v: number) => number
  /** world coordinate → model value */
  toModel: (w: number) => number
}

function axis(decl: AxisDecl, fallbackLength: number, fromFloor: boolean): AxisInfo {
  const length = decl.length ?? fallbackLength
  const span = decl.max - decl.min
  const offset = fromFloor ? 0 : -length / 2
  return {
    source: decl.source,
    label: decl.label ?? decl.source,
    min: decl.min,
    max: decl.max,
    length,
    toWorld: (v) => ((v - decl.min) / span) * length + offset,
    toModel: (w) => ((w - offset) / length) * span + decl.min,
  }
}

export interface Mapper {
  x: AxisInfo
  y: AxisInfo
  z: AxisInfo | null
  /** values keyed by symbol (independent/output/state/'t') → world point */
  point: (values: Record<string, number>) => THREE.Vector3
  /** world-space footprint for floor/camera framing */
  size: THREE.Vector3
}

export function makeMapper(world: WorldDefinition): Mapper {
  const a = world.scene.axes
  const x = axis(a.x, 10, false)
  const y = axis(a.y, 6, true)
  const z = a.z ? axis(a.z, 6, false) : null
  const read = (values: Record<string, number>, info: AxisInfo) => {
    const v = values[info.source]
    return Number.isFinite(v) ? info.toWorld(v) : 0
  }
  return {
    x, y, z,
    point: (values) => new THREE.Vector3(read(values, x), read(values, y), z ? read(values, z) : 0),
    size: new THREE.Vector3(x.length, y.length, z ? z.length : 2.4),
  }
}

/** formula curve samples → world points */
export function curvePoints(world: WorldDefinition, mapper: Mapper, pts: Array<[number, number]>): THREE.Vector3[] {
  if (world.model.kind !== 'formula') return []
  const { independent, output } = world.model
  return pts.map(([xv, yv]) => mapper.point({ [independent]: xv, [output]: yv }))
}

/** ode trajectory (t + per-state series in state order) → world points */
export function trajectoryPoints(world: WorldDefinition, mapper: Mapper, t: number[], series: number[][]): THREE.Vector3[] {
  if (world.model.kind !== 'ode') return []
  const names = world.model.states.map((s) => s.name)
  const out: THREE.Vector3[] = []
  for (let i = 0; i < t.length; i++) {
    const values: Record<string, number> = { t: t[i] }
    names.forEach((n, j) => { values[n] = series[j][i] })
    out.push(mapper.point(values))
  }
  return out
}
