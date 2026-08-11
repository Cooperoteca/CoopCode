import type { execFileSync as ExecFileSyncFn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AiVaultSession } from '../../shared/ai-vault-types'
import type { PtyRegistration } from '../memory/pty-registry'
import Database from '../sqlite/sync-database'
import { scanAiVaultSessions } from './session-scanner'
import { listCrushSqliteSessions } from './session-scanner-crush-list'
import { parseCrushSession } from './session-scanner-crush-parser'
import { isolatedScanRoots } from './session-scanner-test-fixtures'
import type { SessionFileDiscovery } from './session-scanner-types'
import { buildCrushSqliteCandidatePath } from './session-scanner-crush-paths'
import {
  computeCrushRotationCandidates,
  isCrushProcessRunning,
  rotateCrushDatabase
} from './session-scanner-crush-rotation'

// Matches the schema session-scanner-crush-parser.ts reads; kept local to
// this file rather than shared, since session-scanner-crush.test.ts's own
// copy is not exported and this is the only other file that needs it.
function seedFixtureCrushDb(dbPath: string, sessionId: string): void {
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE goose_db_version (
      id INTEGER PRIMARY KEY,
      version_id INTEGER NOT NULL,
      is_applied INTEGER NOT NULL DEFAULT 1,
      tstamp DATETIME DEFAULT NULL
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      parent_session_id TEXT,
      title TEXT,
      message_count INTEGER DEFAULT 0,
      prompt_tokens INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      cost REAL DEFAULT 0,
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      summary_message_id TEXT,
      todos TEXT
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      parts TEXT NOT NULL DEFAULT '[]',
      model TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT,
      provider TEXT,
      is_summary_message INTEGER DEFAULT 0
    );
  `)
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO sessions (id, title, message_count, updated_at, created_at) VALUES (?, ?, 1, ?, ?)`
  ).run(sessionId, 'Fixture session', now, now)
  db.prepare(
    `INSERT INTO messages (id, session_id, role, parts, created_at, updated_at, finished_at)
     VALUES (?, ?, 'assistant', ?, ?, ?, ?)`
  ).run(
    `${sessionId}-msg-1`,
    sessionId,
    JSON.stringify([{ type: 'text', data: { text: 'hello' } }]),
    now,
    now,
    now
  )
  db.close()
}

let tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  tempDirs = []
})

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'orca-crush-rotation-'))
  tempDirs.push(dir)
  return dir
}

// Real layout is <projectRoot>/.crush/crush.db — fixtures must follow it, or
// they mask exactly the projectRoot bug this suite exists to catch.
function createCrushDbWithSiblings(projectRoot: string): string {
  const crushDir = join(projectRoot, '.crush')
  mkdirSync(crushDir, { recursive: true })
  const dbPath = join(crushDir, 'crush.db')
  writeFileSync(dbPath, 'fake-db-content')
  writeFileSync(`${dbPath}-wal`, 'fake-wal-content')
  writeFileSync(`${dbPath}-shm`, 'fake-shm-content')
  return dbPath
}

type MockExecFn = (command: string, args: readonly string[], options?: unknown) => string

function makeMockExecFn(args: {
  tasklistOutput?: string
  powershellOutput?: string
  pgrepOutput?: string
  cmdlineOutput?: string
  psOutput?: string
}): typeof ExecFileSyncFn {
  return ((command: string, _cmdArgs: readonly string[], _options?: unknown) => {
    if (command === 'tasklist') {
      return args.tasklistOutput ?? ''
    }
    if (command === 'powershell') {
      return args.powershellOutput ?? ''
    }
    if (command === 'pgrep') {
      return args.pgrepOutput ?? ''
    }
    if (command === 'cat') {
      return args.cmdlineOutput ?? ''
    }
    if (command === 'ps') {
      return args.psOutput ?? ''
    }
    return ''
  }) as typeof ExecFileSyncFn
}

