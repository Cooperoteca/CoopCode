import { spawn, type ChildProcess } from 'node:child_process'
import type { PiRpcCommand, PiRpcFrame } from '../../shared/pi-rpc'
import { createJsonlReader, parseJsonLine, type JsonlReader } from './jsonl'

/** Absolute path of the pi (prime-agent) CLI entry point used for the spike. */
export const PI_RPC_CLI_PATH =
  'C:/Dev2026/external_repos/prime-agent/packages/coding-agent/dist/cli.js'

/** Optional overrides; unset means pi resolves provider/model from its own config. */
export const PI_RPC_PROVIDER_ENV = 'ORCA_PI_PROVIDER'
export const PI_RPC_MODEL_ENV = 'ORCA_PI_MODEL'

export type PiRpcStartOptions = {
  /** Working directory for the child; defaults to the main process cwd. */
  cwd?: string
  provider?: string
  model?: string
}

/**
 * Why no default provider: forcing one that the host has not registered makes pi
 * exit with `Unknown provider`, which the renderer can only report as a request
 * timeout — a message pointing away from the cause. Omitting the flags lets pi
 * use its configured default, and falls back to a built-in provider on a machine
 * with no pi config at all.
 */
export function buildPiRpcArgs(
  options: PiRpcStartOptions = {},
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const provider = options.provider ?? env[PI_RPC_PROVIDER_ENV]
  const model = options.model ?? env[PI_RPC_MODEL_ENV]
  return [
    PI_RPC_CLI_PATH,
    '--mode',
    'rpc',
    ...(provider ? ['--provider', provider] : []),
    ...(model ? ['--model', model] : [])
  ]
}

export type PiRpcFrameListener = (frame: PiRpcFrame) => void

/** Owns the `pi --mode rpc` child process and streams parsed JSONL frames out.
 *
 * Responsibilities:
 *  - spawn the pi CLI with `windowsHide: true` (never flash a Windows console),
 *  - frame stdout with an LF-only reader (readline would corrupt U+2028/U+2029),
 *  - guard every line parse so a bad line can never take the stream down,
 *  - `dispose()` terminates the child (kill + SIGKILL escalation).
 */
export class PiRpcClient {
  private child: ChildProcess | null = null
  private reader: JsonlReader | null = null
  private readonly onFrame: PiRpcFrameListener
  private started = false
  private disposed = false

  constructor(onFrame: PiRpcFrameListener) {
    this.onFrame = onFrame
  }

  get isRunning(): boolean {
    return (
      this.child !== null && this.child.exitCode === null && this.child.signalCode === null
    )
  }

  async start(options: PiRpcStartOptions = {}): Promise<void> {
    if (this.disposed) {
      throw new Error('PiRpcClient was disposed')
    }
    if (this.started) {
      throw new Error('PiRpcClient already started')
    }
    const child = spawn(
      'node',
      buildPiRpcArgs(options),
      {
        cwd: options.cwd || process.cwd(),
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      }
    )
    this.child = child
    this.started = true

    // stderr is piped but intentionally drained, not forwarded to the renderer:
    // it only carries node environment warnings and could mention tokens.
    child.stderr?.resume()

    if (!child.stdout) {
      throw new Error('pi RPC child stdout unavailable')
    }
    this.reader = createJsonlReader(child.stdout, (line) => {
      const payload = parseJsonLine(line)
      if (payload === undefined) {
        return
      }
      this.onFrame({ kind: 'frame', payload })
    })

    child.once('error', (err) => {
      // Spawn failures surface here (e.g. bad executable path).
      console.warn('[pi-rpc] child error', err)
    })
    child.stdin?.on('error', () => {
      // Writes can fail if the child exits mid-stream; never throw to callers.
    })

    await new Promise<void>((resolve) => queueMicrotask(resolve))
    if (child.exitCode !== null) {
      throw new Error(`pi RPC child exited early (code ${child.exitCode})`)
    }
  }

  send(command: PiRpcCommand): void {
    const child = this.child
    const stdin = child?.stdin
    if (!child || !stdin || !stdin.writable) {
      throw new Error('PiRpcClient is not running')
    }
    stdin.write(`${JSON.stringify(command)}\n`)
  }

  dispose(): void {
    this.disposed = true
    this.reader?.detach()
    this.reader = null
    const child = this.child
    this.child = null
    if (!child) {
      return
    }
    try {
      child.stdin?.end()
    } catch {
      // ignore: the child may already be gone
    }
    child.kill('SIGTERM')
    const timer = setTimeout(() => {
      try {
        if (!child.killed) {
          child.kill('SIGKILL')
        }
      } catch {
        // ignore: already gone
      }
    }, 1500)
    if (typeof timer.unref === 'function') {
      timer.unref()
    }
  }
}
