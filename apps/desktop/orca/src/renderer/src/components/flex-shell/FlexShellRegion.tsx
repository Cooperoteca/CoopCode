// Why: spike - hosts the pi conversation inside the FlexLayout shell docked at the
// bottom of the central column. The old PiChatColumnHost rendered the column as a
// full-window overlay; here the same PiChatColumn content lives as the first tab of
// a flexlayout-react shell, so closing the last tab unmounts the region and the
// terminals reclaim 100% of the height. The web build has no piRpc surface, so the
// region stays unmounted there too (same guard as the old host).
import { useEffect, useState } from 'react'
import { Model } from 'flexlayout-react'
import { translate } from '@/i18n/i18n'
import { PiChatColumn, PI_CHAT_OPEN_EVENT } from '../pi-chat/PiChatColumn'
import { FlexShell } from './FlexShell'
import { useAppStore } from '@/store'
import {
  buildDefaultShellModelJson,
  DEFAULT_SHELL_TAB_ID,
  normalizeShellModelJson,
  SHELL_TAB_COMPONENT
} from './flex-shell-model'

const TAB_TITLE_KEY = 'auto.components.flexshell.FlexShellRegion.conversa'

// Why: persistence phase will hydrate the layout from disk here. For now we always
// build the default single-tab shell; the switch to a persisted model is isolated to
// this one function so the later phase only touches this seam.
function createDefaultModel(): Model {
  const persisted = useAppStore.getState().flexShellLayout
  if (persisted !== undefined) {
    const normalized = normalizeShellModelJson(persisted)
    if (normalized !== null) {
      return Model.fromJson(normalized)
    }
  }
  return Model.fromJson(buildDefaultShellModelJson(translate(TAB_TITLE_KEY, 'Conversa')))
}

export function FlexShellRegion(): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [model, setModel] = useState<Model | null>(null)

  useEffect(() => {
    const onOpen = (): void => setOpen(true)
    window.addEventListener(PI_CHAT_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(PI_CHAT_OPEN_EVENT, onOpen)
  }, [])

  // Why: build the model once per opening, when `open` flips to true. `model` is reset
  // back to null when the region closes so the next open starts from a fresh default.
  useEffect(() => {
    if (open && model === null) {
      setModel(createDefaultModel())
    }
  }, [open, model])

  if (!open || !window.api?.piRpc) {
    return null
  }

  // Why: persist every layout change through the store's existing ui persistence
  // pipeline (App.tsx's debounced writer calls window.api.ui.set). Closing the last
  // tab removes the DEFAULT_SHELL_TAB_ID node, which unmounts the region and returns
  // the height to the terminals.
  const handleModelChange = (nextModel: Model): void => {
    if (nextModel.getNodeById(DEFAULT_SHELL_TAB_ID) === undefined) {
      setOpen(false)
      setModel(null)
    }
    useAppStore.getState().setFlexShellLayout(nextModel.toJson() as unknown as Record<string, unknown>)
  }

  const renderers: Record<string, () => React.ReactNode> = {
    [SHELL_TAB_COMPONENT.piChat]: () => <PiChatColumn onClose={() => setOpen(false)} />
  }

  return (
    <div
      className="flex min-h-0 shrink-0 flex-col border-t border-border"
      style={{ height: '40%' }}
      data-testid="flex-shell-region"
    >
      {model !== null ? (
        <FlexShell model={model} renderers={renderers} onModelChange={handleModelChange} />
      ) : null}
    </div>
  )
}
