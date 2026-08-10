// Why: the `pi` Prime Agent runs as a TUI in a pseudo-terminal, so Orca only
// sees rendered terminal bytes. To let the agent draw real UI panels inside the
// Orca window, this module exposes a loopback-only HTTP server (127.0.0.1,
// ephemeral port) that accepts declarative panel render requests and forwards
// them to the renderer over IPC. The renderer owns rendering; the server only
// validates and relays. Security: binds only to 127.0.0.1, every request needs
// a per-session bearer token (ORCA_UI_TOKEN) compared in constant time, and the
// renderer-facing IPC is gated on the same trusted-renderer boundary used across
// the app. The token is never written to disk nor typed into the shell; it is
// delivered to the agent via the PTY environment (ORCA_UI_PORT / ORCA_UI_TOKEN).

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { ipcMain } from 'electron'
import {
  OrcaUiRenderRequestSchema,
  formatOrcaUiValidationError,
  type OrcaUiPanelSpec
} from '../../shared/orca-ui-panel-spec'
import { isTrustedUIRenderer } from '../ipc/ui'

const MAX_REQUEST_BODY_BYTES = 1024 * 1024

export const ORCA_UI_CONNECTION_INFO_CHANNEL = 'orca-ui:getConnectionInfo'
export const ORCA_UI_RENDER_CHANNEL = 'orca-ui:render'
export const ORCA_UI_GET_PANELS_CHANNEL = 'orca-ui:getPanels'

export type OrcaUiConnectionInfo = {
  port: number
  token: string
}

export type OrcaUiServer = {
  port: number
  token: string
  close: () => Promise<void>
  getPanels: () => ReadonlyMap<string, OrcaUiPanelSpec>
}

type OrcaUiServerDeps = {
  // Why: injected so the server is unit-testable without Electron. The caller
  // supplies sendToTrustedUIRenderer and reports whether delivery succeeded.
  deliver: (panelId: string, spec: OrcaUiPanelSpec) => boolean
  onError?: (error: unknown) => void
}


function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_REQUEST_BODY_BYTES) {
        reject(new Error('Request body too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (chunks.length === 0) {
        resolve(undefined)
        return
      }
      const raw = Buffer.concat(chunks).toString('utf8')
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    request.on('error', reject)
  })
}

function tokensEqual(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected, 'utf8')
  const actualBuffer = Buffer.from(actual, 'utf8')
  if (expectedBuffer.length !== actualBuffer.length) {
    return false
  }
  return timingSafeEqual(expectedBuffer, actualBuffer)
}

function bearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization
  if (typeof header !== 'string') {
    return null
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1] : null
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  })
  response.end(JSON.stringify(body))
}

class OrcaUiPanelStore {
  private readonly panels = new Map<string, OrcaUiPanelSpec>()

  set(panelId: string, spec: OrcaUiPanelSpec): void {
    this.panels.set(panelId, spec)
  }

  get(panelId: string): OrcaUiPanelSpec | undefined {
    return this.panels.get(panelId)
  }

  entries(): ReadonlyMap<string, OrcaUiPanelSpec> {
    return this.panels
  }
}

