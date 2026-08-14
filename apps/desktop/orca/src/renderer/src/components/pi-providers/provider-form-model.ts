// Why: pure, i18n-free validation + spec-shaping for the pi provider/model form.
// The React component (PiProviderForm) handles rendering and translates error
// codes to localized messages; this module keeps the rules unit-testable without
// mounting the tree. Mirrors the main-process writer's validation (defense in
// depth) but contracts on error *codes* instead of raw English strings.

import type {
  PiProviderExtensionSpec,
  PiProviderModelSpec
} from '../../../../shared/pi-rpc'

/** One model row as the form edits it (numbers as strings so inputs stay controlled). */
export type ProviderModelDraft = {
  key: string
  id: string
  name: string
  contextWindow: string
  maxTokens: string
  reasoning: boolean
}

/** The whole provider form as the user edits it. */
export type ProviderFormDraft = {
  providerId: string
  providerName: string
  baseUrl: string
  api: string
  credential: string
  models: ProviderModelDraft[]
}

/** Stable error codes the component maps to i18n keys. */
export type ProviderFormErrorCode =
  | 'providerId.required'
  | 'providerId.slug'
  | 'providerName.required'
  | 'baseUrl.required'
  | 'baseUrl.invalid'
  | 'api.required'
  | 'credential.required'
  | 'credential.looksLikeKey'
  | 'credential.invalidRef'
  | 'model.id.required'
  | 'model.name.required'
  | 'model.contextWindow.positive'
  | 'model.maxTokens.positive'
  | 'models.required'

export type ProviderModelErrors = Partial<{
  id: ProviderFormErrorCode
  name: ProviderFormErrorCode
  contextWindow: ProviderFormErrorCode
  maxTokens: ProviderFormErrorCode
}>

export type ProviderFormErrors = Partial<{
  providerId: ProviderFormErrorCode
  providerName: ProviderFormErrorCode
  baseUrl: ProviderFormErrorCode
  api: ProviderFormErrorCode
  credential: ProviderFormErrorCode
  models: ProviderFormErrorCode
}> & {
  byModel?: Record<number, ProviderModelErrors>
}

/** A provider id usable as a models.json `providers` key. */
export function isValidProviderSlug(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value.trim())
}

/** Renderer copy of the main writer's raw-key heuristic ({ greeting } env/!cmd). */
export function looksLikeApiKey(credential: string): boolean {
  const trimmed = credential.trim()
  if (/^sk-/i.test(trimmed)) {
    return true
  }
  return trimmed.length >= 40 && !trimmed.includes(' ')
}

/** Validates the credential is a reference (env var name or !command), never a key. */
export function validateCredentialReference(credential: string): ProviderFormErrorCode | null {
  const trimmed = credential.trim()
  if (!trimmed) {
    return 'credential.required'
  }
  if (looksLikeApiKey(trimmed)) {
    return 'credential.looksLikeKey'
  }
  if (!trimmed.startsWith('!') && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    return 'credential.invalidRef'
  }
  return null
}

export function isValidHttpUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return false
  }
  return url.protocol === 'http:' || url.protocol === 'https:'
}

function isPositiveInt(value: string): boolean {
  if (!/^[0-9]+$/.test(value.trim())) {
    return false
  }
  const n = Number(value.trim())
  return Number.isInteger(n) && n > 0
}

/** Returns an error code for one model row, or null when the row is valid. */
export function validateProviderModelDraft(model: ProviderModelDraft): ProviderModelErrors | null {
  const errors: ProviderModelErrors = {}
  if (!model.id.trim()) {
    errors.id = 'model.id.required'
  }
  if (!model.name.trim()) {
    errors.name = 'model.name.required'
  }
  if (!isPositiveInt(model.contextWindow)) {
    errors.contextWindow = 'model.contextWindow.positive'
  }
  if (!isPositiveInt(model.maxTokens)) {
    errors.maxTokens = 'model.maxTokens.positive'
  }
  return Object.keys(errors).length > 0 ? errors : null
}

/** Validates a whole draft and collects every error code. */
export function validateProviderForm(draft: ProviderFormDraft): ProviderFormErrors {
  const errors: ProviderFormErrors = {}

  if (!draft.providerId.trim()) {
    errors.providerId = 'providerId.required'
  } else if (!isValidProviderSlug(draft.providerId)) {
    errors.providerId = 'providerId.slug'
  }

  if (!draft.providerName.trim()) {
    errors.providerName = 'providerName.required'
  }

  if (!draft.baseUrl.trim()) {
    errors.baseUrl = 'baseUrl.required'
  } else if (!isValidHttpUrl(draft.baseUrl)) {
    errors.baseUrl = 'baseUrl.invalid'
  }

  if (!draft.api.trim()) {
    errors.api = 'api.required'
  }

  const credentialError = validateCredentialReference(draft.credential)
  if (credentialError) {
    errors.credential = credentialError
  }

  if (draft.models.length === 0) {
    errors.models = 'models.required'
  } else {
    const byModel: Record<number, ProviderModelErrors> = {}
    draft.models.forEach((model, index) => {
      const modelError = validateProviderModelDraft(model)
      if (modelError) {
        byModel[index] = modelError
      }
    })
    if (Object.keys(byModel).length > 0) {
      errors.byModel = byModel
    }
  }

  return errors
}

/** True when a validated form has no field-, row- or model-level errors. */
export function isProviderFormValid(errors: ProviderFormErrors): boolean {
  if (
    errors.providerId ||
    errors.providerName ||
    errors.baseUrl ||
    errors.api ||
    errors.credential ||
    errors.models
  ) {
    return false
  }
  return errors.byModel === undefined || Object.keys(errors.byModel).length === 0
}

/** Shapes a valid draft into the IPC spec ({@link PiProviderExtensionSpec}). */
export function toProviderExtensionSpec(draft: ProviderFormDraft): PiProviderExtensionSpec {
  const models: PiProviderModelSpec[] = draft.models.map((model) => ({
    id: model.id.trim(),
    name: model.name.trim(),
    contextWindow: Number(model.contextWindow.trim()),
    maxTokens: Number(model.maxTokens.trim()),
    reasoning: model.reasoning
  }))
  return {
    providerId: draft.providerId.trim(),
    providerName: draft.providerName.trim(),
    baseUrl: draft.baseUrl.trim(),
    api: draft.api.trim(),
    credential: draft.credential.trim(),
    models
  }
}

export function emptyProviderModelDraft(key: string): ProviderModelDraft {
  return { key, id: '', name: '', contextWindow: '', maxTokens: '', reasoning: false }
}
