// Why: pure projection + grouping/sorting helpers for the model picker. These
// are framework-free so they run under the node vitest environment.

import { describe, expect, it } from 'vitest'
import {
  compareModels,
  groupModelsByProvider,
  modelLabel,
  projectModel,
  type PiRpcModel
} from './pi-model-catalog'

const anthropic = (overrides: Partial<PiRpcModel>): PiRpcModel => ({
  id: 'claude-sonnet-4-5',
  name: 'Claude Sonnet 4.5',
  provider: 'anthropic',
  ...overrides
})

describe('groupModelsByProvider', () => {
  it('groups by provider and sorts groups alphabetically', () => {
    const groups = groupModelsByProvider([
      anthropic({ id: 'a' }),
      { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
      anthropic({ id: 'b' })
    ])
    expect(groups.map((g) => g.provider)).toEqual(['anthropic', 'openai'])
    expect(groups[0].models.map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('buckets missing providers under an unknown group', () => {
    const groups = groupModelsByProvider([{ id: 'm', provider: '' }])
    expect(groups).toHaveLength(1)
    expect(groups[0].provider).toBe('unknown')
  })

  it('tolerates undefined/null input', () => {
    expect(groupModelsByProvider(undefined)).toEqual([])
    expect(groupModelsByProvider(null)).toEqual([])
  })
})

describe('compareModels', () => {
  it('floats featured models above non-featured within a provider', () => {
    const a = anthropic({ id: 'a' })
    const b = anthropic({ id: 'b', featured: true })
    expect(compareModels(a, b)).toBeGreaterThan(0)
    expect(compareModels(b, a)).toBeLessThan(0)
  })

  it('sorts equal-prominence models by display name', () => {
    const first = anthropic({ id: 'z', name: 'Alpha' })
    const second = anthropic({ id: 'a', name: 'Beta' })
    expect(compareModels(first, second)).toBeLessThan(0)
  })
})

describe('modelLabel', () => {
  it('uses the display name when present', () => {
    expect(modelLabel(anthropic({}))).toBe('Claude Sonnet 4.5')
  })

  it('falls back to the model id', () => {
    expect(modelLabel({ id: 'claude-opus', provider: 'anthropic' })).toBe('claude-opus')
  })
})

describe('projectModel', () => {
  it('maps a wire model onto the narrow projection', () => {
    const projected = projectModel({
      id: 'claude-opus-4-1',
      name: 'Claude Opus 4.1',
      api: 'anthropic-messages',
      provider: 'anthropic',
      reasoning: true,
      featured: true,
      contextWindow: 200000,
      maxTokens: 32000,
      cost: { input: 1 },
      headers: { 'x-extra': 'ignored' }
    })
    expect(projected).toEqual({
      id: 'claude-opus-4-1',
      name: 'Claude Opus 4.1',
      api: 'anthropic-messages',
      provider: 'anthropic',
      reasoning: true,
      featured: true,
      contextWindow: 200000,
      maxTokens: 32000
    })
  })

  it('returns null for malformed / missing model shapes', () => {
    expect(projectModel(undefined)).toBeNull()
    expect(projectModel(null)).toBeNull()
    expect(projectModel('claude')).toBeNull()
    expect(projectModel({})).toBeNull()
    expect(projectModel({ id: 'x' })).toBeNull()
    expect(projectModel({ provider: 'anthropic' })).toBeNull()
  })
})
