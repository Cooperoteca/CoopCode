import { ipcMain } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  PI_SESSIONS_LIST_CHANNEL,
  type PiSessionsListResult
} from '../../shared/pi-rpc'
import { isTrustedUIRenderer } from '../ipc/ui'
import { buildPiSessionsIndex } from './session-index'

/**
 * Registers the pi session-history IPC surface. Every handler is gated on the
 * trusted UI renderer (mirrors src/main/pi-rpc/ipc.ts). The sessions directory
 * is resolved here, in the handler, so the pure index function stays injectable
 * and testable with `buildPiSessionsIndex(sessionsDir)`.
 */
export function registerPiSessionsIpcHandlers(): void {
  ipcMain.removeAllListeners(PI_SESSIONS_LIST_CHANNEL)
  ipcMain.handle(
    PI_SESSIONS_LIST_CHANNEL,
    (event): PiSessionsListResult => {
      if (!isTrustedUIRenderer(event.sender)) {
        return { projects: [] }
      }
      const sessionsDir = join(homedir(), '.prime', 'agent', 'sessions')
      return buildPiSessionsIndex(sessionsDir)
    }
  )
}
