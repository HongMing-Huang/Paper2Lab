// Regression tests for the two runtime blockers found on HEAD 2317325:
//  1. a stale async task could commit OLD-input values over NEWER params
//     (generation was bumped at launch, not at schedule — the debounce
//     window let the previous task's resolve pass the guard)
//  2. an invalid resolution (NaN) produced a SUCCESS-status NaN result
//     (setParam accepted non-finite numbers; commits lacked output checks)
import { describe, expect, it, vi } from 'vitest'
import { Runtime, assertFiniteNumbers } from './cell'

function tick(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

describe('stale async task cannot overwrite newer params', () => {
  it('old task resolving during the new schedule\'s debounce window is discarded', async () => {
    vi.useFakeTimers()
    try {
      const rt = new Runtime()
      const p = rt.param('p', 1)
      let releaseFirst: ((v: number) => void) | null = null
      let calls = 0
      const cell = rt.asyncDerive<number>('c', [p], (inputs) => {
        calls++
        const input = inputs[0] as number
        if (calls === 1) {
          // first task hangs until we release it
          return new Promise<number>((res) => {
            releaseFirst = res
          })
        }
        return Promise.resolve(input * 10)
      }, { debounceMs: 100 })
      void cell
      rt.subscribe('c', () => {}) // lazy async cells (#23): interest first

      // first computation launches after debounce
      await vi.advanceTimersByTimeAsync(120)
      expect(rt.get('c').status).toBe('computing')

      // param changes while task #1 is in flight → schedules run #2
      rt.setParam('p', 2)

      // task #1 (old inputs) resolves DURING run #2's debounce window —
      // the exact window that used to commit the stale value
      releaseFirst!(999)
      await vi.advanceTimersByTimeAsync(0)
      // stale value 999 must NOT be committed
      expect(rt.get('c').value).not.toBe(999)
      expect(rt.get('c').status).not.toBe('resolved')

      // run #2 fires and commits the NEW param's value
      await vi.advanceTimersByTimeAsync(150)
      expect(rt.get('c').value).toBe(20)
      expect(rt.get('c').status).toBe('resolved')
    } finally {
      vi.useRealTimers()
    }
  })

  it('out-of-order completion: slower old task never lands after the newer one', async () => {
    const rt = new Runtime()
    const p = rt.param('p', 1)
    const resolvers: Array<(v: number) => void> = []
    rt.asyncDerive<number>('c', [p], (inputs) => {
      const input = inputs[0] as number
      return new Promise<number>((res) => resolvers.push(() => res(input * 100)))
    }, { debounceMs: 10 })
    rt.subscribe('c', () => {}) // lazy async cells (#23): interest first
    await tick(30)
    rt.setParam('p', 5)
    await tick(30)
    expect(resolvers.length).toBe(2)
    // newer task finishes first
    resolvers[1](/* unused */ 0)
    resolvers.pop()
    await tick(5)
    // now the OLD task finishes late — must be discarded
    resolvers[0](0)
    await tick(5)
    expect(rt.get('c').value).toBe(500)
    expect(rt.get('c').status).toBe('resolved')
  })
})

describe('invalid numerics never produce success-status NaN', () => {
  it('setParam rejects NaN and ±Infinity at the boundary', () => {
    const rt = new Runtime()
    rt.param('res', 48)
    expect(() => rt.setParam('res', NaN)).toThrow(/non-finite/)
    expect(() => rt.setParam('res', Infinity)).toThrow(/non-finite/)
    expect(() => rt.setParam('res', -Infinity)).toThrow(/non-finite/)
    expect(rt.get('res').value).toBe(48) // unchanged
  })

  it('async commit with NaN output → error status, value rejected', async () => {
    const rt = new Runtime()
    const p = rt.param('p', 1)
    const c = rt.asyncDerive<Record<string, number>>('c', [p], async () => ({
      occupiedVolume: NaN,
      maxMultiplicity: 3,
    }), {
      debounceMs: 0,
      validate: (v) => assertFiniteNumbers(v, 'c'),
    })
    void c
    rt.subscribe('c', () => {}) // lazy async cells (#23): interest first
    await tick(30)
    const s = rt.get('c')
    expect(s.status).toBe('error')
    expect(s.hasValue).toBe(false)
    expect(String(s.error)).toMatch(/occupiedVolume is not finite/)
  })

  it('assertFiniteNumbers walks nested objects and arrays', () => {
    expect(assertFiniteNumbers({ a: 1, b: [1, 2, { c: 3 }] })).toBeNull()
    expect(assertFiniteNumbers({ a: 1, b: [{ c: NaN }] })).toMatch(/NaN|not finite/)
    expect(assertFiniteNumbers({ a: Infinity })).toMatch(/Infinity|not finite/)
    expect(assertFiniteNumbers({ vis: new Uint16Array(4) })).toBeNull() // typed arrays untouched
  })
})
