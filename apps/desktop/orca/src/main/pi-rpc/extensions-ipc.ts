import { ipcMain } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  PI_EXTENSIONS_LIST_PROVIDERS_CHANNEL,
  PI_EXTENSIONS_WRITE_PROVIDER_CHANNEL,
  type PiExtensionWriteResult,
  type PiProviderExtensionSpec,
  type PiProvidersListResult
} from '../../shared/pi-rpc'
import { isTrustedUIRenderer } from '../ipc/ui'
import { listProvidersFromModelsJson, writeProviderToModelsJson } from './models-json-writer'

/**
 * Registers the pi provider-registration IPC surface. Every handler is gated on
 * the trusted UI renderer (mirrors src/main/pi-rpc/ipc.ts). The models.json path
 * is resolved here, in the handler, to <homedir>/.prime/agent/models.json (the
 * same path pi resolves via getModelsPath()); the pure writer stays injectable
 * and testable with `writeProviderToModelsJson(spec, modelsPath)`.
 */
export function registerPiExtensionsIpcHandlers(): void {
  ipcMain.removeAllListeners(PI_EXTENSIONS_WRITE_PROVIDER_CHANNEL)
  ipcMain.handle(
    PI_EXTENSIONS_WRITE_PROVIDER_CHANNEL,
    (event, spec: PiProviderExtensionSpec): PiExtensionWriteResult => {
      if (!isTrustedUIRenderer(event.sender)) {
        return { ok: false, error: 'Untrusted renderer' }
      }
      const modelsPath = join(homedir(), '.prime', 'agent', 'models.json')
      return writeProviderToModelsJson(spec, modelsPath)
    }
  )

  ipcMain.removeAllListeners(PI_EXTENSIONS_LIST_PROVIDERS_CHANNEL)
  ipcMain.handle(
    PI_EXTENSIONS_LIST_PROVIDERS_CHANNEL,
    (event): PiProvidersListResult => {
      if (!isTrustedUIRenderer(event.sender)) {
        return { providers: [] }
      }
      const modelsPath = join(homedir(), '.prime', 'agent', 'models.json')
      return listProvidersFromModelsJson(modelsPath)
    }
  )
}