describe('isCrushProcessRunning', () => {
  it('returns false when no crush process exists (Windows)', () => {
    const mockExec = makeMockExecFn({ tasklistOutput: '' })
    const result = isCrushProcessRunning('/some/project', {
      platform: 'win32',
      _execFn: mockExec
    })
    expect(result).toBe(false)
  })

  it('returns true when crush process references the project root (Windows)', () => {
    const projectRoot = 'C:\\Dev2026\\agentic-ide'
    const mockExec = makeMockExecFn({
      tasklistOutput: '"crush.exe","1234","Console","1","100,000 K"',
      powershellOutput: `crush --project ${projectRoot}`
    })
    const result = isCrushProcessRunning(projectRoot, {
      platform: 'win32',
      _execFn: mockExec
    })
    expect(result).toBe(true)
  })

  it('returns false when crush process does not reference the project root (Windows)', () => {
    const mockExec = makeMockExecFn({
      tasklistOutput: '"crush.exe","1234","Console","1","100,000 K"',
      powershellOutput: 'crush --project C:\\Other\\Project'
    })
    const result = isCrushProcessRunning('C:\\Dev2026\\agentic-ide', {
      platform: 'win32',
      _execFn: mockExec
    })
    expect(result).toBe(false)
  })

  it('returns false when no crush process exists (Linux)', () => {
    const mockExec = makeMockExecFn({ pgrepOutput: '' })
    const result = isCrushProcessRunning('/some/project', {
      platform: 'linux',
      _execFn: mockExec
    })
    expect(result).toBe(false)
  })

  it('returns true when crush process references the project root (Linux)', () => {
    // This test uses Unix-style paths which don't work correctly on Windows
    // due to path.resolve converting them. Skip on Windows.
    if (process.platform === 'win32') {
      return
    }
    const projectRoot = '/some/project'
    const mockExec = makeMockExecFn({
      pgrepOutput: '5678\n',
      cmdlineOutput: '/usr/bin/crush\x00--project\x00/some/project'
    })
    const result = isCrushProcessRunning(projectRoot, {
      platform: 'linux',
      _execFn: mockExec
    })
    expect(result).toBe(true)
  })

  it('falls back to ps when /proc is unavailable (macOS)', () => {
    // This test uses Unix-style paths which don't work correctly on Windows
    // due to path.resolve converting them. Skip on Windows.
    if (process.platform === 'win32') {
      return
    }
    const mockExec = makeMockExecFn({
      pgrepOutput: '9012',
      psOutput: 'crush --project /some/project'
    })
    // Simulate /proc failure by making cat throw
    const failingExec = ((command: string, cmdArgs: readonly string[], options?: unknown) => {
      if (command === 'cat') {
        throw new Error('ENOENT')
      }
      return (mockExec as unknown as MockExecFn)(command, cmdArgs, options)
      // execFileSync's overloads don't accept an `unknown` options bag, so the mock
      // is described by its own shape and widened once at the boundary.
    }) as unknown as typeof ExecFileSyncFn

    const result = isCrushProcessRunning('/some/project', {
      platform: 'darwin',
      _execFn: failingExec
    })
    expect(result).toBe(true)
  })
})

