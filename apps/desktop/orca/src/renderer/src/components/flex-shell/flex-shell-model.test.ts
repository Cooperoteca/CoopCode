// Why: guards the pure flexlayout shell model helpers. The default model must
// produce a renderable single-tab layout, and normalization must be defensive:
// anything that is not a well-structured layout with at least one tab is
// rejected with null instead of throwing.

import { describe, expect, it } from 'vitest'
import { Model, type IJsonTabNode } from 'flexlayout-react'
import {
  buildDefaultShellModelJson,
  normalizeShellModelJson,
  SHELL_TAB_COMPONENT
} from './flex-shell-model'

describe('buildDefaultShellModelJson', () => {
  it('builds a single tabset with a single pi-chat tab', () => {
    const model = buildDefaultShellModelJson('Conversa')
    const row = model.layout
    expect(row.type).toBe('row')
    expect(Array.isArray(row.children)).toBe(true)
    expect(row.children).toHaveLength(1)
    const tabset = row.children![0]
    expect(tabset.type).toBe('tabset')
    expect(tabset.children).toHaveLength(1)
    const tab = tabset.children![0] as IJsonTabNode
    expect(tab.component).toBe(SHELL_TAB_COMPONENT.piChat)
    expect(tab.id).toBe('tab-pi-chat')
    expect(tab.name).toBe('Conversa')
    expect(tab.enableClose).toBe(true)
  })

  it('loads into a real flexlayout-react Model without throwing', () => {
    expect(() => Model.fromJson(buildDefaultShellModelJson('Conversa'))).not.toThrow()
  })
})

describe('normalizeShellModelJson', () => {
  it('accepts the default model', () => {
    const normalized = normalizeShellModelJson(buildDefaultShellModelJson('Conversa'))
    expect(normalized).not.toBeNull()
  })

  it('rejects null, strings, and empty objects', () => {
    expect(normalizeShellModelJson(null)).toBeNull()
    expect(normalizeShellModelJson('nope')).toBeNull()
    expect(normalizeShellModelJson({})).toBeNull()
  })

  it('returns null for a model with no tabs', () => {
    const noTabs = {
      layout: {
        type: 'row',
        children: [{ type: 'tabset', children: [] }]
      }
    }
    expect(normalizeShellModelJson(noTabs)).toBeNull()
  })

  it('returns null for malformed structures without throwing', () => {
    expect(normalizeShellModelJson({ layout: 'x' })).toBeNull()
    expect(normalizeShellModelJson({ layout: { type: 'row', children: 'x' } })).toBeNull()
    expect(normalizeShellModelJson({ layout: { type: 'row', children: [{ type: 'nope' }] } })).toBeNull()
    expect(normalizeShellModelJson([])).toBeNull()
  })
})
