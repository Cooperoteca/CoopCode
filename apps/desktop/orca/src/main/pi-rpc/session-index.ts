import { closeSync, openSync, readSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type {
  PiSessionBranchGroup,
  PiSessionProjectGroup,
  PiSessionsListResult,
  PiSessionSummary
} from '../../shared/pi-rpc'
import { parseJsonLine } from './jsonl'

/**
 * Session-history index for the pi spike, read from `<homedir>/.prime/agent/sessions`.
 *
 * Session files are large (multi-megabyte) JSONL transcripts, so ONLY the first
 * line of each file is read: it is the JSON header carrying
 *  `{ "type":"session", "version":3, "id":"...", "timestamp":"...", "cwd":"...", "git":{...} }`.
 * Reading the whole file would stall the main process, so all reads are bounded
 * to the first LF-terminated line.
 *
 * Grouping contract (see PiSessionSummary / PiSessionBranchGroup /
 * PiSessionProjectGroup in src/shared/pi-rpc.ts):
 *  - project = `git.repoUrl`, falling back to `cwd` when there is no git block.
 *  - branch  = `git.branch`, `null` when there is no git block.
 *  - sessions within a branch are ordered by `timestamp` DESC.
 *
 * Ordering choice (documented): projects are sorted alphabetically by project id,
 * branches alphabetically (a non-git branch whose id is `null` sorts first, as it
 * is rendered as the folder's base branch), and sessions newest-first by ISO
 * timestamp with a deterministic tie-break on session id. Parsing is defensive:
 * empty files, unparseable first lines and files without a usable id are skipped,
 * never thrown.
 */

/** Upper bound on the header line we ever read. Real headers are a few hundred
 * bytes; this cap guarantees a corrupt/binary first line cannot balloon memory. */
const MAX_HEADER_BYTES = 64 * 1024

type ParsedSessionHeader = {
  id: string
  timestamp: string
  cwd: string
  git: { repoUrl: string | null; branch: string | null } | null
}

/** Parsed header plus the derived grouping keys for one session file. */
type ParsedSession = {
  summary: PiSessionSummary
  project: string
  branch: string | null
}

/** Reads only the first LF-terminated line of a file. Returns null on any I/O
 * error (missing file, permission denied, directory). */
function readFirstLine(filePath: string): string | null {
  let fd: number | undefined
  try {
    fd = openSync(filePath, 'r')
    const buffer = Buffer.alloc(MAX_HEADER_BYTES)
    const bytesRead = readSync(fd, buffer, 0, MAX_HEADER_BYTES, 0)
    const newline = buffer.indexOf(10, 0) // LF
    const end = newline === -1 ? bytesRead : newline
    return buffer.toString('utf8', 0, end)
  } catch {
    return null
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        // best-effort close; ignore
      }
    }
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** Normalizes a parsed first line into a usable header, or null to skip it. */
function normalizeHeader(parsed: unknown): ParsedSessionHeader | null {
  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }
  const header = parsed as Record<string, unknown>
  const id = asString(header.id)
  if (id === null || id === '') {
    return null
  }
  const timestamp = asString(header.timestamp) ?? ''
  const cwd = asString(header.cwd) ?? ''
  let git: ParsedSessionHeader['git'] = null
  const gitRaw = header.git
  if (typeof gitRaw === 'object' && gitRaw !== null) {
    const gitObj = gitRaw as Record<string, unknown>
    const repoUrl = asString(gitObj.repoUrl)
    const branch = asString(gitObj.branch)
    // A git block that carries neither repoUrl nor branch contributes nothing;
    // treat it as absent so the project falls back to cwd and branch to null.
    if (repoUrl !== null || branch !== null) {
      git = { repoUrl, branch }
    }
  }
  return { id, timestamp, cwd, git }
}

/** Parses one session file's header into summary + grouping keys, or null. */
function parseSessionFile(sessionPath: string): ParsedSession | null {
  const firstLine = readFirstLine(sessionPath)
  if (firstLine === null) {
    return null
  }
  const parsed = parseJsonLine(firstLine)
  if (parsed === undefined) {
    return null
  }
  const header = normalizeHeader(parsed)
  if (header === null) {
    return null
  }
  const project = header.git?.repoUrl ?? header.cwd
  const branch = header.git?.branch ?? null
  return {
    summary: {
      sessionPath,
      sessionId: header.id,
      timestamp: header.timestamp,
      cwd: header.cwd
    },
    project,
    branch
  }
}

/** Builds the grouped, deterministic session index for a sessions directory.
 *  Never throws: any read/parse failure collapses to an empty or partial index. */
export function buildPiSessionsIndex(sessionsDir: string): PiSessionsListResult {
  let entries
  try {
    entries = readdirSync(sessionsDir, { withFileTypes: true })
  } catch {
    return { projects: [] }
  }

  const byProject = new Map<string, Map<string | null, PiSessionSummary[]>>()
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.jsonl')) {
      continue
    }
    const sessionPath = join(sessionsDir, entry.name)
    const parsed = parseSessionFile(sessionPath)
    if (parsed === null) {
      continue
    }
    let branches = byProject.get(parsed.project)
    if (branches === undefined) {
      branches = new Map<string | null, PiSessionSummary[]>()
      byProject.set(parsed.project, branches)
    }
    const sessions = branches.get(parsed.branch)
    if (sessions === undefined) {
      branches.set(parsed.branch, [parsed.summary])
    } else {
      sessions.push(parsed.summary)
    }
  }

  const projects: PiSessionProjectGroup[] = []
  for (const project of [...byProject.keys()].sort()) {
    const branches = byProject.get(project)!
    const branchGroups: PiSessionBranchGroup[] = []
    for (const branch of [...branches.keys()].sort((a, b) =>
      (a ?? '').localeCompare(b ?? '')
    )) {
      const sessions = branches.get(branch)!
      // Newest first by ISO timestamp; deterministic tie-break on session id.
      sessions.sort((a, b) =>
        b.timestamp.localeCompare(a.timestamp) || a.sessionId.localeCompare(b.sessionId)
      )
      branchGroups.push({ branch, sessions })
    }
    projects.push({ project, branches: branchGroups })
  }

  return { projects }
}