describe('isCrushProcessRunning via PTY registry', () => {
  function makePtyRegistration(overrides: Partial<PtyRegistration>): PtyRegistration {
    return {
      ptyId: 'pty-1',
      worktreeId: null,
      sessionId: null,
      paneKey: null,
      pid: null,
      ...overrides
    }
  }

  // Real Orca launches crush bare (`launchCmd: 'crush'`, no --project — see
  // shared/tui-agent-config.ts), so this is the path that actually detects a
  // running instance in production; the command-line scan above only catches
  // a manually-launched `crush --project <root>`.
  it('detects a running crush process via a matching worktreeId, ignoring command line', () => {
    const projectRoot = 'C:\\Dev2026\\worktrees\\CoopCode\\DEVX-999'
    const mockExec = makeMockExecFn({
      // No --project flag anywhere — matches Orca's real bare `crush` launch.
      tasklistOutput: '"crush.exe","4242","Console","1","PID eq 4242"'
    })
    const registrations = [
      makePtyRegistration({ worktreeId: `some-repo::${projectRoot}`, pid: 4242 })
    ]

    const result = isCrushProcessRunning(projectRoot, {
      platform: 'win32',
      _execFn: mockExec,
      _listRegisteredPtysFn: () => registrations
    })
    expect(result).toBe(true)
  })

  it('does not match a PTY registered for a different worktree', () => {
    const projectRoot = 'C:\\Dev2026\\worktrees\\CoopCode\\DEVX-999'
    const mockExec = makeMockExecFn({ tasklistOutput: '' })
    const registrations = [
      makePtyRegistration({ worktreeId: 'some-repo::C:\\Other\\Project', pid: 4242 })
    ]

    const result = isCrushProcessRunning(projectRoot, {
      platform: 'win32',
      _execFn: mockExec,
      _listRegisteredPtysFn: () => registrations
    })
    expect(result).toBe(false)
  })

  it('does not match when the registered pid is no longer alive', () => {
    const projectRoot = 'C:\\Dev2026\\worktrees\\CoopCode\\DEVX-999'
    // tasklist finds nothing for PID 4242 — process has exited.
    const mockExec = makeMockExecFn({ tasklistOutput: '' })
    const registrations = [
      makePtyRegistration({ worktreeId: `some-repo::${projectRoot}`, pid: 4242 })
    ]

    const result = isCrushProcessRunning(projectRoot, {
      platform: 'win32',
      _execFn: mockExec,
      _listRegisteredPtysFn: () => registrations
    })
    expect(result).toBe(false)
  })

  it('ignores registrations with a null pid or null worktreeId', () => {
    const projectRoot = 'C:\\Dev2026\\worktrees\\CoopCode\\DEVX-999'
    const mockExec = makeMockExecFn({ tasklistOutput: '' })
    const registrations = [
      makePtyRegistration({ worktreeId: `some-repo::${projectRoot}`, pid: null }),
      makePtyRegistration({ worktreeId: null, pid: 4242 })
    ]

    const result = isCrushProcessRunning(projectRoot, {
      platform: 'win32',
      _execFn: mockExec,
      _listRegisteredPtysFn: () => registrations
    })
    expect(result).toBe(false)
  })

  it('strips the folder-workspace instance suffix before comparing paths', () => {
    const projectRoot = 'C:\\Dev2026\\worktrees\\CoopCode\\DEVX-999'
    const mockExec = makeMockExecFn({ tasklistOutput: '"crush.exe","4242","Console","1","x"' })
    const registrations = [
      makePtyRegistration({
        worktreeId: `some-repo::${projectRoot}::workspace:11111111-1111-1111-1111-111111111111`,
        pid: 4242
      })
    ]

    const result = isCrushProcessRunning(projectRoot, {
      platform: 'win32',
      _execFn: mockExec,
      _listRegisteredPtysFn: () => registrations
    })
    expect(result).toBe(true)
  })
})

