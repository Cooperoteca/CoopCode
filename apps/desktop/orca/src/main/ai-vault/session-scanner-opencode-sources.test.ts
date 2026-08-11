import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { scanAiVaultSessions } from './session-scanner'
import Database from '../sqlite/sync-database'

// Why: inline the worker so the SQLite discovery runs synchronously in the
// test process — no need for a real worker thread in unit tests.
vi.mock('./session-scanner-opencode-sqlite-worker-spawn', async () => {
  const [{ listOpenCodeSqliteSessions }, { parseOpenCodeSqliteSession }] = await Promise.all([
    import('./session-scanner-opencode-sqlite-list'),
    import('./session-scanner-opencode-sqlite')
  ])
  return {
    listOpenCodeSqliteSessionsViaWorker: listOpenCodeSqliteSessions,
    parseOpenCodeSqliteSessionViaWorker: parseOpenCodeSqliteSession
  }
})

let tempRoots: string[] = []
let tempDbDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })))
  for (const dir of tempDbDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  tempRoots = []
  tempDbDirs = []
})

function isolatedScanRoots(root: string) {
  return {
    claudeProjectsDir: join(root, 'claude-projects'),
    codexSessionsDir: join(root, 'codex-sessions'),
    geminiSessionsDir: join(root, 'gemini-sessions'),
    antigravityBrainDir: join(root, 'antigravity-brain'),
    copilotSessionsDir: join(root, 'copilot-sessions'),
    cursorProjectsDir: join(root, 'cursor-projects'),
    opencodeStorageDir: join(root, 'opencode-storage'),
    opencodeDbPaths: [] as readonly string[],
    grokSessionsDir: join(root, 'grok-sessions'),
    devinTranscriptsDir: join(root, 'devin-transcripts'),
    hermesSessionsDir: join(root, 'hermes-sessions'),
    rovoSessionsDir: join(root, 'rovo-sessions'),
    openclawStateDir: join(root, 'openclaw-state'),
    openclawLegacyStateDir: join(root, 'openclaw-legacy-state'),
    piSessionsDir: join(root, 'pi-sessions'),
    droidSessionsDir: join(root, 'droid-sessions'),
    droidProjectsDir: join(root, 'droid-projects'),
    kimiSessionsDir: join(root, 'kimi-sessions'),
    ompSessionsDir: join(root, 'omp-sessions')
  }
}

function applyOpenCodeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      parent_id TEXT,
      slug TEXT NOT NULL,
      directory TEXT NOT NULL,
      title TEXT NOT NULL,
      version TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      time_archived INTEGER,
      model TEXT,
      agent TEXT,
      cost REAL DEFAULT 0 NOT NULL,
      tokens_input INTEGER DEFAULT 0 NOT NULL,
      tokens_output INTEGER DEFAULT 0 NOT NULL,
      tokens_reasoning INTEGER DEFAULT 0 NOT NULL,
      tokens_cache_read INTEGER DEFAULT 0 NOT NULL,
      tokens_cache_write INTEGER DEFAULT 0 NOT NULL,
      metadata TEXT
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `)
}

describe('scanAiVaultSessions — OpenCode sources with no storage/ subdirectory', () => {
  it('discovers SQLite sessions when db files exist directly under the data dir with no storage/ present (DEVX-007 main layout)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-ai-vault-no-storage-'))
    tempRoots.push(root)
    const roots = isolatedScanRoots(root)

    // Simulate the Windows ARM64 host layout: opencode*.db files directly
    // in the data directory, no storage/ subdirectory.
    const opencodeDataDir = join(root, 'opencode-data')
    await mkdir(opencodeDataDir, { recursive: true })
    // Explicitly do NOT create storage/ — the test asserts discovery still works.

    const dbPath = join(opencodeDataDir, 'opencode.db')
    const db = new Database(dbPath)
    applyOpenCodeSchema(db)
    db.prepare(
      `INSERT INTO session (id, project_id, slug, directory, title, version,
         time_created, time_updated, model, agent, cost,
         tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write)
       VALUES ('no-storage-session', 'proj-1', 'slug', '/tmp/no-storage',
         'No storage dir session', '1.0.0',
         1777634010000, 1777634011000, NULL, 'build', 0,
         10, 20, 5, 3, 0)`
    ).run()
    db.close()

    const devDbPath = join(opencodeDataDir, 'opencode-dev.db')
    const devDb = new Database(devDbPath)
    applyOpenCodeSchema(devDb)
    devDb
      .prepare(
        `INSERT INTO session (id, project_id, slug, directory, title, version,
         time_created, time_updated, model, agent, cost,
         tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write)
       VALUES ('dev-db-session', 'proj-1', 'slug-dev', '/tmp/no-storage-dev',
         'Dev DB session', '1.0.0',
         1777634020000, 1777634021000, NULL, 'build', 0,
         5, 7, 0, 0, 0)`
      )
      .run()
    devDb.close()

    const result = await scanAiVaultSessions({
      ...roots,
      opencodeStorageDir: join(opencodeDataDir, 'storage'),
      opencodeDbPaths: undefined,
      platform: 'win32',
      limit: 50
    })

    const opencodeSessions = result.sessions.filter((s) => s.agent === 'opencode')
    const sessionIds = opencodeSessions.map((s) => s.sessionId).sort()

    expect(sessionIds).toContain('no-storage-session')
    expect(sessionIds).toContain('dev-db-session')

    const noStorage = opencodeSessions.find((s) => s.sessionId === 'no-storage-session')
    expect(noStorage).toBeDefined()
    expect(noStorage!.title).toBe('No storage dir session')
    expect(noStorage!.filePath).toBe(dbPath)
    expect(noStorage!.totalTokens).toBe(35)
  })

  it('still discovers legacy file sessions when storage/ exists (regression)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-ai-vault-with-storage-'))
    tempRoots.push(root)
    const roots = isolatedScanRoots(root)

    // Legacy layout: storage/session/ with JSON files
    await mkdir(join(roots.opencodeStorageDir, 'session', 'project'), { recursive: true })
    await mkdir(join(roots.opencodeStorageDir, 'message', 'legacy-session'), { recursive: true })
    await writeFile(
      join(roots.opencodeStorageDir, 'session', 'project', 'legacy-session.json'),
      JSON.stringify({
        id: 'legacy-session',
        directory: '/tmp/legacy',
        title: 'Legacy file session',
        time: { created: 1_777_634_000_000, updated: 1_777_634_001_000 }
      })
    )
    await writeFile(
      join(roots.opencodeStorageDir, 'message', 'legacy-session', 'msg_1.json'),
      JSON.stringify({
        role: 'user',
        summary: { title: 'Legacy file session' },
        time: { created: 1_777_634_000_000 },
        tokens: { input: 5, output: 2 }
      })
    )

    const result = await scanAiVaultSessions({
      ...roots,
      platform: 'darwin',
      limit: 50
    })

    const legacySession = result.sessions.find((s) => s.sessionId === 'legacy-session')
    expect(legacySession).toBeDefined()
    expect(legacySession!.agent).toBe('opencode')
    expect(legacySession!.title).toBe('Legacy file session')
  })

  it('deduplicates by sessionId when the same id appears in both legacy JSON and SQLite', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-ai-vault-sources-dedup-'))
    tempRoots.push(root)
    const roots = isolatedScanRoots(root)

    // Legacy file session under storage/session/
    await mkdir(join(roots.opencodeStorageDir, 'session', 'project'), { recursive: true })
    await mkdir(join(roots.opencodeStorageDir, 'message', 'dup-session'), { recursive: true })
    await writeFile(
      join(roots.opencodeStorageDir, 'session', 'project', 'dup-session.json'),
      JSON.stringify({
        id: 'dup-session',
        directory: '/tmp/legacy',
        title: 'Legacy duplicate',
        time: { created: 1_777_634_000_000, updated: 1_777_634_001_000 }
      })
    )
    await writeFile(
      join(roots.opencodeStorageDir, 'message', 'dup-session', 'msg_1.json'),
      JSON.stringify({
        role: 'user',
        summary: { title: 'Legacy duplicate' },
        time: { created: 1_777_634_000_000 },
        tokens: { input: 5, output: 2 }
      })
    )

    // SQLite session with same sessionId — SQLite should win
    const opencodeDataDir = join(root, 'opencode-data')
    await mkdir(opencodeDataDir, { recursive: true })
    const dbPath = join(opencodeDataDir, 'opencode.db')
    const db = new Database(dbPath)
    applyOpenCodeSchema(db)
    db.prepare(
      `INSERT INTO session (id, project_id, slug, directory, title, version,
         time_created, time_updated, model, agent, cost,
         tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write)
       VALUES ('dup-session', 'proj-1', 'slug', '/tmp/sqlite', 'SQLite wins', '1.0.0',
         1777634010000, 1777634011000, NULL, 'build', 0,
         100, 40, 10, 5, 0)`
    ).run()
    db.close()

    const result = await scanAiVaultSessions({
      ...roots,
      opencodeStorageDir: join(opencodeDataDir, 'storage'),
      opencodeDbPaths: undefined,
      platform: 'darwin',
      limit: 50
    })

    const opencodeSessions = result.sessions.filter((s) => s.agent === 'opencode')
    const dupEntries = opencodeSessions.filter((s) => s.sessionId === 'dup-session')
    expect(dupEntries).toHaveLength(1)
    expect(dupEntries[0].title).toBe('SQLite wins')
    expect(dupEntries[0].filePath).toBe(dbPath)
    expect(dupEntries[0].totalTokens).toBe(150)
  })
})
