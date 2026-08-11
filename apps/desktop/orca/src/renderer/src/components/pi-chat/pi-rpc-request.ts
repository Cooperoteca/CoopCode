// Why: spike - the pi RPC frame stream is a single push channel (preload
// api.onFrame) shared by the conversation reducer and any command/response
// dialogs. The pi CLI echoes the optional `id` it receives back on the matching
// `response` frame, so this module correlates request/response pairs with a
// unique per-request id and resolves a Promise when the right frame lands.
//
// The wire contract and PiRpcCommand type live in src/shared/pi-rpc.ts (read-only
// for this feature); this helper only adds correlation + timeout on top.

import type { PiRpcCommand } from '../../../../shared/pi-rpc'

/** Minimal preload surface the requester depends on (subset of PiRpcApi). */
export type PiRpcSender = {
  send: (command: PiRpcCommand) => Promise<void>
  onFrame: (callback: (frame: { kind: 'frame'; payload: unknown }) => void) => () => void
}

/** Narrow projection of a pi RPC `response` frame. */
export type PiRpcResponse = {
  id?: string
  type?: string
  command?: string
  success?: boolean
  data?: unknown
  error?: string
}

export class PiRpcRequestTimeoutError extends Error {
  constructor(commandType: string, timeoutMs: number) {
    super(`pi RPC request for command "${commandType}" timed out after ${timeoutMs}ms`)
    this.name = 'PiRpcRequestTimeoutError'
  }
}

let requestSequence = 0

/** Unique, stable-ish correlation token echoed back by the pi CLI. */
export function makeRequestId(): string {
  requestSequence += 1
  return `pi-req-${Date.now().toString(36)}-${requestSequence}`
}

/** True when a parsed frame payload is a `response` frame carrying `id`. */
export function isResponseForId(payload: unknown, id: string): boolean {
  if (payload === null || payload === undefined || typeof payload !== 'object') {
    return false
  }
  const p = payload as PiRpcResponse
  return p.type === 'response' && p.id !== undefined && String(p.id) === id
}

/**
 * Sends one RPC command tagged with a unique id, subscribes to the frame stream
 * until a response with that id arrives, and resolves with the response `data`
 * (or null when the frame carried no data). Rejects when the command `send`
 * fails, when the pi CLI returns `success: false`, or after `timeoutMs`.
 */
export function requestRpc<T>(
  api: PiRpcSender,
  command: PiRpcCommand,
  options?: { timeoutMs?: number; id?: string }
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? 10_000
  const id = options?.id ?? makeRequestId()

  return new Promise<T>((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const settle = (fn: () => void): void => {
      if (settled) {
        return
      }
      settled = true
      if (timer !== undefined) {
        clearTimeout(timer)
      }
      unsubscribe()
      fn()
    }

    const unsubscribe = api.onFrame((frame) => {
      const payload = frame?.payload
      if (!isResponseForId(payload, id)) {
        // Ignore frames for other requests / unrelated events.
        return
      }
      const p = payload as PiRpcResponse
      if (p.success === false) {
        const message = p.error ?? `pi RPC command "${command.type}" failed`
        settle(() => reject(new Error(message)))
        return
      }
      settle(() => resolve((p.data ?? null) as T))
    })

    timer = setTimeout(() => {
      settle(() => reject(new PiRpcRequestTimeoutError(command.type, timeoutMs)))
    }, timeoutMs)

    void api.send({ ...command, id }).catch((error: unknown) => {
      settle(() =>
        reject(error instanceof Error ? error : new Error(`pi RPC send failed: ${String(error)}`))
      )
    })
  })
}
