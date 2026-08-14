import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  PiExtensionWriteResult,
  PiProviderExtensionSpec,
  PiProviderModelSpec,
  PiProvidersListResult,
  PiProviderSummary
} from '../../shared/pi-rpc'

/**
 * Writes pi custom providers into <agentDir>/models.json, the file pi already
 * defines and validates for exactly this (see
 * packages/coding-agent/src/core/model-registry.ts `ProviderConfigSchema` and
 * `ModelsConfigSchema`). The shape written is:
 *
 *   { "providers": { "<id>": { name, baseUrl, apiKey, api, models: [...] } } }
 *
 * Security model: the renderer never handles raw API keys. `credential` is
 * either the NAME of an environment variable or a `!command`; it is stored as
 * `apiKey` and resolved later by pi's `resolveConfigValue`
 * (packages/coding-agent/src/core/resolve-config-value.ts), identical to the old
 * extension path. This module revalidates everything defensively (slug id,
 * credential not a raw key, >=1 model, positive numbers) and returns a
 * PiExtensionWriteResult instead of throwing, so a bad input or fs error
 * surfaces to the renderer as `{ ok:false, error }`, never as an unhandled
 * exception crossing the IPC boundary.
 *
 * The writer merges into the existing `providers` map rather than rewriting the
 * file from the form's state, writes atomically (temp file in the same directory
 * renamed over the target), and refuses to overwrite a malformed or non-JSON
 * models.json so the user can repair it by hand.
 */

// A provider id must be safe to use as a models.json key: alphanumeric start,
// then [A-Za-z0-9_-]. This form alone rejects path traversal (`../`, `/`,
// backslashes, `..`).
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Builds the models.json provider entry for a validated spec. `credential` is
 * stored as `apiKey` (an env-var NAME or `!command`, never a raw key); the model
 * entries carry exactly the fields the form edits.
 */
export function buildProviderEntry(spec: PiProviderExtensionSpec): Record<string, unknown> {
  return {
    name: spec.providerName,
    baseUrl: spec.baseUrl,
    apiKey: spec.credential,
    api: spec.api,
    models: spec.models.map((model) => ({
      id: model.id,
      name: model.name,
      reasoning: model.reasoning,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens
    }))
  }
}

type ModelsJsonRead =
  | { ok: true; document: Record<string, unknown> }
  | { ok: false; error: string }

/**
 * Reads and parses models.json. A missing file is an empty document. A file
 * that is not valid JSON, or whose top level / `providers` is not an object, is
 * reported as a refusal (the caller must not overwrite it). Comments and
 * trailing commas are tolerated exactly as pi's own reader tolerates them
 * (model-registry.ts `stripJsonComments`).
 */
function readModelsJsonDocument(modelsPath: string): ModelsJsonRead {
  if (!existsSync(modelsPath)) {
    return { ok: true, document: {} }
  }
  let content: string
  try {
    content = readFileSync(modelsPath, 'utf8')
  } catch (error) {
    return {
      ok: false,
      error: `Failed to read models.json (${modelsPath}): ${error instanceof Error ? error.message : String(error)}`
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsonComments(content))
  } catch (error) {
    return {
      ok: false,
      error: `models.json is not valid JSON (${modelsPath}): ${error instanceof Error ? error.message : String(error)}`
    }
  }
  if (!isRecord(parsed)) {
    return {
      ok: false,
      error: `models.json must be a JSON object with a "providers" map (${modelsPath})`
    }
  }
  if (parsed.providers !== undefined && !isRecord(parsed.providers)) {
    return {
      ok: false,
      error: `models.json "providers" must be an object (${modelsPath})`
    }
  }
  return { ok: true, document: parsed }
}

/**
 * Writes the provider entry into models.json after revalidating, merging into
 * the existing `providers` map. The write is atomic: it goes to a temporary file
 * in the same directory and is renamed over the target, so a failure mid-write
 * leaves the original untouched. A malformed or non-JSON models.json is never
 * overwritten. Never throws: returns a PiExtensionWriteResult.
 */
export function writeProviderToModelsJson(
  spec: PiProviderExtensionSpec,
  modelsPath: string
): PiExtensionWriteResult {
  const validationError = validateProviderExtensionSpec(spec)
  if (validationError) {
    return { ok: false, error: validationError }
  }
  const read = readModelsJsonDocument(modelsPath)
  if (!read.ok) {
    return { ok: false, error: read.error }
  }
  const existingProviders = isRecord(read.document.providers)
    ? read.document.providers
    : {}
  const nextDocument: Record<string, unknown> = {
    ...read.document,
    providers: { ...existingProviders, [spec.providerId]: buildProviderEntry(spec) }
  }
  try {
    writeFileAtomically(modelsPath, `${JSON.stringify(nextDocument, null, 2)}\n`)
    return { ok: true, path: modelsPath }
  } catch (error) {
    return {
      ok: false,
      error: `Failed to write models.json: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

/**
 * Lists the providers currently registered in models.json — id, display name and
 * model count. A missing file lists nothing; a malformed file lists nothing and
 * reports the reason so the form can surface it.
 */
export function listProvidersFromModelsJson(modelsPath: string): PiProvidersListResult {
  const read = readModelsJsonDocument(modelsPath)
  if (!read.ok) {
    return { providers: [], error: read.error }
  }
  if (!isRecord(read.document.providers)) {
    return { providers: [] }
  }
  const providers: PiProviderSummary[] = Object.entries(read.document.providers)
    .map(([id, value]) => {
      const name =
        isRecord(value) && typeof value.name === 'string' && value.name.length > 0
          ? value.name
          : id
      const models = isRecord(value) && Array.isArray(value.models) ? value.models : []
      return { id, name, modelCount: models.length }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
  return { providers }
}

/** Strip `//` line comments and trailing commas from JSON, leaving strings untouched. */
function stripJsonComments(input: string): string {
  return input
    .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/g, (m) => (m[0] === '"' ? m : ''))
    .replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (m, tail) => tail ?? (m[0] === '"' ? m : ''))
}

/** Writes `content` to a temp file in the target's directory, then renames it over the target. */
function writeFileAtomically(targetPath: string, content: string): void {
  const tmpPath = `${targetPath}.tmp`
  mkdirSync(dirname(targetPath), { recursive: true })
  try {
    writeFileSync(tmpPath, content, 'utf8')
    renameSync(tmpPath, targetPath)
  } catch (error) {
    try {
      rmSync(tmpPath, { force: true })
    } catch {
      // Keep the original error; a stale temp file is harmless.
    }
    throw error
  }
}
