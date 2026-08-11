// Why: spike - hosts the pi conversation inside the FlexLayout shell docked at the
// bottom of the central column. The old PiChatColumnHost rendered the column as a
// full-window overlay; here the same PiChatColumn content lives as the first tab of
// a flexlayout-react shell, so closing the last tab unmounts the region and the
// terminals reclaim 100% of the height. The web build has no piRpc surface, so the
// region stays unmounted there too (same guard as the old host).
import { useEffect, useState } from 'react'
import { Actions, DockLocation, Model } from 'flexlayout-react'
import { History, Plug } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { PiChatColumn, PI_CHAT_OPEN_EVENT } from '../pi-chat/PiChatColumn'
import { PiHistoryPanel } from '../pi-history/PiHistoryPanel'
import { PiProviderForm } from '../pi-providers/PiProviderForm'
import { FlexShell } from './FlexShell'
import { useAppStore } from '@/store'
import {
  buildDefaultShellModelJson,
  buildShellTabJson,
  DEFAULT_SHELL_TAB_ID,
  normalizeShellModelJson,
  SHELL_TAB_COMPONENT,
  SHELL_TAB_ID
} from './flex-shell-model'

const TAB_TITLE_KEY = 'auto.components.flexshell.FlexShellRegion.conversa'
const OPEN_HISTORY_KEY = 'auto.components.flexshell.FlexShellRegion.openHistory'
const OPEN_PROVIDERS_KEY = 'auto.components.flexshell.FlexShellRegion.openProviders'
const HISTORY_TAB_TITLE_KEY = 'auto.components.flexshell.FlexShellRegion.historyTabTitle'
const PROVIDERS_TAB_TITLE_KEY = 'auto.components.flexshell.FlexShellRegion.providersTabTitle'

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
    [SHELL_TAB_COMPONENT.piChat]: () => <PiChatColumn onClose={() => setOpen(false)} />,
    // Why: providers has no renderer yet (a later phase); its tab falls
    // through to FlexShell's unknown-tab placeholder until one is registered.
    [SHELL_TAB_COMPONENT.historico]: () => <PiHistoryPanel />,
    [SHELL_TAB_COMPONENT.providers]: () => <PiProviderForm />
  }

  // Why: open (or select, if already present) an extension tab in the active tabset.
  // A fixed SHELL_TAB_ID prevents the same tab being added twice when the user
  // presses the bar button repeatedly. 'providers' will render as the unknown-tab
  // placeholder until its component is registered.
  const openTab = (componentId: string, tabId: string, name: string): void => {
    if (model === null) {
      return
    }
    const existing = model.getNodeById(tabId)
    if (existing !== undefined) {
      model.doAction(Actions.selectTab(tabId))
      return
    }
    const tabset = model.getActiveTabset() ?? model.getFirstTabSet()
    if (tabset === undefined) {
      return
    }
    model.doAction(
      Actions.addTab(
        buildShellTabJson(componentId, tabId, name),
        tabset.getId(),
        DockLocation.CENTER,
        -1,
        true
      )
    )
  }

  return (
    <div
      className="flex min-h-0 shrink-0 flex-col border-t border-border"
      style={{ height: '40%' }}
      data-testid="flex-shell-region"
    >
      <div
        className="flex shrink-0 items-center gap-1 border-b border-border/60 bg-muted/30 px-2 py-1"
        data-testid="flex-shell-tab-bar"
      >
        <button
          type="button"
          data-testid="flex-shell-open-history"
          aria-pressed={
            model?.getNodeById(SHELL_TAB_ID.historico) !== undefined ? 'true' : undefined
          }
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          onClick={() =>
            openTab(
              SHELL_TAB_COMPONENT.historico,
              SHELL_TAB_ID.historico,
              translate(HISTORY_TAB_TITLE_KEY, 'History')
            )
          }
        >
          <History className="size-3.5" />
          {translate(OPEN_HISTORY_KEY, 'History')}
        </button>
        <button
          type="button"
          data-testid="flex-shell-open-providers"
          aria-pressed={
            model?.getNodeById(SHELL_TAB_ID.providers) !== undefined ? 'true' : undefined
          }
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          onClick={() =>
            openTab(
              SHELL_TAB_COMPONENT.providers,
              SHELL_TAB_ID.providers,
              translate(PROVIDERS_TAB_TITLE_KEY, 'Providers')
            )
          }
        >
          <Plug className="size-3.5" />
          {translate(OPEN_PROVIDERS_KEY, 'Providers')}
        </button>
      </div>
      {model !== null ? (
        <FlexShell model={model} renderers={renderers} onModelChange={handleModelChange} />
      ) : null}
    </div>
  )
}
