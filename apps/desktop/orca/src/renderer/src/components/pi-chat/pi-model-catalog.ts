// Why: spike - folder a tiny, deliberately-narrow projection of the pi `Model`
// shape (fields confirmed against @earendil-works/pi-ai src/types.ts) plus pure
// grouping/sorting helpers so the picker stays free of protocol and ordering
// logic. The authoritative Model type lives in the external repo; here we only
// mirror the fields the UI renders.

export type PiRpcModel = {
  id: string
  name?: string
  api?: string
  provider: string
  reasoning?: boolean
  featured?: boolean
  contextWindow?: number
  maxTokens?: number
}

/** One model as surfaced by `get_available_models` -> `data.models`. */
export type PiRpcAvailableModelsPayload = { models?: PiRpcModel[] }

export type PiModelGroup = { provider: string; models: PiRpcModel[] }

/** Featured models float to the top of their provider, then alphabetical. */
export function compareModels(a: PiRpcModel, b: PiRpcModel): number {
  const fa = a.featured ? 1 : 0
  const fb = b.featured ? 1 : 0
  if (fa !== fb) {
    return fb - fa
  }
  const an = a.name || a.id
  const bn = b.name || b.id
  return an.localeCompare(bn)
}

/** Groups models by provider (stable), sorting groups and each provider's
 *  models. Provider fallback label is `unknown` for empty/missing provider. */
export function groupModelsByProvider(models: PiRpcModel[] | undefined | null): PiModelGroup[] {
  const byProvider = new Map<string, PiRpcModel[]>()
  for (const model of models ?? []) {
    const provider = model.provider || 'unknown'
    const bucket = byProvider.get(provider) ?? []
    bucket.push(model)
    byProvider.set(provider, bucket)
  }
  const groups: PiModelGroup[] = []
  for (const [provider, groupModels] of byProvider.entries()) {
    groups.push({ provider, models: [...groupModels].sort(compareModels) })
  }
  groups.sort((a, b) => a.provider.localeCompare(b.provider))
  return groups
}

/** Model label shown in the menu: display name when present, else the id. */
export function modelLabel(model: PiRpcModel): string {
  return model.name && model.name.trim().length > 0 ? model.name : model.id
}


/** Maps a loosely-typed wire Model / RpcSessionState.model onto our projection.
 *  Returns null when the input has no `id`+`provider` (missing or unexpected
 *  shape), so the picker can fall back to its placeholder. */
export function projectModel(value: unknown): PiRpcModel | null {
  if (value === null || value === undefined || typeof value !== 'object') {
    return null
  }
  const v = value as Partial<PiRpcModel>
  if (typeof v.id !== 'string' || typeof v.provider !== 'string') {
    return null
  }
  return {
    id: v.id,
    name: typeof v.name === 'string' ? v.name : undefined,
    api: typeof v.api === 'string' ? v.api : undefined,
    provider: v.provider,
    reasoning: typeof v.reasoning === 'boolean' ? v.reasoning : undefined,
    featured: typeof v.featured === 'boolean' ? v.featured : undefined,
    contextWindow: typeof v.contextWindow === 'number' ? v.contextWindow : undefined,
    maxTokens: typeof v.maxTokens === 'number' ? v.maxTokens : undefined
  }
}