describe('rotateCrushDatabase', () => {
  it('returns null when crush.db does not exist', async () => {
    const projectRoot = createTempDir()
    const dbPath = join(projectRoot, '.crush', 'crush.db')
    const result = await rotateCrushDatabase(dbPath, projectRoot)
    expect(result.backupPath).toBeNull()
    expect(result.issues).toEqual([])
  })

  it('renames crush.db to timestamped backup and removes WAL/SHM', async () => {
    const projectRoot = createTempDir()
    const dbPath = createCrushDbWithSiblings(projectRoot)
    const fixedDate = new Date('2026-07-31T10:00:00.000Z')
    const mockExec = makeMockExecFn({ tasklistOutput: '' })

    const result = await rotateCrushDatabase(dbPath, projectRoot, {
      platform: 'win32',
      _execFn: mockExec,
      _now: () => fixedDate
    })

    expect(result.backupPath).toBe(`${dbPath}.2026-07-31T10-00-00-000Z.bak`)
    expect(existsSync(result.backupPath!)).toBe(true)
    expect(existsSync(dbPath)).toBe(false)
    expect(existsSync(`${dbPath}-wal`)).toBe(false)
    expect(existsSync(`${dbPath}-shm`)).toBe(false)
    expect(result.issues).toEqual([])
  })

  it('rotates even when WAL/SHM do not exist', async () => {
    const projectRoot = createTempDir()
    const crushDir = join(projectRoot, '.crush')
    mkdirSync(crushDir, { recursive: true })
    const dbPath = join(crushDir, 'crush.db')
    writeFileSync(dbPath, 'fake-db-content')
    const mockExec = makeMockExecFn({ tasklistOutput: '' })

    const result = await rotateCrushDatabase(dbPath, projectRoot, {
      platform: 'win32',
      _execFn: mockExec
    })

    expect(result.backupPath).not.toBeNull()
    expect(existsSync(result.backupPath!)).toBe(true)
    expect(existsSync(dbPath)).toBe(false)
    expect(result.issues).toEqual([])
  })

  it('skips rotation and returns issue when Crush is running', async () => {
    const projectRoot = createTempDir()
    const dbPath = createCrushDbWithSiblings(projectRoot)
    // The process command line references projectRoot (the --project value),
    // not the .crush/ subdirectory crush.db actually lives in.
    const mockExec = makeMockExecFn({
      tasklistOutput: '"crush.exe","1234","Console","1","100,000 K"',
      powershellOutput: `crush --project ${projectRoot}`
    })

    const result = await rotateCrushDatabase(dbPath, projectRoot, {
      platform: 'win32',
      _execFn: mockExec
    })

    expect(result.backupPath).toBeNull()
    expect(existsSync(dbPath)).toBe(true)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0].agent).toBe('crush')
    expect(result.issues[0].message).toContain('still running')
  })

  it('leaves diagnostic issue on partial failure (WAL delete fails)', async () => {
    const projectRoot = createTempDir()
    const dbPath = createCrushDbWithSiblings(projectRoot)
    const mockExec = makeMockExecFn({ tasklistOutput: '' })
    const walPath = `${dbPath}-wal`

    const result = await rotateCrushDatabase(dbPath, projectRoot, {
      platform: 'win32',
      _execFn: mockExec,
      _unlinkFn: async (path) => {
        if (path === walPath) {
          throw new Error('EBUSY: resource busy or locked')
        }
        return unlink(path)
      }
    })

    // Rename and SHM cleanup still succeed; only the WAL delete failed.
    expect(result.backupPath).not.toBeNull()
    expect(existsSync(dbPath)).toBe(false)
    expect(existsSync(walPath)).toBe(true)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0].path).toBe(walPath)
    expect(result.issues[0].message).toContain('Failed to delete WAL file')
  })

  it('skips rotation when the PTY registry shows Crush running, even with a bare command line', async () => {
    const projectRoot = createTempDir()
    const dbPath = createCrushDbWithSiblings(projectRoot)
    // Command line has no --project flag — matches Orca's real launch, and
    // would not be caught by the command-line scan alone.
    const mockExec = makeMockExecFn({ tasklistOutput: '"crush.exe","4242","Console","1","x"' })

    const result = await rotateCrushDatabase(dbPath, projectRoot, {
      platform: 'win32',
      _execFn: mockExec,
      _listRegisteredPtysFn: () => [
        { ptyId: 'pty-1', worktreeId: `some-repo::${projectRoot}`, sessionId: null, paneKey: null, pid: 4242 }
      ]
    })

    expect(result.backupPath).toBeNull()
    expect(existsSync(dbPath)).toBe(true)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0].message).toContain('still running')
  })
})

