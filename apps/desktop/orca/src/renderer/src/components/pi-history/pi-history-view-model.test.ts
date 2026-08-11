// Why: unit coverage for the pure pi-history-view-model. All shaping/formatting and
// frame classification logic lives here, so it is tested without any DOM or preload.

import { describe, expect, it } from 'vitest'
import type { PiSessionsListResult } from '../../../../shared/pi-rpc'
import {
  buildPiHistoryViewModel,
  defaultPiHistoryFormatters,
  parsePiSwitchResponse
} from './pi-history-view-model'

const FIXED_FORMATTERS = {
  formatTime: (iso: string) => `T:${iso}`,
  shortId: (id: string) => `#${id.slice(0, 6)}`
}

const FIXTURE: PiSessionsListResult = {
  projects: [
    {
      project: 'acme/alpha',
      branches: [
        {
          branch: 'main',
          sessions: [
            { sessionPath: '/a/1.jsonl', sessionId: '000000000000000aaa', timestamp: '2024-01-01T10:00:00.000Z', cwd: '/repo' }
          ]
        },
        {
          branch: null,
          sessions: [{ sessionPath: '/b/2.jsonl', sessionId: 'bbbbbbbbbbbbbbbbbb', timestamp: '', cwd: '' }]
        }
      ]
    }
  ]
}

describe('buildPiHistoryViewModel', () => {
  it('preserves the main-process grouping without regrouping', () => {
    const view = buildPiHistoryViewModel(FIXTURE, FIXED_FORMATTERS, 'No branch')
    expect(view.projects).toHaveLength(1)
    const project = view.projects[0]
    expect(project.project).toBe('acme/alpha')
    expect(project.branches).toHaveLength(2)
    expect(project.branches[0].sessions).toHaveLength(1)
    expect(project.branches[1].sessions).toHaveLength(1)
    expect(view.sessionCount).toBe(2)
    expect(view.hasSessions).toBe(true)
  })

  it('labels the null branch with the empty-branch label', () => {
    const view = buildPiHistoryViewModel(FIXTURE, FIXED_FORMATTERS, 'No branch')
    expect(view.projects[0].branches[1].branchLabel).toBe('No branch')
  })

  it('formats session time and short id through the formatters', () => {
    const view = buildPiHistoryViewModel(FIXTURE, FIXED_FORMATTERS, 'No branch')
    const session = view.projects[0].branches[0].sessions[0]
    expect(session.timeLabel).toBe('T:2024-01-01T10:00:00.000Z')
    expect(session.shortId).toBe('#000000')
    expect(session.sessionPath).toBe('/a/1.jsonl')
  })

  it('handles an empty result', () => {
    const view = buildPiHistoryViewModel({ projects: [] }, FIXED_FORMATTERS, 'No branch')
    expect(view.projects).toEqual([])
    expect(view.sessionCount).toBe(0)
    expect(view.hasSessions).toBe(false)
  })
})

describe('defaultPiHistoryFormatters', () => {
  it('formats a parseable date to a localized string', () => {
    const formatted = defaultPiHistoryFormatters.formatTime('2024-01-01T10:00:00.000Z')
    expect(typeof formatted).toBe('string')
    expect(formatted.length).toBeGreaterThan(0)
  })

  it('short-ids to an 8-char suffix of the id', () => {
    expect(defaultPiHistoryFormatters.shortId('000000000000000aaa')).toBe('00000000')
  })
})

describe('parsePiSwitchResponse', () => {
  it('returns null for non-object / non-response / non-switch frames', () => {
    expect(parsePiSwitchResponse(undefined)).toBeNull()
    expect(parsePiSwitchResponse(null)).toBeNull()
    expect(parsePiSwitchResponse('nope')).toBeNull()
    expect(parsePiSwitchResponse({ type: 'response', command: 'prompt', success: true, data: {} })).toBeNull()
    expect(parsePiSwitchResponse({ type: 'event', command: 'switch_session', success: true })).toBeNull()
  })

  it('parses a successful switch (not cancelled) as done', () => {
    const result = parsePiSwitchResponse({
      id: 'r1',
      type: 'response',
      command: 'switch_session',
      success: true,
      data: { cancelled: false }
    })
    expect(result).toEqual({ id: 'r1', kind: 'done' })
  })

  it('classifies a cancelled switch as neutral (not error)', () => {
    const result = parsePiSwitchResponse({
      id: 'r2',
      type: 'response',
      command: 'switch_session',
      success: true,
      data: { cancelled: true }
    })
    expect(result).toEqual({ id: 'r2', kind: 'cancelled' })
  })

  it('classifies a failed switch as error', () => {
    const result = parsePiSwitchResponse({
      id: 'r3',
      type: 'response',
      command: 'switch_session',
      success: false,
      error: 'boom'
    })
    expect(result).toEqual({ id: 'r3', kind: 'error' })
  })
})
