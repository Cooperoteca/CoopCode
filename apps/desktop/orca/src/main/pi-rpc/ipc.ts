import { ipcMain } from 'electron'
import {
  PI_RPC_DISPOSE_CHANNEL,
  PI_RPC_FRAME_CHANNEL,
  PI_RPC_SEND_CHANNEL,
  PI_RPC_START_CHANNEL,
  type PiRpcCommand,
  type PiRpcSpawnConfig
} from '../../shared/pi-rpc'
import { isTrustedUIRenderer, sendToTrustedUIRenderer } from '../ipc/ui'
import type { PiRpcClient } from './client'

/**
 * Registers the pi-rpc IPC surface. Every handler is gated on the trusted UI
 * renderer (mirrors the orca-ui channel). Frames pushed from the child are
 * relayed to the trusted renderer over PI_RPC_FRAME_CHANNEL.
 *
 * `getClient` is a thunk so callers control the single client lifecycle and can
 * wire the frame listener to the renderer.
 */
export function registerPiRpcIpcHandlers(getClient: () => PiRpcClient | null): void {
  ipcMain.removeAllListeners(PI_RPC_START_CHANNEL)
  ipcMain.handle(
    PI_RPC_START_CHANNEL,
    async (event, config?: PiRpcSpawnConfig): Promise<void> => {
      if (!isTrustedUIRenderer(event.sender)) {
        return
      }
      const client = getClient()
      if (!client) {
        return
      }
      await client.start({ cwd: config?.cwd })
    }
  )

  ipcMain.removeAllListeners(PI_RPC_SEND_CHANNEL)
  ipcMain.handle(
    PI_RPC_SEND_CHANNEL,
    (event, command: PiRpcCommand): void => {
      if (!isTrustedUIRenderer(event.sender)) {
        return
      }
      const client = getClient()
      if (!client) {
        return
      }
      client.send(command)
    }
  )

  ipcMain.removeAllListeners(PI_RPC_DISPOSE_CHANNEL)
  ipcMain.handle(PI_RPC_DISPOSE_CHANNEL, (event): void => {
    if (!isTrustedUIRenderer(event.sender)) {
      return
    }
    getClient()?.dispose()
  })
}

/** Convenience: builds the frame relay used to push child frames to the renderer. */
export function createPiRpcFrameRelay(): (frame: { kind: 'frame'; payload: unknown }) => void {
  return (frame) => {
    sendToTrustedUIRenderer(PI_RPC_FRAME_CHANNEL, frame)
  }
}
