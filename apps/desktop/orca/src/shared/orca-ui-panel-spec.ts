// Why: the Orca UI panel channel lets a terminal agent (the Prime Agent `pi`)
// draw declarative UI panels inside the Orca window over a local loopback HTTP
// server (see src/main/orca-ui/server.ts). This module is the single source of
// truth for the wire schema shared by the main-process HTTP server, the
// renderer panel host, and the agent-facing Python skill. Keeping the schema in
// the shared tree lets both the main and renderer processes validate the same
// payload without importing each other.
//
// The panel payload is intentionally small and declarative: only three panel
// types (kanban, table, markdown) are supported, and there is no JSX transpile
// or eval path. The agent describes UI with data; Orca owns rendering.

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Shared primitive limits
// ---------------------------------------------------------------------------

// Why: bound every agent-supplied string so a runaway panel cannot pin the
// renderer or inflate the HTTP response. These are generous enough for real
// panel content while keeping memory and layout cost bounded.
const MAX_TITLE_LENGTH = 200
const MAX_MARKDOWN_LENGTH = 64 * 1024
const MAX_COLUMNS = 24
const MAX_CARDS_PER_COLUMN = 500
const MAX_TABLE_COLUMNS = 24
const MAX_TABLE_ROWS = 1000
const MAX_CELL_LENGTH = 512

const TitleSchema = z.string().trim().min(1).max(MAX_TITLE_LENGTH)

// ---------------------------------------------------------------------------
// Kanban
// ---------------------------------------------------------------------------

const KanbanCardSchema = z
  .object({
    id: z.string().min(1).max(200),
    title: z.string().min(1).max(500),
    body: z.string().max(2000).optional()
  })
  .strict()

const KanbanColumnSchema = z
  .object({
    id: z.string().min(1).max(200),
    title: z.string().min(1).max(MAX_TITLE_LENGTH),
    cards: z.array(KanbanCardSchema).max(MAX_CARDS_PER_COLUMN).default([])
  })
  .strict()

const KanbanPanelSchema = z
  .object({
    type: z.literal('kanban'),
    title: TitleSchema,
    columns: z.array(KanbanColumnSchema).max(MAX_COLUMNS).default([])
  })
  .strict()

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

const TableCellSchema = z.union([z.string().max(MAX_CELL_LENGTH), z.number(), z.boolean(), z.null()])

const TablePanelSchema = z
  .object({
    type: z.literal('table'),
    title: TitleSchema,
    columns: z.array(z.string().min(1).max(MAX_TITLE_LENGTH)).max(MAX_TABLE_COLUMNS),
    rows: z.array(z.array(TableCellSchema).max(MAX_TABLE_COLUMNS)).max(MAX_TABLE_ROWS).default([])
  })
  .strict()

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

const MarkdownPanelSchema = z
  .object({
    type: z.literal('markdown'),
    title: TitleSchema,
    markdown: z.string().max(MAX_MARKDOWN_LENGTH)
  })
  .strict()

// ---------------------------------------------------------------------------
// Panel spec + request envelope
// ---------------------------------------------------------------------------

export const OrcaUiPanelSpecSchema = z.discriminatedUnion('type', [
  KanbanPanelSchema,
  TablePanelSchema,
  MarkdownPanelSchema
])

export type OrcaUiPanelSpec = z.infer<typeof OrcaUiPanelSpecSchema>
export type OrcaUiKanbanPanel = z.infer<typeof KanbanPanelSchema>
export type OrcaUiTablePanel = z.infer<typeof TablePanelSchema>
export type OrcaUiMarkdownPanel = z.infer<typeof MarkdownPanelSchema>
export type OrcaUiPanelType = OrcaUiPanelSpec['type']

// Why: the HTTP render endpoint envelope. The panelId is the agent-chosen key
// used to address a panel (create/update/reopen); the server stores the latest
// spec under it and the renderer surfaces it in the overlay.
export const OrcaUiRenderRequestSchema = z
  .object({
    panelId: z.string().min(1).max(200),
    spec: OrcaUiPanelSpecSchema
  })
  .strict()

export type OrcaUiRenderRequest = z.infer<typeof OrcaUiRenderRequestSchema>

// Why: a consistent envelope for the /ui/state store so the agent can read back
// exactly what it wrote. Kept as { key, value } to mirror the route shape.
export const OrcaUiStateValueSchema = z.unknown()

export function formatOrcaUiValidationError(error: z.ZodError): string {
  // Why: turn zod issues into a readable, path-prefixed message the agent can
  // act on in the next iteration (e.g. "spec.table.rows[3][1]: Expected
  // string, received number"). The raw error object is not serializable in a
  // useful way for an HTTP text response, so we flatten it here.
  const lines = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
    return `${path}: ${issue.message}`
  })
  return lines.join('\n')
}
