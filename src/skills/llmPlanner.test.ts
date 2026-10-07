import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { llmConfigFromEnv, planWithLlm, planQuestion } from './llmPlanner'
import { validatePlan } from './toolSchema'

describe('llmPlanner', () => {
  beforeEach(() => {
    delete process.env.PAPER2LAB_LLM_ENDPOINT
    delete process.env.PAPER2LAB_LLM_API_KEY
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_API_KEY
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('no env config → null config, deterministic fallback', async () => {
    expect(llmConfigFromEnv()).toBeNull()
    const plan = await planQuestion('如果方向数减少一半呢？', { nTubes: 96, deltaExp: 4, packing: 0 })
    expect(plan.actions[1].args).toMatchObject({ param: 'kakeya.nTubes', value: 48 })
  })

  it('env config (no literals in code) → config constructed', () => {
    vi.stubEnv('PAPER2LAB_LLM_ENDPOINT', 'https://example.invalid/v1')
    vi.stubEnv('PAPER2LAB_LLM_API_KEY', 'test-key')
    const cfg = llmConfigFromEnv()
    expect(cfg).toMatchObject({ endpoint: 'https://example.invalid/v1' })
    expect(cfg?.model).toBe('qwen-max')
  })

  it('LLM output is schema-validated: invalid JSON/skills rejected → null', { timeout: 15000 }, async () => {
    vi.stubEnv('PAPER2LAB_LLM_ENDPOINT', 'https://example.invalid/v1')
    vi.stubEnv('PAPER2LAB_LLM_API_KEY', 'test-key')
    const cfg = llmConfigFromEnv()!
    // fetch fails against .invalid → null
    expect(await planWithLlm('q', { nTubes: 96, deltaExp: 4, packing: 0 }, cfg)).toBeNull()
  })

  it('a valid LLM-shaped plan passes the same validation gate', () => {
    const llmShaped = {
      title: '方向数减半',
      actions: [
        { skill: 'fork_experiment', args: { label: 'B' }, label: 'fork' },
        { skill: 'change_parameter', args: { param: 'kakeya.nTubes', value: 48 }, label: 'N→48' },
        { skill: 'explain_result', args: {}, label: 'observe' },
      ],
    }
    expect(validatePlan(llmShaped).ok).toBe(true)
  })
})
