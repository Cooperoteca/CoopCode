import { ipcMain } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  PI_EXTENSIONS_WRITE_PROVIDER_CHANNEL,
  type PiExtensionWriteResult,
  type PiProviderExtensionSpec
} from '../../shared/pi-rpc'
import { isTrustedUIRenderer } from '../ipc/ui'
import { writeProviderExtension } from './extension-writer'

/**
 * Registers the pi provider-extension IPC surface. Every handler is gated on
 * the trusted UI renderer (mirrors src/main/pi-rpc/ipc.ts). The extensions
 * directory is resolved here, in the handler, to <homedir>/.prime/agent/extensions
 * and created recursively when missing; the pure writer stays injectable and
 * testable with `writeProviderExtension(spec, dir)`.
 */
export function registerPiExtensionsIpcHandlers(): void {
  ipcMain.removeAllListeners(PI_EXTENSIONS_WRITE_PROVIDER_CHANNEL)
  ipcMain.handle(
    PI_EXTENSIONS_WRITE_PROVIDER_CHANNEL,
    (event, spec: PiProviderExtensionSpec): PiExtensionWriteResult => {
      if (!isTrustedUIRenderer(event.sender)) {
        return { ok: false, error: 'Untrusted renderer' }
      }
      const extensionsDir = join(homedir(), '.prime', 'agent', 'extensions')
      return writeProviderExtension(spec, extensionsDir)
    }
  )
}
