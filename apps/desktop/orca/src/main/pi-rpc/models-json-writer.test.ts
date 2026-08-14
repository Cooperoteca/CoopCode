import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  PiProviderExtensionSpec,
  PiProviderModelSpec
} from '../../shared/pi-rpc'
import {
  buildProviderEntry,
  listProvidersFromModelsJson,
  looksLikeRawApiKey,
  validateProviderExtensionSpec,
  writeProviderToModelsJson
} from './models-json-writer'

const baseModel: PiProviderModelSpec = {
  id: 'acme/model-1',
  name: 'Acme Model 1',
  contextWindow: 128000,
  maxTokens: 8192,
  reasoning: false
}

function validSpec(overrides: Partial<PiProviderExtensionSpec> = {}): PiProviderExtensionSpec {
  return {
    providerId: 'acme',
    providerName: 'Acme AI',
    baseUrl: 'https://api.acme.example/v1',
    api: 'openai-completions',
    credential: 'ACME_API_KEY',
    models: [baseModel],
    ...overrides
  }
}

const tempDirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pi-models-json-writer-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('looksLikeRawApiKey', () => {
  it('flags sk- prefixed strings', () => {
    expect(looksLikeRawApiKey('sk-12345678901234567890123456789012')).toBe(true)
    expect(looksLikeRawApiKey('SK-ABC')).toBe(true)
  })

  it('flags 40+ char strings without whitespace', () => {
    expect(looksLikeRawApiKey('a'.repeat(40))).toBe(true)
    expect(looksLikeRawApiKey(`${'a'.repeat(39)} b`)).toBe(false)
  })

  it('allows env var names and !commands', () => {
    expect(looksLikeRawApiKey('ACME_API_KEY')).toBe(false)
    expect(looksLikeRawApiKey('!secretcli get acme')).toBe(false)
  })
})

describe('validateProviderExtensionSpec', () => {
  it('accepts a valid spec', () => {
    expect(validateProviderExtensionSpec(validSpec())).toBeNull()
  })

  it('rejects path-traversal provider ids', () => {
    expect(validateProviderExtensionSpec(validSpec({ providerId: '../../evil' }))).not.toBeNull()
    expect(validateProviderExtensionSpec(validSpec({ providerId: 'a/b' }))).not.toBeNull()
    expect(validateProviderExtensionSpec(validSpec({ providerId: '..' }))).not.toBeNull()
  })

  it('rejects provider ids that are unsafe filenames', () => {
    expect(validateProviderExtensionSpec(validSpec({ providerId: 'a b' }))).not.toBeNull()
    expect(validateProviderExtensionSpec(validSpec({ providerId: 'a.b' }))).not.toBeNull()
    expect(validateProviderExtensionSpec(validSpec({ providerId: '' }))).not.toBeNull()
  })

  it('rejects a raw-looking credential', () => {
    expect(
      validateProviderExtensionSpec(validSpec({ credential: 'sk-12345678901234567890123456789012' }))
    ).not.toBeNull()
    expect(validateProviderExtensionSpec(validSpec({ credential: 'a'.repeat(40) }))).not.toBeNull()
  })

  it('rejects a credential that is neither env var name nor !command', () => {
    expect(validateProviderExtensionSpec(validSpec({ credential: 'not a var' }))).not.toBeNull()
    expect(validateProviderExtensionSpec(validSpec({ credential: '' }))).not.toBeNull()
  })

  it('invalid baseUrl is rejected', () => {
    expect(validateProviderExtensionSpec(validSpec({ baseUrl: 'not-a-url' }))).not.toBeNull()
    expect(validateProviderExtensionSpec(validSpec({ baseUrl: 'ftp://x' }))).not.toBeNull()
  })

  it('rejects empty models', () => {
    expect(validateProviderExtensionSpec(validSpec({ models: [] }))).not.toBeNull()
  })

  it('rejects invalid model numbers', () => {
    expect(
      validateProviderExtensionSpec(validSpec({ models: [{ ...baseModel, contextWindow: 0 }] }))
    ).not.toBeNull()
    expect(
      validateProviderExtensionSpec(validSpec({ models: [{ ...baseModel, contextWindow: -5 }] }))
    ).not.toBeNull()
    expect(
      validateProviderExtensionSpec(validSpec({ models: [{ ...baseModel, maxTokens: 1.5 }] }))
    ).not.toBeNull()
  })
})

