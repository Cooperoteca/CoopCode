// Why: i18n keys and error copy shared by PiProviderForm and PiProviderModelRows.
// Kept apart from both so neither file carries 90 lines of constants.

import type { ProviderFormErrorCode } from './provider-form-model'

export const K = {
  title: 'auto.components.pi.providers.PiProviderForm.title',
  description: 'auto.components.pi.providers.PiProviderForm.description',
  providerId: 'auto.components.pi.providers.PiProviderForm.providerId',
  providerIdPlaceholder: 'auto.components.pi.providers.PiProviderForm.providerIdPlaceholder',
  providerName: 'auto.components.pi.providers.PiProviderForm.providerName',
  providerNamePlaceholder: 'auto.components.pi.providers.PiProviderForm.providerNamePlaceholder',
  baseUrl: 'auto.components.pi.providers.PiProviderForm.baseUrl',
  baseUrlPlaceholder: 'auto.components.pi.providers.PiProviderForm.baseUrlPlaceholder',
  api: 'auto.components.pi.providers.PiProviderForm.api',
  apiPlaceholder: 'auto.components.pi.providers.PiProviderForm.apiPlaceholder',
  credential: 'auto.components.pi.providers.PiProviderForm.credential',
  credentialPlaceholder: 'auto.components.pi.providers.PiProviderForm.credentialPlaceholder',
  credentialHint: 'auto.components.pi.providers.PiProviderForm.credentialHint',
  credentialWarning: 'auto.components.pi.providers.PiProviderForm.credentialWarning',
  models: 'auto.components.pi.providers.PiProviderForm.models',
  modelsHint: 'auto.components.pi.providers.PiProviderForm.modelsHint',
  modelId: 'auto.components.pi.providers.PiProviderForm.modelId',
  modelIdPlaceholder: 'auto.components.pi.providers.PiProviderForm.modelIdPlaceholder',
  modelNamePlaceholder: 'auto.components.pi.providers.PiProviderForm.modelNamePlaceholder',
  modelName: 'auto.components.pi.providers.PiProviderForm.modelName',
  contextWindow: 'auto.components.pi.providers.PiProviderForm.contextWindow',
  maxTokens: 'auto.components.pi.providers.PiProviderForm.maxTokens',
  reasoning: 'auto.components.pi.providers.PiProviderForm.reasoning',
  addModel: 'auto.components.pi.providers.PiProviderForm.addModel',
  removeModel: 'auto.components.pi.providers.PiProviderForm.removeModel',
  save: 'auto.components.pi.providers.PiProviderForm.save',
  saving: 'auto.components.pi.providers.PiProviderForm.saving',
  savedTitle: 'auto.components.pi.providers.PiProviderForm.savedTitle',
  savedDescription: 'auto.components.pi.providers.PiProviderForm.savedDescription',
  newSessionRequested: 'auto.components.pi.providers.PiProviderForm.newSessionRequested',
  newSession: 'auto.components.pi.providers.PiProviderForm.newSession',
  saveFailed: 'auto.components.pi.providers.PiProviderForm.saveFailed',
  // field error codes
  'providerId.required': 'auto.components.pi.providers.PiProviderForm.errorProviderIdRequired',
  'providerId.slug': 'auto.components.pi.providers.PiProviderForm.errorProviderIdSlug',
  'providerName.required': 'auto.components.pi.providers.PiProviderForm.errorProviderNameRequired',
  'baseUrl.required': 'auto.components.pi.providers.PiProviderForm.errorBaseUrlRequired',
  'baseUrl.invalid': 'auto.components.pi.providers.PiProviderForm.errorBaseUrlInvalid',
  'api.required': 'auto.components.pi.providers.PiProviderForm.errorApiRequired',
  'credential.required': 'auto.components.pi.providers.PiProviderForm.errorCredentialRequired',
  'credential.looksLikeKey': 'auto.components.pi.providers.PiProviderForm.errorCredentialLooksLikeKey',
  'credential.invalidRef': 'auto.components.pi.providers.PiProviderForm.errorCredentialInvalidRef',
  'model.id.required': 'auto.components.pi.providers.PiProviderForm.errorModelIdRequired',
  'model.name.required': 'auto.components.pi.providers.PiProviderForm.errorModelNameRequired',
  'model.contextWindow.positive': 'auto.components.pi.providers.PiProviderForm.errorContextWindowPositive',
  'model.maxTokens.positive': 'auto.components.pi.providers.PiProviderForm.errorMaxTokensPositive',
  'models.required': 'auto.components.pi.providers.PiProviderForm.errorModelsRequired'
} as const

export const ERROR_MESSAGE: Record<ProviderFormErrorCode, { key: string; fallback: string }> = {
  'providerId.required': { key: K['providerId.required'], fallback: 'Provider id is required' },
  'providerId.slug': {
    key: K['providerId.slug'],
    fallback: 'Use only letters, digits, dashes and underscores — safe for a file name'
  },
  'providerName.required': { key: K['providerName.required'], fallback: 'Display name is required' },
  'baseUrl.required': { key: K['baseUrl.required'], fallback: 'Base URL is required' },
  'baseUrl.invalid': {
    key: K['baseUrl.invalid'],
    fallback: 'Enter a valid http(s) URL, e.g. https://api.example.com/v1'
  },
  'api.required': { key: K['api.required'], fallback: 'API type is required' },
  'credential.required': {
    key: K['credential.required'],
    fallback: 'Enter the environment variable name or !command that holds the key'
  },
  'credential.looksLikeKey': {
    key: K['credential.looksLikeKey'],
    fallback:
      'That looks like a raw API key — the key goes in an environment variable, a !command, or /login inside pi'
  },
  'credential.invalidRef': {
    key: K['credential.invalidRef'],
    fallback:
      'Use an environment variable name (like CLINEPASS_API_KEY) or a !command that prints the key'
  },
  'model.id.required': { key: K['model.id.required'], fallback: 'Model id is required' },
  'model.name.required': { key: K['model.name.required'], fallback: 'Model name is required' },
  'model.contextWindow.positive': {
    key: K['model.contextWindow.positive'],
    fallback: 'Context window must be a positive integer'
  },
  'model.maxTokens.positive': {
    key: K['model.maxTokens.positive'],
    fallback: 'Max tokens must be a positive integer'
  },
  'models.required': { key: K['models.required'], fallback: 'Add at least one model' }
}
