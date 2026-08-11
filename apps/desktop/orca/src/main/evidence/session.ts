import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import type { Claim, ClaimFamily, RunResult, SessionSummary } from './types'

const execFileAsync = promisify(execFile)

const MAX_OUTPUT_LENGTH = 10000

function now(): string {
  return new Date().toISOString()
}

function truncate(text: string): string {
  if (text.length <= MAX_OUTPUT_LENGTH) return text
  return text.slice(0, MAX_OUTPUT_LENGTH) + '…[truncated]'
}

export class EvidenceSession {
  readonly id: string
  readonly startedAt: string
  finishedAt: string | null = null
  readonly runs: RunResult[] = []
  readonly claims: Claim[] = []

  constructor() {
    this.id = randomUUID()
    this.startedAt = now()
  }

  end(): void {
    this.finishedAt = now()
  }

  async run(command: string): Promise<RunResult> {
    const startedAt = now()
    let exitCode = -1
    let stdout = ''
    let stderr = ''

    try {
      const result = await execFileAsync('cmd.exe', ['/d', '/s', '/c', command], {
        timeout: 300_000,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true
      })
      // promisified execFile only resolves on exit 0; anything else rejects below.
      exitCode = 0
      stdout = result.stdout
      stderr = result.stderr
    } catch (err: unknown) {
      const execErr = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number }
      exitCode = execErr.code ?? 1
      stdout = execErr.stdout ?? ''
      stderr = execErr.stderr ?? ''
    }

    const finishedAt = now()

    const runResult: RunResult = {
      command,
      exitCode,
      stdout: truncate(stdout),
      stderr: truncate(stderr),
      startedAt,
      finishedAt
    }

    this.runs.push(runResult)
    return runResult
  }

  claim(family: ClaimFamily, passed: boolean): Claim {
    const startedAt = now()
    const claim: Claim = {
      family,
      passed,
      startedAt,
      finishedAt: startedAt
    }
    this.claims.push(claim)
    return claim
  }

  summary(): SessionSummary {
    return {
      id: this.id,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      runs: [...this.runs],
      claims: [...this.claims]
    }
  }
}
