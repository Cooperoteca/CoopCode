// Why: render the three declarative panel types the agent can draw (kanban,
// table, markdown). The panel spec is plain data (see
// src/shared/orca-ui-panel-spec.ts); there is no JSX transpile or eval path.
// Each renderer is a pure function of its panel spec so the host can render
// any stored panel without re-fetching from main.

import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Badge } from '@/components/ui/badge'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type {
  OrcaUiKanbanPanel,
  OrcaUiMarkdownPanel,
  OrcaUiPanelSpec,
  OrcaUiTablePanel
} from '../../../../shared/orca-ui-panel-spec'

export function KanbanPanelRenderer({ panel }: { panel: OrcaUiKanbanPanel }): React.JSX.Element {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <span className="text-sm font-semibold text-foreground">{panel.title}</span>
        <span className="text-xs text-muted-foreground">
          {translate(
            'auto.components.orca.ui.panel.renderers.7216055f41',
            '{{value0}} cards',
            { value0: panel.columns.reduce((total, column) => total + column.cards.length, 0) }
          )}
        </span>
      </div>
      {panel.columns.length === 0 ? (
        <p className="text-sm text-muted-foreground">{translate('auto.components.orca.ui.panel.renderers.a7640d5b6a', 'No columns.')}</p>
      ) : (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-1">
          {panel.columns.map((column) => (
            <div
              key={column.id}
              className="flex w-64 shrink-0 flex-col gap-2 rounded-lg border border-border/60 bg-muted/40 p-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-semibold text-foreground">{column.title}</span>
                <Badge variant="secondary" className="shrink-0">
                  {column.cards.length}
                </Badge>
              </div>
              <div className="flex flex-col gap-2 overflow-y-auto scrollbar-sleek">
                {column.cards.length === 0 ? (
                  <p className="px-1 text-xs text-muted-foreground">{translate('auto.components.orca.ui.panel.renderers.e5968f09fe', 'No cards.')}</p>
                ) : (
                  column.cards.map((card) => (
                    <div
                      key={card.id}
                      className="rounded-md border border-border/60 bg-card p-2 shadow-xs"
                    >
                      <p className="text-xs font-medium text-card-foreground">{card.title}</p>
                      {card.body ? (
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {card.body}
                        </p>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TableCell({ value }: { value: string | number | boolean | null }): React.JSX.Element {
  if (value === null) {
    return <span className="text-muted-foreground/60">—</span>
  }
  if (typeof value === 'boolean') {
    return <span>{value ? '✓' : '✗'}</span>
  }
  return <span>{String(value)}</span>
}

export function TablePanelRenderer({ panel }: { panel: OrcaUiTablePanel }): React.JSX.Element {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <span className="text-sm font-semibold text-foreground">{panel.title}</span>
        <span className="text-xs text-muted-foreground">
          {translate('auto.components.orca.ui.panel.renderers.e73e91a9c8', '{{value0}} rows', { value0: panel.rows.length })}
        </span>
      </div>
      {panel.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{translate('auto.components.orca.ui.panel.renderers.e29cb3bb0e', 'No rows.')}</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto scrollbar-sleek rounded-lg border border-border/60">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-muted/60">
              <tr>
                {panel.columns.map((column, index) => (
                  <th
                    key={`${column}-${index}`}
                    className="border-b border-border/60 px-3 py-2 text-left font-semibold text-foreground"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {panel.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-border/40 last:border-b-0">
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className={cn('px-3 py-1.5 text-muted-foreground', cellIndex === 0 && 'font-medium text-foreground')}
                    >
                      <TableCell value={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function MarkdownPanelRenderer({ panel }: { panel: OrcaUiMarkdownPanel }): React.JSX.Element {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <span className="text-sm font-semibold text-foreground">{panel.title}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto scrollbar-sleek rounded-lg border border-border/60 bg-card p-3">
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ node: _node, ...props }) => (
              <a className="text-primary underline underline-offset-2" target="_blank" rel="noreferrer" {...props} />
            )
          }}
        >
          {panel.markdown}
        </Markdown>
      </div>
    </div>
  )
}

export function renderPanel(panel: OrcaUiPanelSpec): React.JSX.Element {
  switch (panel.type) {
    case 'kanban':
      return <KanbanPanelRenderer panel={panel} />
    case 'table':
      return <TablePanelRenderer panel={panel} />
    // Why default over `case 'markdown'`: the union has exactly three members, so
    // this both satisfies the return check and still fails typecheck if a fourth
    // panel type is added without a renderer.
    default:
      return <MarkdownPanelRenderer panel={panel} />
  }
}
