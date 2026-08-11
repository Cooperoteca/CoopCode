// @vitest-environment happy-dom
// Why: component test for PiHistoryPanel against a fake window.api. Verifies the
// fixture renders into the project->branch->session tree, the refresh button
// re-lists, and clicking a session row sends a switch_session command carrying the
// exact sessionPath. The response-frame correlation itself is covered by the pure
// parsePiSwitchResponse tests; here we only need the api to accept the send.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { PiSessionsListResult } from '../../../../shared/pi-rpc'
import { PiHistoryPanel } from './PiHistoryPanel'

// Why: fixture mirrors the main-process shape exactly (already grouped, newest
// first). Includes a null-branch bucket whose label must be translated.
const FIXTURE: PiSessionsListResult = {
  projects: [
    {
      project: 'acme/alpha',
      branches: [
        {
          branch: 'main',
          sessions: [
            {
              sessionPath: '/project/cache/sessions/000000000000000001.jsonl',
              sessionId: '000000000000000001',
              timestamp: '2024-01-01T10:00:00.000Z',
              cwd: '/repo'
            }
          ]
        },
        {
          branch: null,
          sessions: [
            {
              sessionPath: '/project/cache/sessions/000000000000000002.jsonl',
              sessionId: '000000000000000002',
              timestamp: '2024-01-01T11:00:00.000Z',
              cwd: ''
            }
          ]
        }
      ]
    }
  ]
}

const SEND_PATH = '/project/cache/sessions/000000000000000001.jsonl'

function installApi() {
  const send = vi.fn().mockResolvedValue(undefined)
  const list = vi.fn().mockResolvedValue(FIXTURE)
  const onFrame = vi.fn().mockReturnValue(() => {})
  const api = {
    piRpc: { start: vi.fn(), send, dispose: vi.fn(), onFrame },
    piSessions: { list }
  }
  Object.defineProperty(window, 'api', { configurable: true, value: api })
  return { api, send, list }
}

describe('PiHistoryPanel', () => {
  beforeEach(() => {
    installApi()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the project -> branch -> session tree from the fixture', async () => {
    render(<PiHistoryPanel />)
    expect(await screen.findByText('acme/alpha')).toBeTruthy()
    expect(await screen.findByText('main')).toBeTruthy()
    expect((await screen.findAllByTestId('pi-history-session-row')).length).toBe(2)
  })

  it('translates the null-branch label', async () => {
    render(<PiHistoryPanel />)
    // branchLabel comes from the view-model with the 'No branch' fallback.
    expect(await screen.findAllByText('No branch')).not.toHaveLength(0)
  })

  it('sends switch_session with the exact sessionPath on session click', async () => {
    render(<PiHistoryPanel />)
    const rows = await screen.findAllByTestId('pi-history-session-row')
    const target = rows.find((row) => row.getAttribute('data-session-path') === SEND_PATH)
    expect(target).toBeTruthy()
    fireEvent.click(target as HTMLElement)
    const apiHandle = (window.api as unknown as {
      piRpc: { send: ReturnType<typeof vi.fn> }
    }).piRpc.send
    expect(apiHandle).toHaveBeenCalledTimes(1)
    expect(apiHandle).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'switch_session', sessionPath: SEND_PATH })
    )
  })

  it('re-lists sessions when refresh is clicked', async () => {
    render(<PiHistoryPanel />)
    await screen.findAllByTestId('pi-history-session-row')
    const listHandle = (window.api as unknown as { piSessions: { list: ReturnType<typeof vi.fn> } })
      .piSessions.list
    expect(listHandle).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId('pi-history-refresh'))
    expect(listHandle).toHaveBeenCalledTimes(2)
  })
})
