import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  PiExtensionWriteResult,
  PiProviderExtensionSpec,
  PiProviderModelSpec
} from '../../shared/pi-rpc'

/**
 * Writes a pi provider extension file into the pi extensions directory, in the
 * exact format the pi CLI loads (see ~/.prime/agent/extensions/clinepass.ts):
 *
 *   import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
 *   export default function (pi) { pi.registerProvider(...) }
 *
 * Security model: the renderer never handles raw API keys. `credential` is
 * either the NAME of an environment variable or a `!command` (see resolution in
 * packages/coding-agent/src/core/resolve-config-value.ts). This module revalidates
 * everything defensively (slug id, credential not a raw key, >=1 model, positive
 * numbers) and returns a PiExtensionWriteResult instead of throwing, so a bad
 * input or fs error surfaces to the renderer as `{ ok:false, error }`, never as
 * an unhandled exception crossing the IPC boundary.
 */

// A provider id must be safe to use as both a <name>.ts file base name and a
// registerProvider() identifier: alphanumeric start, then [A-Za-z0-9_-]. This
// form alone rejects path traversal (`../`, `/`, backslashes, `..`).
// Indentation/newline helpers for the generated TypeScript (tabs mirror clinepass.ts).
const TAB = '\t'
const NL = '\n'

const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

// Credential that looks like an actual API key is refused. Env variable names
// and !commands never carry these two signatures.
export function looksLikeRawApiKey(credential: string): boolean {
  const trimmed = credential.trim()
  if (/^sk-/i.test(trimmed)) {
    return true
  }
  return trimmed.length >= 40 && !trimmed.includes(' ')
}

/**
 * Returns a human-readable reason the spec is invalid, or null when valid.
 * Internal (non-localized) sentence; the renderer localized its own messages
 * before sending — this is defense in depth for whoever calls the main handler.
 */
export function validateProviderExtensionSpec(
  spec: PiProviderExtensionSpec
): string | null {
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) {
    return 'Invalid provider spec payload'
  }
  if (!SAFE_ID_RE.test(spec.providerId)) {
    return 'providerId must be a safe slug (letters, digits, - and _)'
  }
  if (!spec.providerName || typeof spec.providerName !== 'string') {
    return 'providerName is required'
  }
  if (typeof spec.baseUrl !== 'string' || !isHttpUrl(spec.baseUrl)) {
    return 'baseUrl must be a valid http(s) URL'
  }
  if (!spec.api || typeof spec.api !== 'string') {
    return 'api is required'
  }
  if (typeof spec.credential !== 'string' || spec.credential.trim() === '') {
    return 'credential is required'
  }
  if (looksLikeRawApiKey(spec.credential)) {
    return 'credential must be an environment variable name or a !command, never a raw API key'
  }
  if (
    !spec.credential.startsWith('!') &&
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(spec.credential.trim())
  ) {
    return 'credential must be an environment variable name or a !command'
  }
  if (!Array.isArray(spec.models) || spec.models.length === 0) {
    return 'at least one model is required'
  }
  for (const model of spec.models) {
    const reason = validateProviderModelSpec(model)
    if (reason) {
      return reason
    }
  }
  return null
}

/** Returns a reason an individual model is invalid, or null when valid. */
export function validateProviderModelSpec(
  model: PiProviderModelSpec
): string | null {
  if (typeof model !== 'object' || model === null || Array.isArray(model)) {
    return 'invalid model entry'
  }
  if (!model.id || typeof model.id !== 'string') {
    return 'model id is required'
  }
  if (!model.name || typeof model.name !== 'string') {
    return 'model name is required'
  }
  if (!isPositiveInteger(model.contextWindow)) {
    return 'contextWindow must be a positive integer'
  }
  if (!isPositiveInteger(model.maxTokens)) {
    return 'maxTokens must be a positive integer'
  }
  if (typeof model.reasoning !== 'boolean') {
    return 'reasoning must be a boolean'
  }
  return null
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isHttpUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return url.protocol === 'http:' || url.protocol === 'https:'
}

/**
 * Builds the TypeScript source for a provider extension, mirroring the
 * clinepass.ts format (zero cost, input ["text"], apiKey as env-var name).
 * String values are JSON-escaped so quotes/backslashes in user input cannot
 * break out of the generated strings.
 */
export function buildProviderExtensionContent(spec: PiProviderExtensionSpec): string {
  const models = spec.models
    .map((m, index) => {
      const comma = index === spec.models.length - 1 ? '' : ','
      return [
        `${TAB.repeat(4)  }{`,
        `${TAB.repeat(5)  }id: ${JSON.stringify(m.id)},`,
        `${TAB.repeat(5)  }name: ${JSON.stringify(m.name)},`,
        `${TAB.repeat(5)  }reasoning: ${m.reasoning ? 'true' : 'false'},`,
        `${TAB.repeat(5)  }input: ["text"],`,
        // Why: cost copied from clinepass.ts — per-usage pricing is out of scope
        // for this spike, so zero keeps tracking honest until real costs.
        `${TAB.repeat(5)  }cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },`,
        `${TAB.repeat(5)  }contextWindow: ${m.contextWindow},`,
        `${TAB.repeat(5)  }maxTokens: ${m.maxTokens},`,
        `${TAB.repeat(4)  }}${comma}`
      ].join(NL)
    })
    .join(NL)

  return (
    [
      'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";',
      '',
      `// ${spec.providerName} (${spec.baseUrl})`,
      '// `apiKey` below is the NAME of an environment variable or a `!command`, not the key itself.',
      '// Resolution (packages/coding-agent/src/core/resolve-config-value.ts):',
      '//   - starts with "!": executed as a shell command; its stdout is used as the key.',
      '//   - otherwise: read from the process environment. If the variable is NOT set,',
      '//     the string is used verbatim and the provider replies 401 — which looks like',
      '//     an invalid key but is actually a missing/incorrect environment variable.',
      'export default function (pi: ExtensionAPI) {',
      TAB + `pi.registerProvider(${JSON.stringify(spec.providerId)}, {`,
      TAB.repeat(2) + `name: ${JSON.stringify(spec.providerName)},`,
      TAB.repeat(2) + `baseUrl: ${JSON.stringify(spec.baseUrl)},`,
      TAB.repeat(2) + `apiKey: ${JSON.stringify(spec.credential)},`,
      TAB.repeat(2) + `api: ${JSON.stringify(spec.api)},`,
      TAB.repeat(2) + 'models: [',
      models,
      TAB.repeat(2) + '],',
      TAB + '});',
      '}'
    ].join(NL) + NL
  )
}

/**
 * Writes the provider extension to <extensionsDir>/<providerId>.ts after
 * revalidating. Creates the extensions dir recursively when missing. Never
 * throws: returns a PiExtensionWriteResult so callers can report failures.
 */
export function writeProviderExtension(
  spec: PiProviderExtensionSpec,
  extensionsDir: string
): PiExtensionWriteResult {
  const validationError = validateProviderExtensionSpec(spec)
  if (validationError) {
    return { ok: false, error: validationError }
  }
  try {
    mkdirSync(extensionsDir, { recursive: true })
    const targetPath = join(extensionsDir, `${spec.providerId}.ts`)
    writeFileSync(targetPath, buildProviderExtensionContent(spec), 'utf8')
    return { ok: true, path: targetPath }
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Failed to write extension: ${error.message}`
          : 'Failed to write extension'
    }
  }
}
