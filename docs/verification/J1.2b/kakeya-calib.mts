// CLI-149 level calibration probe (one-off, read-only against the kernels):
// designs spatially coherent cluster groups on the deterministic base layout,
// measures opening/packed volumes with the FORMAL kernel (res 64 + 96), and
// prints the level JSON numbers to bake. No file writes.
import { fibonacciDirections } from '../../../src/kakeya/directions.ts'
import { makeTubes } from '../../../src/kakeya/tubes.ts'
import { kakeyaClusterBox, kakeyaOffsetArray } from '../../../src/mathworld/kernels.ts'
import { executeSkill } from '../../../src/skills/executor.ts'
import { registerPlan } from '../../../src/skills/playPlan.ts'

for (const n of [12, 16]) {
  registerPlan({ planId: `probe-k149-${n}`, goal: 'probe', source: { docId: 'probe', title: 'probe' }, variables: [], assumptions: [], skill: 'kakeya.measure', skillVersion: 'v3', renderer: 'r3f', metrics: [], inputs: { deltaExp: 4, nTubes: n, packing: 0 }, evidenceBasis: 'probe', successCriteria: 'probe', nonClaims: [], createdAt: Date.now() })
}

const formal = async (model, off) => {
  const offsets = kakeyaOffsetArray(model, off)
  const planId = `probe-k149-${model.nTubes}`
  const r1 = await executeSkill('kakeya.measure', { deltaExp: model.deltaExp, nTubes: model.nTubes, packing: model.packing, length: model.length, res: 64, offsets }, { planId })
  const r2 = await executeSkill('kakeya.measure', { deltaExp: model.deltaExp, nTubes: model.nTubes, packing: model.packing, length: model.length, res: 96, offsets }, { planId })
  const msg = r1.status !== 'ok' ? `${r1.status}:${String(r1.message ?? '').slice(0, 90)}` : r2.status !== 'ok' ? `r2 ${r2.status}:${String(r2.message ?? '').slice(0, 90)}` : ''
  return [r1.run?.result?.occupiedVolume, r2.run?.result?.occupiedVolume, msg]
}

const design = (N, packing, movableCount) => {
  const base = makeTubes(fibonacciDirections(N), 2 ** -4, packing, 20250224, 0.7)
  const centres = base.map((t) => t.center)
  const seeds: Array<{ x: number; y: number; z: number }> = []
  for (let k = 0; k < movableCount + 1; k++) seeds.push(centres[Math.floor((k * total(N)) / (movableCount + 1))])
  const groups: number[][] = Array.from({ length: movableCount + 1 }, () => [])
  centres.forEach((c, i) => {
    let best = 0
    let bd = 1e9
    seeds.forEach((s, j) => {
      const d = (c.x - s.x) ** 2 + (c.y - s.y) ** 2 + (c.z - s.z) ** 2
      if (d < bd) { bd = d; best = j }
    })
    groups[best].push(i)
  })
  return { groups, centres }
}
const total = (n: number) => n

const buildModel = (groups: number[][], packing: number, N: number) => ({
  kind: 'kakeya', deltaExp: 4, nTubes: N, length: 0.7, packing, res: 64, refineRes: 96,
  clusters: groups.map((tubes, i) => ({ id: 'g' + i, tubes, operable: i < groups.length - 1 })),
})

const packToward = (model, centres) => {
  const last = model.clusters[model.clusters.length - 1]
  const mean = (ids: number[]) => {
    let x = 0, y = 0, z = 0
    for (const i of ids) { x += centres[i].x / ids.length; y += centres[i].y / ids.length; z += centres[i].z / ids.length }
    return { x, y, z }
  }
  const fm = mean(last.tubes)
  const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
  const off: Record<string, { x: number; y: number; z: number }> = {}
  for (const c of model.clusters.filter((c) => c.operable)) {
    const b = kakeyaClusterBox(model, c.id)
    const cm = mean(c.tubes)
    off[c.id] = { x: cl(fm.x - cm.x, b.min.x, b.max.x), y: cl(fm.y - cm.y, b.min.y, b.max.y), z: cl(fm.z - cm.z, b.min.z, b.max.z) }
  }
  return off
}

for (const [name, N, packing, mv] of [['basic', 12, 0, 2], ['sticky', 16, 0, 3]] as const) {
  const { groups, centres } = design(N, packing, mv)
  const model = buildModel(groups, packing, N)
  const off = packToward(model, centres)
  const [p64, p96, pMsg] = await formal(model, off)
  const [o64, , oMsg] = await formal(model, {})
  console.log(name, 'groups', JSON.stringify(groups))
  console.log(name, 'packOffsets', JSON.stringify(off))
  console.log(name, 'formal opening', o64?.toFixed(4), oMsg ?? '', 'packed', p64?.toFixed(4), p96?.toFixed(4), pMsg ?? '')
}
