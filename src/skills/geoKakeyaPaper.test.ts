// #51 P0-E third class: a Kakeya/theoretical-geometry real paper. The
// router must send it to the KAKEYA adapter (keyword match on the paper's
// own Besicovitch/Kakeya text), and the kakeya desk's research loop must
// run REAL voxel measurements against it. Chain is synthetic-free: real
// tectonic PDF → real Docling fixture → route → kakeya binding.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeDocling } from '../ingest/doclingSchema'
import { routeAdapter } from './adapterRouter'
import { executeSkill } from './executor'
import { buildPlan } from './playPlan'

function realDoc(name: string) {
  return normalizeDocling(JSON.parse(readFileSync(join('src/ingest/fixtures', `${name}.docling.json`), 'utf8')))
}

describe('geo-kakeya-tubes paper → kakeya desk (#51 P0-E)', () => {
  it('routes to the kakeya adapter on the paper\'s own Besicovitch text', () => {
    const d = routeAdapter(realDoc('geo-kakeya-tubes'))
    expect(d.status).toBe('ok')
    expect(d.adapter).toBe('kakeya')
    expect(d.binding?.kind).toBe('kakeya')
  })

  it('the paper\'s claimed direction holds in REAL voxel measurements', async () => {
    // paper claim: doubling N increases multiplicity while union volume
    // grows only slowly. Verify with two real kakeya.measure runs.
    const base = await executeSkill(
      'kakeya.measure',
      { deltaExp: 4, nTubes: 32, packing: 0, res: 64 },
      buildPlan({ skill: 'kakeya.measure', goal: 'kakeya paper: N=32 baseline' }),
    )
    if (base.status !== 'ok' || !base.run?.result) throw new Error((base as { message?: string }).message ?? 'base failed')
    const b = base.run.result as { occupiedVolume: number; maxMultiplicity: number }

    const doubled = await executeSkill(
      'kakeya.measure',
      { deltaExp: 4, nTubes: 64, packing: 0, res: 64 },
      buildPlan({ skill: 'kakeya.measure', goal: 'kakeya paper: N=64 doubled' }),
    )
    if (doubled.status !== 'ok' || !doubled.run?.result) throw new Error((doubled as { message?: string }).message ?? 'doubled failed')
    const d = doubled.run.result as { occupiedVolume: number; maxMultiplicity: number }

    // paper claim direction: multiplicity GROWS with N (fibonacci tubes
    // share the base region — overlap near the origin is real geometry,
    // not an artifact; exact max depends on the discrete family)
    expect(d.maxMultiplicity).toBeGreaterThan(b.maxMultiplicity)
    // union volume grows but stays bounded (well below the trivial sum N·δ)
    expect(d.occupiedVolume).toBeGreaterThan(b.occupiedVolume)
    expect(d.occupiedVolume).toBeLessThan(1)
  })

  it('FINITE-SCALE honesty: the paper never claims theorem proof', () => {
    const doc = realDoc('geo-kakeya-tubes')
    const text = doc.items.map((i) => i.text ?? '').join(' ')
    expect(text).toContain('finite-scale')
    expect(text).toContain('not proved here')
  })
})