export async function startOrcaUiServer(deps: OrcaUiServerDeps): Promise<OrcaUiServer> {
  const token = randomBytes(24).toString('hex')
  const panels = new OrcaUiPanelStore()
  const stateStore = new Map<string, unknown>()

  const server = createServer((request, response) => {
    const url = request.url
    if (!url) {
      writeJson(response, 400, { error: 'missing_url' })
      return
    }
    let pathname: string
    try {
      pathname = decodeURIComponent(new URL(url, 'http://127.0.0.1').pathname)
    } catch {
      writeJson(response, 400, { error: 'invalid_url' })
      return
    }

    const suppliedToken = bearerToken(request)
    if (!suppliedToken || !tokensEqual(token, suppliedToken)) {
      writeJson(response, 401, {
        error: 'unauthorized',
        message: 'Missing or invalid ORCA_UI_TOKEN bearer token.'
      })
      return
    }

    void handleRequest(request, response, pathname, panels, stateStore, deps)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      server.on('error', (error) => deps.onError?.(error))
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    await closeServer(server)
    throw new Error('Could not start the Orca UI server.')
  }
  const port = address.port

  let closed = false
  return {
    port,
    token,
    getPanels: () => panels.entries(),
    close: async () => {
      if (closed) {
        return
      }
      closed = true
      await closeServer(server)
      server.closeAllConnections()
    }
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  panels: OrcaUiPanelStore,
  stateStore: Map<string, unknown>,
  deps: OrcaUiServerDeps
): Promise<void> {
  try {
    if (pathname === '/ui/render') {
      if (request.method !== 'POST') {
        writeJson(response, 405, { error: 'method_not_allowed', message: 'Use POST for /ui/render.' })
        return
      }
      const body = await readJsonBody(request)
      const parsed = OrcaUiRenderRequestSchema.safeParse(body)
      if (!parsed.success) {
        writeJson(response, 400, {
          error: 'invalid_spec',
          message: formatOrcaUiValidationError(parsed.error)
        })
        return
      }
      const { panelId, spec } = parsed.data
      panels.set(panelId, spec)
      const delivered = deps.deliver(panelId, spec)
      writeJson(response, 200, { ok: true, panelId, delivered, panels: panels.entries().size })
      return
    }

    const stateMatch = /^\/ui\/state\/([^/]+)$/.exec(pathname)
    if (stateMatch) {
      const key = decodeURIComponent(stateMatch[1])
      if (request.method === 'GET') {
        if (!stateStore.has(key)) {
          writeJson(response, 404, { error: 'state_not_found', message: `State key not found: ${key}` })
          return
        }
        writeJson(response, 200, { key, value: stateStore.get(key) })
        return
      }
      if (request.method === 'POST') {
        const body = await readJsonBody(request)
        if (typeof body !== 'object' || body === null || !('value' in body)) {
          writeJson(response, 400, {
            error: 'invalid_state',
            message: 'Expected a JSON object with a "value" field.'
          })
          return
        }
        stateStore.set(key, (body as { value: unknown }).value)
        writeJson(response, 200, { ok: true, key, stored: true })
        return
      }
      writeJson(response, 405, { error: 'method_not_allowed', message: 'Use GET or POST for /ui/state/:key.' })
      return
    }

    writeJson(response, 404, { error: 'not_found', message: `No route for ${request.method} ${pathname}` })
  } catch (error) {
    deps.onError?.(error)
    const message = error instanceof Error ? error.message : 'Unknown server error'
    writeJson(response, 400, { error: 'bad_request', message })
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve())
  })
}

// Why: the renderer reads the connection info (port + token) and the stored
// panels through the trusted renderer IPC boundary. The token is intentionally
// exposed to the trusted renderer (it already can spawn PTYs and read the whole
// app state); the renderer surfaces it to the agent only via the PTY env, never
// into terminal scrollback.
export function registerOrcaUiIpcHandlers(getServer: () => OrcaUiServer | null): void {
  ipcMain.removeAllListeners(ORCA_UI_CONNECTION_INFO_CHANNEL)
  ipcMain.handle(ORCA_UI_CONNECTION_INFO_CHANNEL, (event) => {
    if (!isTrustedUIRenderer(event.sender)) {
      return null
    }
    const server = getServer()
    if (!server) {
      return null
    }
    return { port: server.port, token: server.token } satisfies OrcaUiConnectionInfo
  })

  ipcMain.removeAllListeners(ORCA_UI_GET_PANELS_CHANNEL)
  ipcMain.handle(ORCA_UI_GET_PANELS_CHANNEL, (event) => {
    if (!isTrustedUIRenderer(event.sender)) {
      return null
    }
    const server = getServer()
    if (!server) {
      return null
    }
    return Object.fromEntries(server.getPanels())
  })
}
