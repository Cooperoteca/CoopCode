// Why: the overlay host that surfaces agent-drawn UI panels in the Orca window.
// Inspired by the coop-board/dashboard overlay mounting conventions: a
// pointer-events-none full-screen layer that hosts pointer-events-auto panels
// on the right edge, rendered inside a RecoverableRenderErrorBoundary so a bad
// panel cannot take down the app. Panels arrive over IPC from the main-process
// loopback HTTP server (see src/main/orca-ui/server.ts); the host also replays
// any panels the server stored before the renderer mounted.

import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { OrcaUiPanelSpec } from '../../../../shared/orca-ui-panel-spec'
import { renderPanel } from './panel-renderers'

const PANEL_TYPE_LABEL: Record<string, string> = {
  kanban: 'Kanban',
  table: 'Table',
  markdown: 'Markdown'
}

export function OrcaUiHost(): React.JSX.Element | null {
  const [panels, setPanels] = useState<Record<string, OrcaUiPanelSpec>>({})
  const [openPanelIds, setOpenPanelIds] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let disposed = false
    // Why: replay panels the server stored before the renderer mounted (or after
    // a renderer reload) so an agent's earlier renders are not lost on reload.
    void window.api.orcaUi?.getPanels().then((stored) => {
      if (disposed || !stored) {
        return
      }
      setPanels((previous) => ({ ...previous, ...(stored as Record<string, OrcaUiPanelSpec>) }))
      setOpenPanelIds((previous) => {
        const next = { ...previous }
        for (const panelId of Object.keys(stored)) {
          if (!(panelId in next)) {
            next[panelId] = true
          }
        }
        return next
      })
    })

    const unsubscribe = window.api.orcaUi?.onRender(({ panelId, spec }) => {
      setPanels((previous) => ({ ...previous, [panelId]: spec as OrcaUiPanelSpec }))
      setOpenPanelIds((previous) => ({ ...previous, [panelId]: true }))
    })
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [])

  const openEntries = useMemo(
    () =>
      Object.entries(panels)
        .filter(([panelId]) => openPanelIds[panelId])
        .map(([panelId, spec]) => ({ panelId, spec })),
    [panels, openPanelIds]
  )

  if (openEntries.length === 0) {
    return null
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex justify-end">
      <div className="pointer-events-auto flex h-full w-full max-w-2xl flex-col gap-3 overflow-y-auto scrollbar-sleek border-l bg-background p-4">
        {openEntries.map(({ panelId, spec }) => (
          <div
            key={panelId}
            className="flex min-h-0 flex-col gap-3 rounded-xl border border-border/60 bg-background p-3 shadow-lg"
          >
            <div className="flex shrink-0 items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Badge variant="secondary">{PANEL_TYPE_LABEL[spec.type] ?? spec.type}</Badge>
                <span className="truncate font-mono text-xs text-muted-foreground">{panelId}</span>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={translate(
                  'auto.components.orca.ui.OrcaUiHost.294cb8c6cf',
                  'Close panel'
                )}
                onClick={() => setOpenPanelIds((previous) => ({ ...previous, [panelId]: false }))}
              >
                <X className="size-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">{renderPanel(spec)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