describe('buildProviderEntry', () => {
  it('maps the spec onto the models.json provider shape', () => {
    const entry = buildProviderEntry(
      validSpec({
        models: [
          baseModel,
          { ...baseModel, id: 'acme/model-2', name: 'Acme Model 2', reasoning: true, maxTokens: 4096 }
        ]
      })
    )
    expect(entry).toEqual({
      name: 'Acme AI',
      baseUrl: 'https://api.acme.example/v1',
      apiKey: 'ACME_API_KEY',
      api: 'openai-completions',
      models: [
        { id: 'acme/model-1', name: 'Acme Model 1', reasoning: false, contextWindow: 128000, maxTokens: 8192 },
        { id: 'acme/model-2', name: 'Acme Model 2', reasoning: true, contextWindow: 128000, maxTokens: 4096 }
      ]
    })
  })

  it('stores the credential as apiKey, never a raw key', () => {
    const entry = buildProviderEntry(validSpec({ credential: '!secretcli get acme' }))
    expect(entry.apiKey).toBe('!secretcli get acme')
  })
})

describe('writeProviderToModelsJson', () => {
  it('writes providers["<id>"] with name, baseUrl, apiKey, api and models', () => {
    const dir = tempDir()
    const modelsPath = join(dir, 'models.json')
    const result = writeProviderToModelsJson(validSpec(), modelsPath)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.path).toBe(modelsPath)
    }
    const parsed = JSON.parse(readFileSync(modelsPath, 'utf8'))
    expect(parsed.providers.acme).toEqual({
      name: 'Acme AI',
      baseUrl: 'https://api.acme.example/v1',
      apiKey: 'ACME_API_KEY',
      api: 'openai-completions',
      models: [
        { id: 'acme/model-1', name: 'Acme Model 1', reasoning: false, contextWindow: 128000, maxTokens: 8192 }
      ]
    })
  })

  it('merges into an existing providers map without rewriting the file from form state', () => {
    const dir = tempDir()
    const modelsPath = join(dir, 'models.json')
    writeFileSync(
      modelsPath,
      JSON.stringify(
        {
          providers: {
            alpha: { name: 'Alpha', baseUrl: 'https://a.example', apiKey: 'A_KEY', api: 'openai-completions', models: [{ id: 'a/m1' }] },
            beta: { name: 'Beta', baseUrl: 'https://b.example', apiKey: 'B_KEY', api: 'openai-completions', models: [{ id: 'b/m1' }] }
          }
        },
        null,
        2
      )
    )
    const result = writeProviderToModelsJson(validSpec({ providerId: 'gamma' }), modelsPath)
    expect(result.ok).toBe(true)
    const parsed = JSON.parse(readFileSync(modelsPath, 'utf8'))
    expect(Object.keys(parsed.providers).sort()).toEqual(['alpha', 'beta', 'gamma'])
    expect(parsed.providers.alpha.name).toBe('Alpha')
    expect(parsed.providers.beta.name).toBe('Beta')
    expect(parsed.providers.gamma.name).toBe('Acme AI')
  })

  it('overwrites an entry whose id already exists', () => {
    const dir = tempDir()
    const modelsPath = join(dir, 'models.json')
    writeFileSync(
      modelsPath,
      JSON.stringify({
        providers: {
          acme: { name: 'Old Name', baseUrl: 'https://old.example', apiKey: 'OLD_KEY', api: 'openai-completions', models: [{ id: 'old/m1' }] }
        }
      })
    )
    const result = writeProviderToModelsJson(validSpec({ providerName: 'New Name' }), modelsPath)
    expect(result.ok).toBe(true)
    const parsed = JSON.parse(readFileSync(modelsPath, 'utf8'))
    expect(parsed.providers.acme.name).toBe('New Name')
    expect(parsed.providers.acme.models[0].id).toBe('acme/model-1')
  })

  it('writes atomically: a failure mid-write leaves the original untouched', () => {
    const dir = tempDir()
    const modelsPath = join(dir, 'models.json')
    const original = JSON.stringify({
      providers: {
        alpha: { name: 'Alpha', baseUrl: 'https://a.example', apiKey: 'A_KEY', api: 'openai-completions', models: [{ id: 'a/m1' }] }
      }
    })
    writeFileSync(modelsPath, original)
    // A directory squatting on the temp path makes the temp write fail (EISDIR),
    // simulating a failure before the rename can publish anything.
    mkdirSync(`${modelsPath}.tmp`)
    const result = writeProviderToModelsJson(validSpec({ providerId: 'gamma' }), modelsPath)
    expect(result.ok).toBe(false)
    expect(readFileSync(modelsPath, 'utf8')).toBe(original)
  })

  it('refuses to overwrite a malformed (non-JSON) models.json, naming the file', () => {
    const dir = tempDir()
    const modelsPath = join(dir, 'models.json')
    writeFileSync(modelsPath, '{ this is not json')
    const result = writeProviderToModelsJson(validSpec(), modelsPath)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('models.json')
      expect(result.error).toContain(modelsPath)
    }
    expect(readFileSync(modelsPath, 'utf8')).toBe('{ this is not json')
  })

  it('refuses to overwrite a non-object models.json, naming the file', () => {
    const dir = tempDir()
    const modelsPath = join(dir, 'models.json')
    writeFileSync(modelsPath, '[1, 2, 3]')
    const result = writeProviderToModelsJson(validSpec(), modelsPath)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain(modelsPath)
    }
    expect(readFileSync(modelsPath, 'utf8')).toBe('[1, 2, 3]')
  })

  it('creates the parent directory when missing', () => {
    const dir = join(tempDir(), 'nested', '.prime', 'agent')
    const modelsPath = join(dir, 'models.json')
    const result = writeProviderToModelsJson(validSpec(), modelsPath)
    expect(result.ok).toBe(true)
    expect(existsSync(modelsPath)).toBe(true)
  })

  it('returns ok:false for an invalid spec without throwing', () => {
    const dir = tempDir()
    const result = writeProviderToModelsJson(validSpec({ providerId: '../../evil' }), join(dir, 'models.json'))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('slug')
    }
    expect(existsSync(join(dir, 'models.json'))).toBe(false)
  })

  it('returns ok:false for a raw-looking credential without writing', () => {
    const dir = tempDir()
    const modelsPath = join(dir, 'models.json')
    const result = writeProviderToModelsJson(
      validSpec({ credential: 'sk-12345678901234567890123456789012' }),
      modelsPath
    )
    expect(result.ok).toBe(false)
    expect(existsSync(modelsPath)).toBe(false)
  })
})