describe('computeCrushRotationCandidates', () => {
  function makeSession(sessionId: string): AiVaultSession {
    return {
      id: sessionId,
      executionHostId: 'local',
      agent: 'crush',
      sessionId,
      title: 'Test Session',
      cwd: null,
      branch: null,
      model: null,
      filePath: `/fake/path/crush.db#${sessionId}`,
      codexHome: null,
      createdAt: '2026-07-31T00:00:00.000Z',
      updatedAt: '2026-07-31T00:00:00.000Z',
      modifiedAt: '2026-07-31T00:00:00.000Z',
      messageCount: 5,
      totalTokens: 1000,
      previewMessages: [],
      queuedMessageCount: 0,
      subagentTranscriptCount: 0,
      resumeCommand: 'crush resume',
      subagent: null
    }
  }

  function makeDiscovery(dbPath: string, sessionIds: string[]): SessionFileDiscovery {
    return {
      agent: 'crush',
      rootDir: dbPath,
      files: sessionIds.map((id) => ({
        path: buildCrushSqliteCandidatePath(dbPath, id),
        mtimeMs: Date.now(),
        modifiedAt: new Date().toISOString()
      }))
    }
  }

  // Fixed instant every test treats as "now the scan started" and a DB mtime
  // safely before it, so the recency check passes unless a test overrides one.
  const scanStartedAtMs = Date.parse('2026-07-31T12:00:00.000Z')
  const dbWrittenBeforeScan = () => ({ mtimeMs: scanStartedAtMs - 60_000 })

  it('returns dbPath/projectRoot when all discovered sessions are in scanned sessions', () => {
    const dbPath = '/fake/project/.crush/crush.db'
    const sessions = [makeSession('ses_1'), makeSession('ses_2')]
    const discoveries = [makeDiscovery(dbPath, ['ses_1', 'ses_2'])]

    const candidates = computeCrushRotationCandidates(sessions, discoveries, {
      asOfMs: scanStartedAtMs,
      _statFn: dbWrittenBeforeScan
    })
    expect(candidates).toEqual([{ dbPath, projectRoot: '/fake/project' }])
  })

  it('returns empty when a discovered session is missing from scanned sessions', () => {
    const dbPath = '/fake/project/.crush/crush.db'
    const sessions = [makeSession('ses_1')]
    const discoveries = [makeDiscovery(dbPath, ['ses_1', 'ses_2'])]

    const candidates = computeCrushRotationCandidates(sessions, discoveries, {
      asOfMs: scanStartedAtMs,
      _statFn: dbWrittenBeforeScan
    })
    expect(candidates).toEqual([])
  })

  it('ignores non-crush discoveries', () => {
    const dbPath = '/fake/project/.crush/crush.db'
    const sessions = [makeSession('ses_1')]
    const discoveries: SessionFileDiscovery[] = [
      { agent: 'claude', rootDir: '/fake/claude', files: [] },
      makeDiscovery(dbPath, ['ses_1'])
    ]

    const candidates = computeCrushRotationCandidates(sessions, discoveries, {
      asOfMs: scanStartedAtMs,
      _statFn: dbWrittenBeforeScan
    })
    expect(candidates).toEqual([{ dbPath, projectRoot: '/fake/project' }])
  })

  it('returns empty when discovery has no files', () => {
    const dbPath = '/fake/project/.crush/crush.db'
    const sessions = [makeSession('ses_1')]
    const discoveries: SessionFileDiscovery[] = [
      { agent: 'crush', rootDir: dbPath, files: [] }
    ]

    const candidates = computeCrushRotationCandidates(sessions, discoveries, {
      asOfMs: scanStartedAtMs,
      _statFn: dbWrittenBeforeScan
    })
    expect(candidates).toEqual([])
  })

  it('handles multiple crush databases independently', () => {
    const dbPath1 = '/fake/project1/.crush/crush.db'
    const dbPath2 = '/fake/project2/.crush/crush.db'
    const sessions = [makeSession('ses_1'), makeSession('ses_2')]
    const discoveries = [
      makeDiscovery(dbPath1, ['ses_1']),
      makeDiscovery(dbPath2, ['ses_2', 'ses_3'])
    ]

    const candidates = computeCrushRotationCandidates(sessions, discoveries, {
      asOfMs: scanStartedAtMs,
      _statFn: dbWrittenBeforeScan
    })
    expect(candidates).toEqual([{ dbPath: dbPath1, projectRoot: '/fake/project1' }])
  })

  it('excludes a db written to during or after the scan, even with matching sessionIds', () => {
    const dbPath = '/fake/project/.crush/crush.db'
    const sessions = [makeSession('ses_1')]
    const discoveries = [makeDiscovery(dbPath, ['ses_1'])]

    const candidates = computeCrushRotationCandidates(sessions, discoveries, {
      asOfMs: scanStartedAtMs,
      _statFn: () => ({ mtimeMs: scanStartedAtMs + 1 })
    })
    expect(candidates).toEqual([])
  })

  it('excludes a db whose mtime cannot be read', () => {
    const dbPath = '/fake/project/.crush/crush.db'
    const sessions = [makeSession('ses_1')]
    const discoveries = [makeDiscovery(dbPath, ['ses_1'])]

    const candidates = computeCrushRotationCandidates(sessions, discoveries, {
      asOfMs: scanStartedAtMs,
      _statFn: () => {
        throw new Error('ENOENT')
      }
    })
    expect(candidates).toEqual([])
  })
})

