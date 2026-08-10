// Why: unit-tests the Orca UI loopback server (auth, validation, state store)
// in isolation. The server receives a plain HTTP request and returns a plain
// JSON response, so the tests exercise the real socket path (node:http) without
// an Electron renderer. IPC registration is covered separately with a mocked
// electron module.

import http from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startOrcaUiServer, type OrcaUiServer } from './server'
import type { OrcaUiPanelSpec } from '../../shared/orca-ui-panel-spec'

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeAllListeners: vi.fn()
  }
}))

vi.mock('../ipc/ui', () => ({
  isTrustedUIRenderer: () => true
}))

type JsonBody = Record<string, unknown>

function fetch(
  server: OrcaUiServer,
  path: string,
  init?: { method?: string; body?: unknown; token?: string }
): Promise<{ status: number; body: JsonBody }> {
  const { method = 'GET', body, token = server.token } = init ?? {}
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return new Promise((resolve, reject) => {
    const client = http.request(
      {
        host: '127.0.0.1',
        port: server.port,
        path,
        method,
        headers
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          let parsed: JsonBody = {}
          try {
            parsed = JSON.parse(raw) as JsonBody
          } catch {
            parsed = { raw }
          }
          resolve({ status: res.statusCode ?? 0, body: parsed })
        })
      }
    )
    if (body !== undefined) {
      client.write(JSON.stringify(body))
    }
    client.on('error', reject)
    client.end()
  })
}

const kanbanSpec: OrcaUiPanelSpec = {
  type: 'kanban',
  title: 'Backlog',
  columns: [
    { id: 'todo', title: 'To do', cards: [{ id: 'c1', title: 'Wire channel' }] }
  ]
}

describe('startOrcaUiServer', () => {
  let server: OrcaUiServer | null = null
  const deliver = vi.fn(() => true)

  afterEach(async () => {
    await server?.close()
    server = null
    deliver.mockClear()
  })

  async function start(): Promise<OrcaUiServer> {
    server = await startOrcaUiServer({ deliver })
    return server
  }

  it('binds on 127.0.0.1 with an ephemeral port and issues a token', async () => {
    const s = await start()
    expect(s.port).toBeGreaterThan(0)
    expect(s.token.length).toBeGreaterThanOrEqual(32)
  })

  it('rejects a request without a token with 401', async () => {
    const s = await start()
    const res = await fetch(s, '/ui/render', {
      method: 'POST',
      body: { panelId: 'p', spec: kanbanSpec },
      token: ''
    })
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('unauthorized')
    expect(deliver).not.toHaveBeenCalled()
    expect(s.getPanels().size).toBe(0)
  })

  it('rejects a request with a wrong token with 401', async () => {
    const s = await start()
    const res = await fetch(s, '/ui/render', {
      method: 'POST',
      body: { panelId: 'p', spec: kanbanSpec },
      token: 'wrong-token'
    })
    expect(res.status).toBe(401)
  })

  it('renders a valid kanban panel and delivers it to the renderer', async () => {
    const s = await start()
    const res = await fetch(s, '/ui/render', {
      method: 'POST',
      body: { panelId: 'board', spec: kanbanSpec }
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.panelId).toBe('board')
    expect(res.body.delivered).toBe(true)
    expect(deliver).toHaveBeenCalledWith('board', kanbanSpec)
    expect(s.getPanels().get('board')).toEqual(kanbanSpec)
  })

  it('returns a readable error for an invalid spec and keeps the server alive', async () => {
    const s = await start()
    const res = await fetch(s, '/ui/render', {
      method: 'POST',
      body: { panelId: 'bad', spec: { type: 'kanban', title: '' } }
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_spec')
    expect(String(res.body.message)).toContain('title')
    // Server still usable after the rejected request.
    const ok = await fetch(s, '/ui/render', {
      method: 'POST',
      body: { panelId: 'board', spec: kanbanSpec }
    })
    expect(ok.status).toBe(200)
  })

  it('rejects an unknown panel type with a readable error', async () => {
    const s = await start()
    const res = await fetch(s, '/ui/render', {
      method: 'POST',
      body: { panelId: 'p2', spec: { type: 'gauge', title: 'x' } }
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_spec')
  })

  it('round-trips state through GET/POST /ui/state/:key', async () => {
    const s = await start()
    const value = { phase: 'planning', items: [1, 2, 3] }
    const postRes = await fetch(s, '/ui/state/planner', {
      method: 'POST',
      body: { value }
    })
    expect(postRes.status).toBe(200)
    expect(postRes.body.stored).toBe(true)

    const getRes = await fetch(s, '/ui/state/planner')
    expect(getRes.status).toBe(200)
    expect(getRes.body.value).toEqual(value)

    // Unknown key => 404.
    const missing = await fetch(s, '/ui/state/nope')
    expect(missing.status).toBe(404)
    expect(missing.body.error).toBe('state_not_found')
  })

  it('rejects a state POST without a value field', async () => {
    const s = await start()
    const res = await fetch(s, '/ui/state/k', {
      method: 'POST',
      body: { notValue: 1 }
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_state')
  })

  it('returns 404 for unknown routes after auth', async () => {
    const s = await start()
    const res = await fetch(s, '/ui/unknown')
    expect(res.status).toBe(404)
  })

  it('returns 405 for a non-POST render request', async () => {
    const s = await start()
    const res = await fetch(s, '/ui/render')
    expect(res.status).toBe(405)
  })
})
