// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CoopBoardResult, CoopBoardTask } from '../../../../shared/coop-board-types'
import CoopBoardScreen, { COOP_BOARD_OPEN_EVENT } from './CoopBoardScreen'

const storeMock = vi.hoisted(() => ({
  state: {
    activeRepoId: 'repo1',
    repos: [{ id: 'repo1', path: 'C:/repo', kind: 'git' }]
  } as Record<string, unknown>
}))

const listTasksMock = vi.hoisted(() => vi.fn())

function installApiMock(overrides: Partial<Record<'listTasks', unknown>> = {}): void {
  window.api = {
    coopBoard: {
      listTasks: overrides.listTasks ?? listTasksMock
    }
  } as never
}

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector(storeMock.state)
}))

const roots: Root[] = []

async function renderScreen(): Promise<void> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(createElement(CoopBoardScreen))
  })
}

async function openScreen(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new Event(COOP_BOARD_OPEN_EVENT))
  })
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const DONE_TASK: CoopBoardTask = {
  id: 'DEVX-001',
  title: 'First task',
  state: 'done',
  frontmatterState: 'done',
  priority: 'P0',
  risk: 'routine',
  dependsOn: [],
  blockedOn: [],
  blocked: false,
  blockingReasons: [],
  integration: { reviewDecision: 'accept', mergeCommit: 'abc123' },
  evidenceFiles: [],
  evidenceClaimed: false,
  evidenceMissing: false
}

const BLOCKED_TASK: CoopBoardTask = {
  id: 'DEVX-002',
  title: 'Blocked task',
  state: 'draft',
  frontmatterState: 'draft',
  priority: 'P1',
  risk: 'routine',
  dependsOn: ['PLAT-013'],
  blockedOn: ['PLAT-013'],
  blocked: true,
  blockingReasons: ['Missing dependency PLAT-013'],
  evidenceFiles: [],
  evidenceClaimed: false,
  evidenceMissing: false
}

const BOARD_RESULT: CoopBoardResult = {
  repoRoot: 'C:/repo',
  tasks: [DONE_TASK, BLOCKED_TASK]
}

beforeEach(() => {
  vi.clearAllMocks()
  installApiMock()
  listTasksMock.mockResolvedValue(BOARD_RESULT)
})

afterEach(() => {
  for (const root of roots) {
    root.unmount()
  }
  roots.length = 0
  document.body.innerHTML = ''
})

describe('CoopBoardScreen', () => {
  it('renders nothing until the open event fires', async () => {
    await renderScreen()
    expect(document.body.textContent ?? '').not.toContain('Coop Task Board')
    await openScreen()
    expect(document.body.textContent).toContain('Coop Task Board')
  })

  it('fetches the board when opened and lists tasks with state and blocking reasons', async () => {
    await renderScreen()
    await openScreen()
    await flushEffects()
    expect(listTasksMock).toHaveBeenCalledWith({ repoRoot: 'C:/repo' })
    expect(document.body.textContent).toContain('DEVX-001')
    expect(document.body.textContent).toContain('First task')
    expect(document.body.textContent).toContain('Done')
    expect(document.body.textContent).toContain('Blocked')
    expect(document.body.textContent).toContain('Missing dependency PLAT-013')
  })

  it('closes on the close button and removes the DOM node', async () => {
    await renderScreen()
    await openScreen()
    await flushEffects()
    expect(document.body.textContent).toContain('Coop Task Board')
    const closeButton = [...document.querySelectorAll('button')].find((button) =>
      button.getAttribute('aria-label')?.includes('Close Coop Task Board')
    )
    expect(closeButton).toBeTruthy()
    await act(async () => {
      closeButton!.click()
    })
    expect(document.body.textContent ?? '').not.toContain('Coop Task Board')
  })

  it('closes on Escape while open', async () => {
    await renderScreen()
    await openScreen()
    await flushEffects()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(document.body.textContent ?? '').not.toContain('Coop Task Board')
  })

  it('shows the load error state from the IPC result', async () => {
    listTasksMock.mockResolvedValue({
      repoRoot: 'C:/repo',
      tasks: [],
      error: 'no docs/coop/tasks found'
    })
    await renderScreen()
    await openScreen()
    await flushEffects()
    expect(document.body.textContent).toContain('no docs/coop/tasks found')
  })
})
