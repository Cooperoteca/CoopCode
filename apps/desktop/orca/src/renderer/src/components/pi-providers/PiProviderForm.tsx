// Why: spike phase 3b - the pi provider/model registration tab of the pi shell.
// Lets the user register a custom OpenAI-compatible provider for the pi agent by
// writing a provider extension into ~/.prime/agent/extensions/. Security rule
// reflected in both this form and the main writer: the form NEVER asks for a raw
// API key. `credential` is the NAME of an environment variable or a `!command`;
// anything that looks like a key is refused up front, and the persistent hint
// documents that an unset env var makes the pi use the string verbatim (=> 401).
//
// Extensions are only read at the pi child's startup, so after a successful save
// we offer a button that sends { type:'new_session' } over the existing pi RPC
// surface to force a fresh session against the updated registry.

import { useState } from 'react'
import { Loader2, Plus, Save, Sparkles, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import type { PiExtensionWriteResult } from '../../../../shared/pi-rpc'
import {
  emptyProviderModelDraft,
  isProviderFormValid,
  toProviderExtensionSpec,
  validateProviderForm,
  type ProviderFormDraft,
  type ProviderFormErrorCode,
  type ProviderFormErrors,
  type ProviderModelDraft
} from './provider-form-model'

const K = {
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

const ERROR_MESSAGE: Record<ProviderFormErrorCode, { key: string; fallback: string }> = {
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

function errorText(errors: ProviderFormErrors, field: Exclude<keyof ProviderFormErrors, 'byModel'>): string | null {
  const code = errors[field]
  if (!code) {
    return null
  }
  const message = ERROR_MESSAGE[code]
  return translate(message.key, message.fallback)
}

let modelKeyCounter = 0
function nextModelKey(): string {
  modelKeyCounter += 1
  return `model-${modelKeyCounter}`
}

export function PiProviderForm(): React.JSX.Element {
  const [draft, setDraft] = useState<ProviderFormDraft>({
    providerId: '',
    providerName: '',
    baseUrl: '',
    api: 'openai-completions',
    credential: '',
    models: [emptyProviderModelDraft(nextModelKey())]
  })
  const [errors, setErrors] = useState<ProviderFormErrors>({})
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<PiExtensionWriteResult | null>(null)
  const [newSessionConfirm, setNewSessionConfirm] = useState(false)

  const writeProvider = window.api?.piExtensions?.writeProvider
  const rpcSend = window.api?.piRpc?.send

  function update<K extends keyof ProviderFormDraft>(
    field: K,
    value: ProviderFormDraft[K]
  ): void {
    setDraft((previous) => ({ ...previous, [field]: value }))
    // Clear the touched field error so corrections stop nagging immediately.
    setErrors((previous) => {
      if (!previous[field]) {
        return previous
      }
      const next = { ...previous }
      delete next[field]
      return next
    })
    setSaveResult(null)
  }

  function updateModel(index: number, patch: Partial<ProviderModelDraft>): void {
    setDraft((previous) => ({
      ...previous,
      models: previous.models.map((model, i) => (i === index ? { ...model, ...patch } : model))
    }))
    setErrors((previous) => {
      if (!previous.byModel || !previous.byModel[index]) {
        return previous
      }
      const byModel = { ...previous.byModel }
      delete byModel[index]
      return { ...previous, byModel }
    })
    setSaveResult(null)
  }

  function addModel(): void {
    setDraft((previous) => ({
      ...previous,
      models: [...previous.models, emptyProviderModelDraft(nextModelKey())]
    }))
    setSaveResult(null)
  }

  function removeModel(index: number): void {
    setDraft((previous) => ({
      ...previous,
      models: previous.models.filter((_, i) => i !== index)
    }))
    setSaveResult(null)
  }

  async function handleSave(): Promise<void> {
    if (!writeProvider) {
      setSaveResult({ ok: false, error: 'pi API unavailable' })
      return
    }
    const validationErrors = validateProviderForm(draft)
    setErrors(validationErrors)
    if (!isProviderFormValid(validationErrors)) {
      return
    }
    setSaving(true)
    try {
      const result = await writeProvider(toProviderExtensionSpec(draft))
      setSaveResult(result)
      setNewSessionConfirm(false)
    } catch (error) {
      setSaveResult({ ok: false, error: error instanceof Error ? error.message : String(error) })
    } finally {
      setSaving(false)
    }
  }

  async function handleNewSession(): Promise<void> {
    if (!rpcSend) {
      return
    }
    try {
      await rpcSend({ type: 'new_session' })
      setNewSessionConfirm(true)
    } catch {
      // The notice already tells the user to start a new session manually; a
      // failed RPC send is not fatal to the save flow.
      setNewSessionConfirm(false)
    }
  }

  return (
    <Card className="h-full overflow-y-auto scrollbar-sleek rounded-none border-none bg-background">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-muted-foreground" />
          {translate(K.title, 'Add a pi provider')}
        </CardTitle>
        <CardDescription>
          {translate(
            K.description,
            'Register an OpenAI-compatible provider. The API key is referenced by environment variable or !command — you never paste the key here.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6 pb-10">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="pi-provider-id">{translate(K.providerId, 'Provider id')}</Label>
            <Input
              id="pi-provider-id"
              value={draft.providerId}
              onChange={(event) => update('providerId', event.target.value)}
              placeholder={translate(K.providerIdPlaceholder, 'e.g. clinepass')}
              aria-invalid={Boolean(errors.providerId)}
            />
            {errorText(errors, 'providerId') ? (
              <p className="text-xs text-destructive">{errorText(errors, 'providerId')}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="pi-provider-name">{translate(K.providerName, 'Display name')}</Label>
            <Input
              id="pi-provider-name"
              value={draft.providerName}
              onChange={(event) => update('providerName', event.target.value)}
              placeholder={translate(K.providerNamePlaceholder, 'e.g. ClinePass')}
              aria-invalid={Boolean(errors.providerName)}
            />
            {errorText(errors, 'providerName') ? (
              <p className="text-xs text-destructive">{errorText(errors, 'providerName')}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="pi-provider-baseurl">{translate(K.baseUrl, 'Base URL')}</Label>
            <Input
              id="pi-provider-baseurl"
              value={draft.baseUrl}
              onChange={(event) => update('baseUrl', event.target.value)}
              placeholder={translate(K.baseUrlPlaceholder, 'https://api.example.com/v1')}
              aria-invalid={Boolean(errors.baseUrl)}
            />
            {errorText(errors, 'baseUrl') ? (
              <p className="text-xs text-destructive">{errorText(errors, 'baseUrl')}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="pi-provider-api">{translate(K.api, 'API type')}</Label>
            <Input
              id="pi-provider-api"
              value={draft.api}
              onChange={(event) => update('api', event.target.value)}
              placeholder={translate(K.apiPlaceholder, 'openai-completions')}
              aria-invalid={Boolean(errors.api)}
            />
            {errorText(errors, 'api') ? (
              <p className="text-xs text-destructive">{errorText(errors, 'api')}</p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="pi-provider-credential">{translate(K.credential, 'Credential')}</Label>
          <Input
            id="pi-provider-credential"
            value={draft.credential}
            onChange={(event) => update('credential', event.target.value)}
            placeholder={translate(K.credentialPlaceholder, 'ENV_VAR_NAME or !command-that-prints-the-key')}
            aria-invalid={Boolean(errors.credential)}
          />
          <p className="text-xs text-muted-foreground">
            {translate(
              K.credentialHint,
              'Enter the environment variable name (e.g. CLINEPASS_API_KEY) or a !command that prints the key on stdout.'
            )}
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {translate(
              K.credentialWarning,
              'Pitfall: if that environment variable does not exist, pi uses the string itself as the key and the provider answers 401 — that looks like an invalid key but is actually misconfiguration.'
            )}
          </p>
          {errorText(errors, 'credential') ? (
            <p className="text-xs text-destructive">{errorText(errors, 'credential')}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">{translate(K.models, 'Models')}</h3>
            <Badge variant="outline">{String(draft.models.length)}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {translate(K.modelsHint, 'At least one model is required.')}
          </p>
          {errors.models ? (
            <p className="text-xs text-destructive">{errorText(errors, 'models')}</p>
          ) : null}

          <div className="flex flex-col gap-4">
            {draft.models.map((model, index) => {
              const rowError = errors.byModel?.[index]
              return (
                <div
                  key={model.key}
                  className="flex flex-col gap-3 rounded-md border border-border bg-card p-3"
                >
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`pi-model-id-${index}`}>
                        {translate(K.modelId, 'Model id')}
                      </Label>
                      <Input
                        id={`pi-model-id-${index}`}
                        value={model.id}
                        onChange={(event) => updateModel(index, { id: event.target.value })}
                        placeholder={translate(K.modelIdPlaceholder, 'e.g. cline-pass/deepseek-v4-flash')}
                        aria-invalid={Boolean(rowError?.id)}
                      />
                      {rowError?.id ? (
                        <p className="text-xs text-destructive">{translate(ERROR_MESSAGE[rowError.id].key, ERROR_MESSAGE[rowError.id].fallback)}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`pi-model-name-${index}`}>
                        {translate(K.modelName, 'Model name')}
                      </Label>
                      <Input
                        id={`pi-model-name-${index}`}
                        value={model.name}
                        onChange={(event) => updateModel(index, { name: event.target.value })}
                        placeholder={translate(K.modelNamePlaceholder, 'e.g. DeepSeek V4 Flash')}
                        aria-invalid={Boolean(rowError?.name)}
                      />
                      {rowError?.name ? (
                        <p className="text-xs text-destructive">{translate(ERROR_MESSAGE[rowError.name].key, ERROR_MESSAGE[rowError.name].fallback)}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`pi-model-context-${index}`}>
                        {translate(K.contextWindow, 'Context window')}
                      </Label>
                      <Input
                        id={`pi-model-context-${index}`}
                        type="number"
                        min={1}
                        value={model.contextWindow}
                        onChange={(event) =>
                          updateModel(index, { contextWindow: event.target.value })
                        }
                        aria-invalid={Boolean(rowError?.contextWindow)}
                      />
                      {rowError?.contextWindow ? (
                        <p className="text-xs text-destructive">
                          {translate(ERROR_MESSAGE[rowError.contextWindow].key, ERROR_MESSAGE[rowError.contextWindow].fallback)}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`pi-model-maxtokens-${index}`}>
                        {translate(K.maxTokens, 'Max tokens')}
                      </Label>
                      <Input
                        id={`pi-model-maxtokens-${index}`}
                        type="number"
                        min={1}
                        value={model.maxTokens}
                        onChange={(event) => updateModel(index, { maxTokens: event.target.value })}
                        aria-invalid={Boolean(rowError?.maxTokens)}
                      />
                      {rowError?.maxTokens ? (
                        <p className="text-xs text-destructive">
                          {translate(ERROR_MESSAGE[rowError.maxTokens].key, ERROR_MESSAGE[rowError.maxTokens].fallback)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <label
                      className="flex cursor-pointer items-center gap-2 text-sm"
                      htmlFor={`pi-model-reasoning-${index}`}
                    >
                      <Checkbox
                        id={`pi-model-reasoning-${index}`}
                        checked={model.reasoning}
                        onCheckedChange={(checked) =>
                          updateModel(index, { reasoning: checked === true })
                        }
                      />
                      {translate(K.reasoning, 'Supports extended thinking (reasoning)')}
                    </label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeModel(index)}
                      aria-label={translate(K.removeModel, 'Remove model')}
                      disabled={draft.models.length <= 1}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>

          <div>
            <Button variant="outline" size="sm" onClick={addModel}>
              <Plus className="size-4" />
              {translate(K.addModel, 'Add model')}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <Button onClick={handleSave} disabled={saving} className="w-fit">
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {saving ? translate(K.saving, 'Saving…') : translate(K.save, 'Save provider')}
          </Button>

          {saveResult?.ok ? (
            <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-3">
              <p className="text-sm text-emerald-700 dark:text-emerald-400">
                {translate(K.savedTitle, 'Provider saved')}
              </p>
              <p className="text-xs text-muted-foreground">
                {translate(
                  K.savedDescription,
                  'Extensions are loaded when pi starts, so this only applies to new sessions. Start a new session now to pick up the provider.'
                )}
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={handleNewSession}>
                  {translate(K.newSession, 'Start new session')}
                </Button>
                {newSessionConfirm ? (
                  <span className="self-center text-xs text-muted-foreground">
                    {translate(K.newSessionRequested, 'New session requested')}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {saveResult && !saveResult.ok ? (
            <p className="text-xs text-destructive">
              {translate(K.saveFailed, 'Could not save provider')}: {saveResult.error}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
