// Why: pure flexlayout-react shell for the pi terminal spike. Houses the
// persisted layout json helpers (default model + defensive normalization of
// anything found on disk) so the FlexShell component stays a thin renderer.
// Only the pi-chat tab is wired in this phase; 'historico' and 'providers' are
// reserved component names for future phases and intentionally have no
// placeholder in the UI yet.

import type { IJsonModel, IJsonRowNode, IJsonTabSetNode, IJsonTabNode } from 'flexlayout-react'

// Component identifiers used by the FlexShell factory. historico/providers are
// only extension points for later phases - no visible placeholder exists yet.
export const SHELL_TAB_COMPONENT = {
  piChat: 'pi-chat',
  historico: 'historico',
  providers: 'providers'
} as const

export const DEFAULT_SHELL_TAB_ID = 'tab-pi-chat'

// Stable tab ids for the reservable phase-2 extension tabs. Using a fixed id lets
// the FlexShellRegion open-tab bar select an already-open tab instead of duplicating it.
export const SHELL_TAB_ID = {
  piChat: DEFAULT_SHELL_TAB_ID,
  historico: 'tab-pi-historico',
  providers: 'tab-pi-providers'
} as const

// Builds the JSON for one shell tab node. enableClose is on so users can tidy tabs
// away; the region's open bar can always re-open them.
export function buildShellTabJson(
  component: string,
  tabId: string,
  name: string
): IJsonTabNode {
  return { type: 'tab', id: tabId, component, name, enableClose: true }
}

// Builds the default single-tab single-tabset shell model.
export function buildDefaultShellModelJson(tabName: string): IJsonModel {
  const row: IJsonRowNode = {
    type: 'row',
    children: [
      {
        type: 'tabset',
        children: [
          {
            type: 'tab',
            id: DEFAULT_SHELL_TAB_ID,
            component: SHELL_TAB_COMPONENT.piChat,
            name: tabName,
            enableClose: true
          }
        ]
      } as IJsonTabSetNode
    ]
  }
  return { layout: row }
}

// Validates JSON persisted on disk into a usable IJsonModel. Returns null when
// the payload is not a structurally valid layout with at least one tab.
// Defensive: never throws, has at least one tab, otherwise returns null.
export function normalizeShellModelJson(json: unknown): IJsonModel | null {
  try {
    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
      return null
    }
    const candidate = json as Record<string, unknown>
    const layout = candidate.layout
    if (typeof layout !== 'object' || layout === null || Array.isArray(layout)) {
      return null
    }
    const row = layout as Record<string, unknown>
    if (row.type !== 'row') {
      return null
    }
    const children = row.children
    if (!Array.isArray(children) || children.length === 0) {
      return null
    }
    let hasTab = false
    for (const child of children) {
      if (!isTabSetNode(child)) {
        return null
      }
      if (hasAnyTab(child)) {
        hasTab = true
      }
    }
    if (!hasTab) {
      return null
    }
    return json as IJsonModel
  } catch {
    return null
  }
}

function isTabSetNode(value: unknown): value is IJsonTabSetNode {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const node = value as Record<string, unknown>
  if (node.type !== 'tabset') {
    return false
  }
  const nodeChildren = node.children
  return Array.isArray(nodeChildren) && nodeChildren.every(isTabNode)
}

function isTabNode(value: unknown): value is IJsonTabNode {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const node = value as Record<string, unknown>
  return node.type === 'tab'
}

function hasAnyTab(node: IJsonTabSetNode): boolean {
  return Array.isArray(node.children) && node.children.length > 0
}
