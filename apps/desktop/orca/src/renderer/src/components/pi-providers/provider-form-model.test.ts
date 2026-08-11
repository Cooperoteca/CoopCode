import { describe, expect, it } from 'vitest'
import type { ProviderFormDraft } from './provider-form-model'
import {
  emptyProviderModelDraft,
  isProviderFormValid,
  isValidProviderSlug,
  looksLikeApiKey,
  toProviderExtensionSpec,
  validateCredentialReference,
  validateProviderForm
} from './provider-form-model'

function draft(overrides: Partial<ProviderFormDraft> = {}): ProviderFormDraft {
  return {
    providerId: 'acme',
    providerName: 'Acme AI',
    baseUrl: 'https://api.acme.example/v1',
    api: 'openai-completions',
    credential: 'ACME_API_KEY',
    models: [{ ...emptyProviderModelDraft('m1'), id: 'acme/m1', name: 'M1', contextWindow: '128000', maxTokens: '8192' }],
    ...overrides
  }
}

describe('isValidProviderSlug', () => {
  it('accepts safe slugs', () => {
    expect(isValidProviderSlug('acme')).toBe(true)
    expect(isValidProviderSlug('acme-2')).toBe(true)
    expect(isValidProviderSlug('acme_provider')).toBe(true)
  })
  it('rejects path traversal and unsafe names', () => {
    expect(isValidProviderSlug('../../evil')).toBe(false)
    expect(isValidProviderSlug('a/b')).toBe(false)
    expect(isValidProviderSlug('a b')).toBe(false)
    expect(isValidProviderSlug('a.b')).toBe(false)
    expect(isValidProviderSlug('')).toBe(false)
  })
})

describe('looksLikeApiKey / validateCredentialReference', () => {
  it('flags sk- prefixed and 40+ char no-space strings', () => {
    expect(looksLikeApiKey('sk-12345678901234567890123456789012')).toBe(true)
    expect(looksLikeApiKey('a'.repeat(40))).toBe(true)
    expect(looksLikeApiKey('ACME_API_KEY')).toBe(false)
    expect(looksLikeApiKey('!secretcli get acme')).toBe(false)
  })

  it('returns the looksLikeKey code for a raw-looking credential', () => {
    expect(validateCredentialReference('sk-12345678901234567890123456789012')).toBe(
      'credential.looksLikeKey'
    )
    expect(validateCredentialReference('a'.repeat(40))).toBe('credential.looksLikeKey')
  })

  it('accepts env var names and !commands', () => {
    expect(validateCredentialReference('ACME_API_KEY')).toBeNull()
    expect(validateCredentialReference('!secretcli get acme')).toBeNull()
  })

  it('rejects empty and non-reference strings', () => {
    expect(validateCredentialReference('')).toBe('credential.required')
    expect(validateCredentialReference('not a var')).toBe('credential.invalidRef')
    expect(validateCredentialReference('has spaces')).toBe('credential.invalidRef')
  })
})

describe('validateProviderForm', () => {
  it('accepts a fully valid form', () => {
    const errors = validateProviderForm(draft())
    expect(isProviderFormValid(errors)).toBe(true)
  })

  it('rejects a raw API key credential at the field level', () => {
    const errors = validateProviderForm(draft({ credential: 'sk-12345678901234567890123456789012' }))
    expect(errors.credential).toBe('credential.looksLikeKey')
    expect(isProviderFormValid(errors)).toBe(false)
  })

  it('rejects path-traversal provider ids', () => {
    const errors = validateProviderForm(draft({ providerId: '../../evil' }))
    expect(errors.providerId).toBe('providerId.slug')
  })

  it('rejects invalid baseUrl', () => {
    expect(validateProviderForm(draft({ baseUrl: 'not a url' })).baseUrl).toBe('baseUrl.invalid')
    expect(validateProviderForm(draft({ baseUrl: 'ftp://x' })).baseUrl).toBe('baseUrl.invalid')
  })

  it('requires at least one model', () => {
    const errors = validateProviderForm(draft({ models: [] }))
    expect(errors.models).toBe('models.required')
  })

  it('collects per-model errors for bad numbers / empties', () => {
    const errors = validateProviderForm(
      draft({
        models: [
          {
            ...emptyProviderModelDraft('m1'),
            id: 'acme/m1',
            name: 'M1',
            contextWindow: '0',
            maxTokens: '-5'
          }
        ]
      })
    )
    expect(errors.byModel?.[0]?.contextWindow).toBe('model.contextWindow.positive')
    expect(errors.byModel?.[0]?.maxTokens).toBe('model.maxTokens.positive')
    expect(isProviderFormValid(errors)).toBe(false)
  })
})

describe('toProviderExtensionSpec', () => {
  it('shapes numbers and trims strings', () => {
    const spec = toProviderExtensionSpec(
      draft({ credential: ' !secretcli get acme ', providerId: ' acme ' })
    )
    expect(spec.providerId).toBe('acme')
    expect(spec.credential).toBe('!secretcli get acme')
    expect(spec.models[0].contextWindow).toBe(128000)
    expect(spec.models[0].maxTokens).toBe(8192)
    expect(spec.models[0].reasoning).toBe(false)
  })
})
