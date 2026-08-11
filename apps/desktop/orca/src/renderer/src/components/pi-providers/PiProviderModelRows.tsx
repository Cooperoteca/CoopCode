// Why: the per-model row grid, split out of PiProviderForm so that file stays
// under the max-lines rule. It owns no state — the form passes the draft rows,
// their per-row errors, and the two mutators.

import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import { ERROR_MESSAGE, K } from './provider-form-copy'
import type { ProviderModelDraft, ProviderModelErrors } from './provider-form-model'

export function PiProviderModelRows(props: {
  models: ProviderModelDraft[]
  byModel: Record<number, ProviderModelErrors> | undefined
  updateModel: (index: number, patch: Partial<ProviderModelDraft>) => void
  removeModel: (index: number) => void
}): React.JSX.Element {
  const { models, byModel, updateModel, removeModel } = props
  const draft = { models }
  const errors = { byModel }
  return (
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
  )
}
