// Why: spike - model picker for the pi conversation header (Phase 3a UI layer).
// The wire protocol already exists (src/shared/pi-rpc.ts + the main-process
// client); this component only reads `window.api.piRpc` to (1) show the current
// provider/model on mount via get_state, (2) list available models on dropdown
// open via get_available_models, and (3) switch via set_model, updating the
// header from the response. Request/response correlation lives in the
// testable `pi-rpc-request.ts` helper; grouping/sorting are pure `pi-model-catalog.ts`.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import type { PiRpcApi } from '../../../../preload/api-types'
import { requestRpc } from './pi-rpc-request'
import {
  groupModelsByProvider,
  modelLabel,
  projectModel,
  type PiRpcModel
} from './pi-model-catalog'

const PREFIX = 'auto.components.pi.chat.PiChatModelPicker'
const TRIGGER_LABEL_KEY = `${PREFIX}.title`
const NO_MODEL_KEY = `${PREFIX}.noModel`
const LOADING_MODELS_KEY = `${PREFIX}.loadingModels`
const MODELS_ERROR_KEY = `${PREFIX}.modelsError`
const MENU_LABEL_KEY = `${PREFIX}.menuLabel`
const CURRENT_MODEL_KEY = `${PREFIX}.currentModel`

/** get_state response data we care about (RpcSessionState projection). */
type PiRpcStateView = { model?: PiRpcModel | null }

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function PiChatModelPicker({ api }: { api: PiRpcApi }): React.JSX.Element {
  const [currentModel, setCurrentModel] = useState<PiRpcModel | null>(null)
  const [models, setModels] = useState<PiRpcModel[] | null>(null)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [open, setOpen] = useState(false)
  const modelsRef = useRef<PiRpcModel[] | null>(null)

  // Why: on mount, surface the current provider/model. A failed get_state is
  // intentionally swallowed - the conversation column owns connect errors; the
  // picker just stays on its "No model" placeholder until a model is chosen.
  useEffect(() => {
    if (!api) {
      return
    }
    let cancelled = false
    void requestRpc<PiRpcStateView>(api, { type: 'get_state' }, { timeoutMs: 4000 })
      .then((state) => {
        if (!cancelled) {
          const projected = projectModel(state?.model)
          if (projected) {
            setCurrentModel(projected)
          }
        }
      })
      .catch(() => {
        // No-op: picker stays on its placeholder.
      })
    return () => {
      cancelled = true
    }
  }, [api])

  // Why: fetch available models lazily, once, when the dropdown first opens.
  // Caching on the ref keeps repeated opens cheap (no refetch while open) and
  // avoids a flood of get_available_models on every toggle.
  const ensureModels = useCallback((): void => {
    if (modelsRef.current) {
      setModels(modelsRef.current)
      return
    }
    if (modelsLoading || !api) {
      return
    }
    setModelsLoading(true)
    setModelsError(null)
    void requestRpc<{ models?: PiRpcModel[] }>(api, { type: 'get_available_models' })
      .then((result) => {
        const list = result?.models ?? []
        modelsRef.current = list
        setModels(list)
      })
      .catch((error: unknown) => {
        setModelsError(errorText(error))
      })
      .finally(() => setModelsLoading(false))
  }, [api, modelsLoading])

  const onOpenChange = useCallback(
    (nextOpen: boolean): void => {
      setOpen(nextOpen)
      if (nextOpen) {
        ensureModels()
      }
    },
    [ensureModels]
  )

  const handleSelect = useCallback(
    (model: PiRpcModel): void => {
      setApplying(true)
      setModelsError(null)
      void requestRpc<PiRpcModel>(api, { type: 'set_model', provider: model.provider, modelId: model.id })
        .then((updated) => {
          setCurrentModel(projectModel(updated) ?? model)
        })
        .catch((error: unknown) => {
          setModelsError(errorText(error))
        })
        .finally(() => setApplying(false))
    },
    [api]
  )

  const triggerLabel = currentModel
    ? `${currentModel.provider}/${currentModel.id}`
    : translate(NO_MODEL_KEY, 'No model')

  const groups = models ? groupModelsByProvider(models) : []
  const hasAnyModel = currentModel !== null

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className="h-6 max-w-[180px] gap-1 px-1.5 text-[11px] font-normal text-muted-foreground hover:text-foreground"
          aria-label={translate(TRIGGER_LABEL_KEY, 'Model')}
          data-testid="pi-model-picker-trigger"
          title={triggerLabel}
        >
          {applying ? (
            <Loader2 className="size-3 shrink-0 animate-spin" />
          ) : (
            <ChevronsUpDown className="size-3 shrink-0" />
          )}
          <span className="min-w-0 truncate">{triggerLabel}</span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="max-w-[260px]"
        data-testid="pi-model-picker-menu"
      >
        <DropdownMenuLabel>
          {translate(
            MENU_LABEL_KEY,
            hasAnyModel
              ? translate(CURRENT_MODEL_KEY, 'Current: {{model}}', { model: triggerLabel })
              : translate(NO_MODEL_KEY, 'No model')
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {modelsLoading && (
          <DropdownMenuItem disabled data-testid="pi-model-loading">
            <Loader2 className="size-3.5 animate-spin" />
            {translate(LOADING_MODELS_KEY, 'Loading models…')}
          </DropdownMenuItem>
        )}

        {!modelsLoading && modelsError !== null && (
          <DropdownMenuItem disabled data-testid="pi-model-error">
            {translate(MODELS_ERROR_KEY, 'Could not load models: {{error}}', {
              error: modelsError
            })}
          </DropdownMenuItem>
        )}

        {!modelsLoading && models !== null && modelsError === null && groups.length === 0 && (
          <DropdownMenuItem disabled>{translate(NO_MODEL_KEY, 'No model')}</DropdownMenuItem>
        )}

        {groups.map((group) => (
          <DropdownMenuGroup key={group.provider}>
            <DropdownMenuLabel>{group.provider}</DropdownMenuLabel>
            {group.models.map((model) => {
              const selected =
                currentModel !== null &&
                currentModel.provider === model.provider &&
                currentModel.id === model.id
              return (
                <DropdownMenuItem
                  key={`${model.provider}/${model.id}`}
                  disabled={applying}
                  onSelect={() => handleSelect(model)}
                  data-testid={`pi-model-option-${model.provider}-${model.id}`}
                >
                  <span className="min-w-0 flex-1 truncate">{modelLabel(model)}</span>
                  {selected ? (
                    <Check className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : null}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
