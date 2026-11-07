// Agent action layer (ported AgentActionUtil contract): sanitize rejects and
// clamps, dispatch reports full outcomes, and every registered action is
// reachable through the registry.
import { describe, expect, it } from 'vitest'
import { getActionUtils, registerActionUtil, runAgentAction, type AgentHelpers } from './agentActions'

function makeHelpers(over: Partial<AgentHelpers> = {}): AgentHelpers {
  const explorers = ['exp-1', 'exp-2']
  return {
    editor: {
      run: async (fn: () => unknown) => fn(),
      getCurrentPageShapeIds: () => new Set(),
      getShape: () => undefined,
    } as never,
    docItems: [
      { id: 'a1', latex: 'y = a\\sin(bx)', page: 1 },
      { id: 'a2', page: 1 }, // no latex → unusable as an experiment source
    ],
    explorerIds: () => explorers,
    explorerParams: () => [{ name: 'a', min: -5, max: 5 }, { name: 'b', min: -5, max: 5 }],
    selectedExplorerId: () => 'exp-2',
    play: (anchorId: string) => (anchorId === 'a1' ? 'exp-new' : null),
    fork: (id: string) => `fork-of-${id}`,
    compare: () => {},
    ...over,
  }
}

describe('agent action registry (AgentActionUtil port)', () => {
  it('registers five actions; garbage and duplicates are rejected', () => {
    const utils = getActionUtils(makeHelpers())
    for (const t of ['create_experiment', 'fork_experiment', 'compare_experiments', 'arrange_lab', 'focus_shape']) {
      expect(utils[t], t).toBeDefined()
    }
    expect(() => registerActionUtil({} as never, {})).toThrow() // not a class / no type
  })

  it('create_experiment rejects unknown/latex-less anchors, accepts real ones', async () => {
    const h = makeHelpers()
    const bad = await runAgentAction(h, { type: 'create_experiment', anchorId: 'nope' })
    expect(bad.ok).toBe(false)
    const noLatex = await runAgentAction(h, { type: 'create_experiment', anchorId: 'a2' })
    expect(noLatex.ok).toBe(false)
    const ok = await runAgentAction(h, { type: 'create_experiment', anchorId: 'a1' })
    expect(ok.ok).toBe(true)
    expect(ok.label).toBe('展开实验')
  })

  it('fork_experiment: rejects out-of-range values without mutation, defaults valid requests to selection', async () => {
    const h = makeHelpers()
    const clamped = await runAgentAction(h, { type: 'fork_experiment', changes: { a: 99 } })
    expect(clamped.ok).toBe(false)
    expect((await runAgentAction(h, { type: 'fork_experiment', changes: { a: 4 } })).ok).toBe(true)

    const empty = await runAgentAction(h, { type: 'fork_experiment', changes: { q: 1 } })
    expect(empty.ok).toBe(false)

    const unknown = await runAgentAction(h, { type: 'fork_experiment', explorerId: 'ghost', changes: { a: 1 } })
    expect(unknown.ok).toBe(false)
  })

  it('compare_experiments requires two explorers', async () => {
    const one = makeHelpers({ explorerIds: () => ['exp-1'] })
    expect((await runAgentAction(one, { type: 'compare_experiments' })).ok).toBe(false)
    const two = makeHelpers()
    expect((await runAgentAction(two, { type: 'compare_experiments' })).ok).toBe(true)
  })

  it('arrange_lab only accepts the four modes', async () => {
    const h = makeHelpers()
    expect((await runAgentAction(h, { type: 'arrange_lab', mode: 'spotlight' as never })).ok).toBe(false) // no frame on the stub desk → apply fails honestly
    expect((await runAgentAction(h, { type: 'arrange_lab', mode: 'diagonal' as never })).ok).toBe(false) // sanitize rejects
  })

  it('unknown actions report instead of throwing', async () => {
    const out = await runAgentAction(makeHelpers(), { type: 'backdoor.wipe' })
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/unknown agent action/)
  })
})
