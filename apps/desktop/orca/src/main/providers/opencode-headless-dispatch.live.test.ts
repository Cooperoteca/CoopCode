import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  ensureOpenCodeAgentProfile,
  openCodeAgentFileMatchesPermissions,
  pickOpenCodeServePort,
  resolveOpenCodeBinary,
  startOrReuseOpenCodeServe
} from './opencode-headless-dispatch'

describe('Live E2E Verification (DEVX-049)', { timeout: 60000 }, () => {
  it('Criterion 1: Resolves vendored opencode binary and starts headless serve', async () => {
    const binary = resolveOpenCodeBinary()
    expect(binary).not.toBe('opencode')
    expect(binary.endsWith('opencode.exe')).toBe(true)
    expect(existsSync(binary)).toBe(true)

    const worktreeDir = process.cwd()
    const handle = await startOrReuseOpenCodeServe({
      worktreeId: 'wt-devx049-live-verification',
      worktreeDir
    })

    expect(handle.url).toContain('127.0.0.1')
    expect(handle.port).toBeGreaterThan(0)

    // Check health endpoint on running serve
    const res = await fetch(`${handle.url}/global/health`)
    expect(res.ok).toBe(true)
    const health = (await res.json()) as { healthy: boolean }
    expect(health.healthy).toBe(true)
  })

  it('Criterion 2: GET /session returns valid session list on running serve', async () => {
    const port = pickOpenCodeServePort('wt-devx049-live-verification')
    const url = `http://127.0.0.1:${port}`

    const res = await fetch(`${url}/session`)
    expect(res.ok).toBe(true)
    const sessions = await res.json()
    expect(Array.isArray(sessions)).toBe(true)
  })

  it('Criterion 3: Real opencode agent create generates frontmatter matching permissions', async () => {
    const worktreeDir = process.cwd()
    const profileName = 'dx-resolver-auditor'
    const agentPath = resolve(worktreeDir, '..', '..', '..', '.scratch', 'devx049-live', 'reverify')
    const agentFile = join(agentPath, '.opencode', 'agents', `${profileName}.md`)

    expect(existsSync(agentFile)).toBe(true)
    const content = readFileSync(agentFile, 'utf8')

    const matches = openCodeAgentFileMatchesPermissions(content, ['read', 'glob', 'grep'])
    expect(matches).toBe(true)
  })

  it('Criterion 4: Restricted agent profile explicitly denies non-granted tools (bash, edit, etc.)', async () => {
    const worktreeDir = resolve(process.cwd(), '..', '..', '..', '.scratch', 'devx049-live', 'reverify')
    const profileName = 'dx-resolver-auditor'

    const result = await ensureOpenCodeAgentProfile({
      worktreeDir,
      profile: profileName,
      permissions: ['read', 'glob', 'grep']
    })

    expect(existsSync(result.file)).toBe(true)
    const frontmatter = readFileSync(result.file, 'utf8')

    // Denied permissions must be explicitly set to deny
    expect(frontmatter).toContain('bash: deny')
    expect(frontmatter).toContain('edit: deny')
    expect(frontmatter).toContain('webfetch: deny')
    expect(frontmatter).toContain('task: deny')

    // Validation function returns true for read-mostly profile
    expect(openCodeAgentFileMatchesPermissions(frontmatter, ['read', 'glob', 'grep'])).toBe(true)

    // Rejection check: if caller asked for bash, this file must fail validation
    expect(openCodeAgentFileMatchesPermissions(frontmatter, ['read', 'glob', 'grep', 'bash'])).toBe(false)
  })
})
