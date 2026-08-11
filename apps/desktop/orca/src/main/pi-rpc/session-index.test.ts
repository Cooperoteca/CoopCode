import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildPiSessionsIndex } from './session-index'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'pi-sessions-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

function writeSession(name: string, header: string): string {
  const path = join(tempDir, name)
  // Simulate a multi-megabyte transcript whose first line is the JSON header.
  writeFileSync(path, `${header}\nignored body line\nignored body line\n`)
  return path
}

describe('buildPiSessionsIndex', () => {
  it('ships an empty index for a directory containing no session files', () => {
    expect(buildPiSessionsIndex(tempDir)).toEqual({ projects: [] })
  })

  it('returns an empty index when the sessions directory does not exist', () => {
    expect(buildPiSessionsIndex(join(tempDir, 'missing'))).toEqual({ projects: [] })
  })

  it('skips an empty file (case a)', () => {
    writeFileSync(join(tempDir, 'empty.jsonl'), '')
    expect(buildPiSessionsIndex(tempDir)).toEqual({ projects: [] })
  })

  it('skips a file whose first line is invalid JSON (case b)', () => {
    writeFileSync(join(tempDir, 'garbage.jsonl'), 'not-a-json-header\n')
    expect(buildPiSessionsIndex(tempDir)).toEqual({ projects: [] })
  })

  it('skips a header without a usable id', () => {
    writeSession('no-id.jsonl', JSON.stringify({ type: 'session', cwd: tempDir }))
    expect(buildPiSessionsIndex(tempDir)).toEqual({ projects: [] })
  })

  it('falls back to cwd as project and null branch when there is no git block (case c)', () => {
    const header = {
      type: 'session',
      version: 3,
      id: 'nos-git',
      timestamp: '2026-01-01T10:00:00.000Z',
      cwd: 'C:/some/path'
    }
    writeSession('no-git.jsonl', JSON.stringify(header))
    const result = buildPiSessionsIndex(tempDir)
    expect(result.projects).toHaveLength(1)
    expect(result.projects[0].project).toBe('C:/some/path')
    expect(result.projects[0].branches).toEqual([
      { branch: null, sessions: [
        { sessionPath: join(tempDir, 'no-git.jsonl'), sessionId: 'nos-git', timestamp: '2026-01-01T10:00:00.000Z', cwd: 'C:/some/path' }
      ] }
    ])
  })

  it('resolves escaped Windows backslashes in the cwd JSON header (case d)', () => {
    // JSON.stringify produces the on-disk escapes ("C:\\Dev2026\\x"); JSON.parse
    // in the index resolves them to a single-backslash path, which the test asserts.
    const raw = JSON.stringify({
      type: 'session',
      version: 3,
      id: 'win',
      timestamp: '2026-01-01T09:00:00.000Z',
      cwd: 'C:\\Dev2026\\x',
      git: { repoUrl: 'https://github.com/acme/repo.git', branch: 'spike/pi' }
    })
    const path = writeSession('win.jsonl', raw)
    const result = buildPiSessionsIndex(tempDir)
    expect(result.projects).toHaveLength(1)
    expect(result.projects[0].project).toBe('https://github.com/acme/repo.git')
    const sessions = result.projects[0].branches[0].sessions
    // Proves JSON.parse resolved the double backslashes to single ones.
    expect(sessions[0].cwd).toBe('C:\\Dev2026\\x')
    expect(sessions[0].sessionPath).toBe(path)
  })

  it('groups by project -> branch and sorts sessions newest-first (case e)', () => {
    // Project A (git) with two branches; Project B (no git, falls back to cwd).
    const repoA = 'https://github.com/acme/a.git'
    const aMainOld = {
      type: 'session', version: 3, id: 'a-main-old', timestamp: '2026-01-01T08:00:00.000Z',
      cwd: 'C:/a', git: { repoUrl: repoA, branch: 'main' }
    }
    const aMainNew = {
      type: 'session', version: 3, id: 'a-main-new', timestamp: '2026-01-03T08:00:00.000Z',
      cwd: 'C:/a', git: { repoUrl: repoA, branch: 'main' }
    }
    const aSpike = {
      type: 'session', version: 3, id: 'a-spike', timestamp: '2026-01-02T08:00:00.000Z',
      cwd: 'C:/a', git: { repoUrl: repoA, branch: 'spike/x' }
    }
    const bNoGit = {
      type: 'session', version: 3, id: 'b-1', timestamp: '2026-01-04T08:00:00.000Z',
      cwd: 'C:/b'
    }
    writeSession('a-main-old.jsonl', JSON.stringify(aMainOld))
    writeSession('a-main-new.jsonl', JSON.stringify(aMainNew))
    writeSession('a-spike.jsonl', JSON.stringify(aSpike))
    writeSession('b-nogit.jsonl', JSON.stringify(bNoGit))

    const result = buildPiSessionsIndex(tempDir)
    // Deterministic alphabetical project ordering: 'C:/b' < 'h' in 'https://...'.
    expect(result.projects.map((p) => p.project)).toEqual(['C:/b', repoA])

    const projA = result.projects[1]
    // Branches sorted alphabetically; 'main' < 'spike/x'.
    expect(projA.branches.map((b) => b.branch)).toEqual(['main', 'spike/x'])
    // Newest-first within branch 'main'.
    expect(projA.branches[0].sessions.map((s) => s.sessionId)).toEqual([
      'a-main-new',
      'a-main-old'
    ])
    // Empty branch (spike/x) group exists with its one session.
    expect(projA.branches[1].sessions.map((s) => s.sessionId)).toEqual(['a-spike'])

    const projB = result.projects[0] // 'C:/b' sorts first alphabetically
    expect(projB.branches).toHaveLength(1)
    expect(projB.branches[0].branch).toBeNull()
    expect(projB.branches[0].sessions.map((s) => s.sessionId)).toEqual(['b-1'])
  })

  it('falls back to cwd as project when the git block is empty of url (branch still read)', () => {
    const header = {
      type: 'session', version: 3, id: 'git-branch-only', timestamp: '2026-01-01T00:00:00.000Z',
      cwd: 'C:/only-branch', git: { branch: 'wip' }
    }
    writeSession('only-branch.jsonl', JSON.stringify(header))
    const result = buildPiSessionsIndex(tempDir)
    const proj = result.projects.find((p) => p.project === 'C:/only-branch')
    expect(proj).toBeDefined()
    expect(proj!.branches.map((b) => b.branch)).toEqual(['wip'])
  })
})
