import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  PiProviderExtensionSpec,
  PiProviderModelSpec
} from '../../shared/pi-rpc'
import {
  buildProviderExtensionContent,
  looksLikeRawApiKey,
  validateProviderExtensionSpec,
  writeProviderExtension
} from './extension-writer'

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
  const dir = mkdtempSync(join(tmpdir(), 'pi-extension-writer-'))
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

describe('buildProviderExtensionContent', () => {
  it('renders registerProvider with provider id, name, baseUrl, api and models', () => {
    const spec = validSpec({
      models: [
        baseModel,
        { ...baseModel, id: 'acme/model-2', name: 'Acme Model 2', reasoning: true, maxTokens: 4096 }
      ]
    })
    const content = buildProviderExtensionContent(spec)
    expect(content).toContain('pi.registerProvider("acme", {')
    expect(content).toContain('name: "Acme AI"')
    expect(content).toContain('baseUrl: "https://api.acme.example/v1"')
    expect(content).toContain('api: "openai-completions"')
    expect(content).toContain('id: "acme/model-1"')
    expect(content).toContain('id: "acme/model-2"')
    expect(content).toContain('contextWindow: 128000')
    expect(content).toContain('maxTokens: 8192')
    expect(content).toContain('reasoning: true')
    expect(content).toContain('reasoning: false')
  })

  it('embeds the credential as an env var name, never a raw key', () => {
    const content = buildProviderExtensionContent(validSpec({ credential: 'ACME_API_KEY' }))
    expect(content).toContain('apiKey: "ACME_API_KEY"')
    expect(content).not.toContain('sk-')
    expect(content).not.toContain('a'.repeat(40))
  })

  it('embeds a !command credential verbatim', () => {
    const content = buildProviderExtensionContent(validSpec({ credential: '!secretcli get acme' }))
    expect(content).toContain('apiKey: "!secretcli get acme"')
  })

  it('escapes quotes in user-provided strings', () => {
    const content = buildProviderExtensionContent(
      validSpec({ providerName: 'Acme "Quoted" AI', models: [{ ...baseModel, name: 'Model "X"' }] })
    )
    expect(content).toContain('name: "Acme \\"Quoted\\" AI"')
    expect(content).toContain('name: "Model \\"X\\""')
  })
})

describe('writeProviderExtension', () => {
  it('writes the file at <dir>/<providerId>.ts and returns its path', () => {
    const dir = tempDir()
    const result = writeProviderExtension(validSpec(), dir)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.path).toBe(join(dir, 'acme.ts'))
      expect(existsSync(result.path)).toBe(true)
      const content = readFileSync(result.path, 'utf8')
      expect(content).toContain('pi.registerProvider("acme", {')
      expect(content).toContain('apiKey: "ACME_API_KEY"')
    }
  })

  it('creates nested extensions dir when missing', () => {
    const dir = join(tempDir(), 'nested', '.prime', 'extensions')
    const result = writeProviderExtension(validSpec(), dir)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(existsSync(result.path)).toBe(true)
    }
  })

  it('returns ok:false for an invalid spec without throwing', () => {
    const dir = tempDir()
    const result = writeProviderExtension(validSpec({ providerId: '../../evil' }), dir)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('slug')
    }
    expect(existsSync(join(dir, '..', 'evil.ts'))).toBe(false)
  })

  it('returns ok:false for a raw-looking credential without writing', () => {
    const dir = tempDir()
    const result = writeProviderExtension(
      validSpec({ credential: 'sk-12345678901234567890123456789012' }),
      dir
    )
    expect(result.ok).toBe(false)
  })
})