describe('listProvidersFromModelsJson', () => {
  it('lists id, display name and model count', () => {
    const dir = tempDir()
    const modelsPath = join(dir, 'models.json')
    writeFileSync(
      modelsPath,
      JSON.stringify({
        providers: {
          alpha: { name: 'Alpha', models: [{ id: 'a/m1' }, { id: 'a/m2' }] },
          beta: { name: 'Beta', models: [{ id: 'b/m1' }] }
        }
      })
    )
    const result = listProvidersFromModelsJson(modelsPath)
    expect(result.error).toBeUndefined()
    expect(result.providers).toEqual([
      { id: 'alpha', name: 'Alpha', modelCount: 2 },
      { id: 'beta', name: 'Beta', modelCount: 1 }
    ])
  })

  it('returns an empty list for a missing file', () => {
    const result = listProvidersFromModelsJson(join(tempDir(), 'models.json'))
    expect(result.providers).toEqual([])
    expect(result.error).toBeUndefined()
  })

  it('returns an empty list plus an error for a malformed file', () => {
    const dir = tempDir()
    const modelsPath = join(dir, 'models.json')
    writeFileSync(modelsPath, 'not json')
    const result = listProvidersFromModelsJson(modelsPath)
    expect(result.providers).toEqual([])
    expect(result.error).toContain('models.json')
  })
})
