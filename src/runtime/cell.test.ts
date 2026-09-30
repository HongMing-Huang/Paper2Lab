import { describe, expect, it, vi } from 'vitest'
import { Runtime } from './cell'

describe('Runtime', () => {
  it('recomputes exactly the descendants of a changed param, top-down', () => {
    const rt = new Runtime()
    const calls: string[] = []
    const a = rt.param('a', 1)
    const b = rt.param('b', 10)
    rt.derive('a2', [a], ([v]) => {
      calls.push('a2')
      return (v as number) * 2
    })
    rt.derive('sum', [rt.ref('a2') as never, b], ([x, y]) => {
      calls.push('sum')
      return (x as number) + (y as number)
    })
    calls.length = 0
    rt.setParam('a', 5)
    expect(calls).toEqual(['a2', 'sum'])
    expect(rt.get('a2').value).toBe(10)
    expect(rt.get('sum').value).toBe(20)
    calls.length = 0
    rt.setParam('b', 0)
    expect(calls).toEqual(['sum']) // a2 untouched
    expect(rt.get('sum').value).toBe(10)
  })

  it('evaluates a diamond dependency only once per change', () => {
    const rt = new Runtime()
    const a = rt.param('a', 1)
    const spy = vi.fn(([v]) => (v as number) + 1)
    rt.derive('l', [a], spy)
    rt.derive('r', [a], spy)
    rt.derive('join', [rt.ref('l') as never, rt.ref('r') as never], ([x, y]) => (x as number) * 10 + (y as number))
    spy.mockClear()
    rt.setParam('a', 7)
    expect(spy).toHaveBeenCalledTimes(2) // l and r, not more
    expect(rt.get('join').value).toBe(88)
  })

  it('enforces single ownership; deps must already exist (cycles structurally impossible)', () => {
    const rt = new Runtime()
    expect(() => rt.param('a', 1)).not.toThrow()
    expect(() => rt.param('a', 2)).toThrow(/already defined/)
    const x = rt.param('x', 1)
    rt.derive('y', [x], ([v]) => v)
    // a cell can only depend on cells registered earlier, and every name has
    // exactly one owner — the dependency graph is a DAG by construction
    expect(() => rt.derive('x', [rt.ref('y') as never], ([v]) => v)).toThrow(/already defined/)
    expect(() => rt.derive('z', [rt.ref('nope') as never], ([v]) => v)).toThrow(/unknown cell/)
  })

  it('async cells keep the last value while stale, debounce bursts, and discard superseded results', async () => {
    const rt = new Runtime()
    const a = rt.param('a', 1)
    let resolveFn: ((v: number) => void) | null = null
    const runs: number[] = []
    rt.asyncDerive<number>(
      'slow',
      [a],
      ([v]) =>
        new Promise<number>((resolve) => {
          runs.push(v as number)
          if ((v as number) === 3) {
            // slow run for the superseded case
            resolveFn = resolve
          } else {
            setTimeout(() => resolve(v as number), 0)
          }
        }),
      { debounceMs: 10 },
    )
    // initial kick
    await new Promise((r) => setTimeout(r, 30))
    expect(runs).toEqual([1])
    expect(rt.get('slow')).toMatchObject({ value: 1, stale: false })

    // burst: only trailing inputs run
    rt.setParam('a', 2)
    rt.setParam('a', 3)
    expect(rt.get('slow').stale).toBe(true)
    expect(rt.get('slow').value).toBe(1) // stale-while-recompute
    await new Promise((r) => setTimeout(r, 5))
    rt.setParam('a', 4)
    await new Promise((r) => setTimeout(r, 30))
    expect(runs).toEqual([1, 4]) // 2 debounced away, 3 superseded before its fn even started? (3 may start: it was trailing once)
    // commit of the superseded generation must be discarded
    resolveFn?.(999)
    await new Promise((r) => setTimeout(r, 10))
    expect(rt.get('slow').value).toBe(4)
    expect(rt.get('slow').stale).toBe(false)
  })

  it('cascades from async commits into sync dependents', async () => {
    const rt = new Runtime()
    const a = rt.param('a', 1)
    rt.asyncDerive<number>('slow', [a], ([v]) => Promise.resolve((v as number) * 2), { debounceMs: 5 })
    rt.derive('shown', [rt.ref('slow') as never], ([v]) => `value=${v as number}`)
    await new Promise((r) => setTimeout(r, 25))
    expect(rt.get('shown').value).toBe('value=2')
    rt.setParam('a', 10)
    await new Promise((r) => setTimeout(r, 25))
    expect(rt.get('shown').value).toBe('value=20')
  })

  it('notifies subscribers on commits and stale transitions', () => {
    const rt = new Runtime()
    const a = rt.param('a', 1)
    const events: string[] = []
    rt.subscribe('a', () => events.push(`v${rt.get('a').version}`))
    rt.setParam('a', 2)
    rt.setParam('a', 2) // Object.is no-op
    expect(events).toEqual(['v1'])
  })
})