describe('rotation concurrency', () => {
  it('skips rotation with issue when Crush holds the database open', async () => {
    const projectRoot = createTempDir()
    const dbPath = createCrushDbWithSiblings(projectRoot)
    const mockExec = makeMockExecFn({
      tasklistOutput: '"crush.exe","1234","Console","1","100,000 K"',
      powershellOutput: `crush --project ${projectRoot}`
    })

    const result = await rotateCrushDatabase(dbPath, projectRoot, {
      platform: 'win32',
      _execFn: mockExec
    })

    expect(result.backupPath).toBeNull()
    expect(existsSync(dbPath)).toBe(true)
    expect(existsSync(`${dbPath}-wal`)).toBe(true)
    expect(existsSync(`${dbPath}-shm`)).toBe(true)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0].agent).toBe('crush')
    expect(result.issues[0].path).toBe(dbPath)
  })
})

describe('scanAiVaultSessions rotateCrushAfterScan wiring', () => {
  it('rotates crush.db at the end of a successful scan when the flag is set', async () => {
    const projectRoot = createTempDir()
    const crushDir = join(projectRoot, '.crush')
    mkdirSync(crushDir, { recursive: true })
    const dbPath = join(crushDir, 'crush.db')
    seedFixtureCrushDb(dbPath, 'fixture-session-1')

    const result = await scanAiVaultSessions({
      ...isolatedScanRoots(createTempDir()),
      crushDbPaths: [dbPath],
      crushListFn: listCrushSqliteSessions,
      crushParseFn: parseCrushSession,
      rotateCrushAfterScan: true,
      limit: 50
    })

    expect(
      result.sessions.some(
        (session) => session.agent === 'crush' && session.sessionId === 'fixture-session-1'
      )
    ).toBe(true)
    expect(existsSync(dbPath)).toBe(false)
    const backups = readdirSync(crushDir).filter(
      (name) => name.startsWith('crush.db.') && name.endsWith('.bak')
    )
    expect(backups).toHaveLength(1)
  })

  it('does not rotate crush.db when the flag is not set', async () => {
    const projectRoot = createTempDir()
    const crushDir = join(projectRoot, '.crush')
    mkdirSync(crushDir, { recursive: true })
    const dbPath = join(crushDir, 'crush.db')
    seedFixtureCrushDb(dbPath, 'fixture-session-2')

    const result = await scanAiVaultSessions({
      ...isolatedScanRoots(createTempDir()),
      crushDbPaths: [dbPath],
      crushListFn: listCrushSqliteSessions,
      crushParseFn: parseCrushSession,
      limit: 50
    })

    expect(result.sessions.some((session) => session.agent === 'crush')).toBe(true)
    expect(existsSync(dbPath)).toBe(true)
  })
})
