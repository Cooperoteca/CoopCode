// Why: the pi RPC frame stream is one shared push channel, so the picker must
// correlate command/response pairs by the echoed `id`. These tests pin the
// correlation helper: matching-id resolution, wrong-id frames ignored,
// success:false rejection, send-failure rejection, and timeout behaviour -
// all against a fake preload surface (no pi/electron runtime needed).

import { describe, expect, it, vi } from 'vitest'
import {
  isResponseForId,
  makeRequestId,
  PiRpcRequestTimeoutError,
  requestRpc,
  type PiRpcSender
} from './pi-rpc-request'

type Frame = { kind: 'frame'; payload: unknown }

function makeFakeApi(): {
  api: PiRpcSender
  sent: Record<string, unknown>[]
  emit: (frame: Frame) => void
  listeners: Set<(frame: Frame) => void>
} {
  const listeners = new Set<(frame: Frame) => void>()
  const sent: Record<string, unknown>[] = []
  const api: PiRpcSender = {
    send: vi.fn(async (command) => {
      sent.push(command as unknown as Record<string, unknown>)
    }),
    onFrame: vi.fn((callback) => {
      listeners.add(callback)
      return () => listeners.delete(callback)
    })
  }
  return {
    api,
    sent,
    emit: (frame) => {
      for (const listener of listeners) {
        listener(frame)
      }
    },
    listeners
  }
}

function response(id: string, extra: Record<string, unknown>): Frame {
  return { kind: 'frame', payload: { type: 'response', id, ...extra } }
}

describe('requestRpc correlation helper', () => {
  it('sends the command tagged with a unique correlation id', async () => {
    const { api, sent } = makeFakeApi()
    const promise = requestRpc(api, { type: 'get_state' }, { timeoutMs: 1000 })
    const command = sent[0]
    expect(command).toBeDefined()
    expect(command.type).toBe('get_state')
    expect(typeof command.id).toBe('string')
    expect(String(command.id).length).toBeGreaterThan(0)

    promise.catch(() => undefined) // suppress unhandled rejection from timeout
  })

  it('resolves with data when a response with the same id arrives', async () => {
    const { api, sent, emit } = makeFakeApi()
    const promise = requestRpc<{ ok: boolean }>(api, { type: 'get_state' })
    const id = String(sent[0].id)

    emit(response('some-other-request', { command: 'get_state', success: true, data: { wrong: true } }))
    emit(response(id, { command: 'get_state', success: true, data: { ok: true } }))

    await expect(promise).resolves.toEqual({ ok: true })
  })

  it('ignores response frames carrying a different id', async () => {
    const { api, sent, emit } = makeFakeApi()
    const promise = requestRpc<{ v: number }>(api, { type: 'get_state' })
    const id = String(sent[0].id)

    emit(response('unrelated', { command: 'get_state', success: true, data: { v: 1 } }))
    // No matching frame yet - promise must stay pending.
    let settled = false
    void promise.then(() => (settled = true)).catch(() => (settled = true))
    await new Promise((resolve) => setImmediate(resolve))
    expect(settled).toBe(false)

    emit(response(id, { command: 'get_state', success: true, data: { v: 2 } }))
    await expect(promise).resolves.toEqual({ v: 2 })
  })

  it('rejects with the pi error message on success:false', async () => {
    const { api, sent, emit } = makeFakeApi()
    const promise = requestRpc<never>(api, {
      type: 'set_model',
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-5'
    })
    const id = String(sent[0].id)

    emit(response(id, { command: 'set_model', success: false, error: 'provider not configured' }))

    const error = await promise.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('provider not configured')
  })

  it('resolves with null when the response carries no data', async () => {
    const { api, sent, emit } = makeFakeApi()
    const promise = requestRpc<unknown>(api, { type: 'get_state' })
    const id = String(sent[0].id)
    emit(response(id, { command: 'get_state', success: true }))
    await expect(promise).resolves.toBeNull()
  })

  it('rejects when the underlying send() throws', async () => {
    const { api } = makeFakeApi()
    ;(api.send as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('send exploded'))
    const promise = requestRpc(api, { type: 'abort' })
    await expect(promise).rejects.toThrow('send exploded')
  })

  it('rejects with PiRpcRequestTimeoutError after the timeout elapses', async () => {
    vi.useFakeTimers()
    try {
      const { api } = makeFakeApi()
      const promise = requestRpc(api, { type: 'get_available_models' }, { timeoutMs: 500 })
      vi.advanceTimersByTime(501)
      const error = await promise.catch((e: unknown) => e)
      expect(error).toBeInstanceOf(PiRpcRequestTimeoutError)
      expect((error as Error).message).toContain('get_available_models')
    } finally {
      vi.useRealTimers()
    }
  })

  it('unsubscribes from the frame stream once resolved', async () => {
    const { api, sent, emit, listeners } = makeFakeApi()
    const promise = requestRpc<{ done: boolean }>(api, { type: 'get_state' })
    const id = String(sent[0].id)
    emit(response(id, { command: 'get_state', success: true, data: { done: true } }))
    await promise
    expect(listeners.size).toBe(0)
  })
})

describe('isResponseForId', () => {
  it('is false for null, primitives, and non-response payloads', () => {
    expect(isResponseForId(null, 'x')).toBe(false)
    expect(isResponseForId(undefined, 'x')).toBe(false)
    expect(isResponseForId('text', 'x')).toBe(false)
    expect(isResponseForId(42, 'x')).toBe(false)
    expect(isResponseForId({ type: 'message_start' }, 'x')).toBe(false)
    expect(isResponseForId({ type: 'response' }, 'x')).toBe(false)
    expect(isResponseForId({ type: 'response', id: 'other' }, 'x')).toBe(false)
  })

  it('is true for a response carrying the requested id', () => {
    expect(isResponseForId({ type: 'response', id: 'abc' }, 'abc')).toBe(true)
  })
})

describe('makeRequestId', () => {
  it('produces distinct, non-empty ids', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 50; i += 1) {
      ids.add(makeRequestId())
    }
    expect(ids.size).toBe(50)
    for (const id of ids) {
      expect(id.length).toBeGreaterThan(0)
    }
  })
})
