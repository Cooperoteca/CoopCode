// Why: pure, side-effect-free view-model for the pi session history tab. The main
// process already groups sessions by project/branch and orders them newest-first
// (see src/shared/pi-rpc.ts), so this module only shapes that result for display:
// formatting the timestamp, deriving a short id, translating the null-branch
// bucket into a human label, and counting sessions for the empty state. Keeping
// this logic out of the component makes it trivially testable.
//
// The frame correlation for `switch_session` response frames is also pure: we
// classify raw RPC payloads into a narrow 'done' | 'cancelled' | 'error' result
// so the component never reaches into the loosely-typed frame payload.

import type { PiSessionsListResult } from '../../../../shared/pi-rpc'

export type PiHistoryFormatters = {
  /** Formats an ISO timestamp into a display label. Empty string when unparseable. */
  formatTime: (iso: string) => string
  /** Derives the short identifier shown next to the timestamp. */
  shortId: (sessionId: string) => string
}

export type PiHistorySessionView = {
  /** Absolute path of the .jsonl file — the `switch_session` target. */
  sessionPath: string
  /** Human label (formatted date/time). Empty when the timestamp is missing/unparseable. */
  timeLabel: string
  /** Short derived id shown as the session identifier. */
  shortId: string
  /** Working directory from the session header; may be empty. */
  cwd: string
}

export type PiHistoryBranchView = {
  /** Raw branch; null for the "no git block" bucket. */
  branch: string | null
  /** Display label (translated "No branch" for the null bucket). */
  branchLabel: string
  sessions: PiHistorySessionView[]
}

export type PiHistoryProjectView = {
  project: string
  branches: PiHistoryBranchView[]
}

export type PiHistoryViewModel = {
  projects: PiHistoryProjectView[]
  /** Total number of sessions across all projects/branches. */
  sessionCount: number
  /** False when there is nothing to show (no projects or all buckets empty). */
  hasSessions: boolean
}

export const defaultPiHistoryFormatters: PiHistoryFormatters = {
  formatTime: (iso: string): string => {
    if (!iso) {
      return ''
    }
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) {
      return ''
    }
    return date.toLocaleString()
  },
  shortId: (sessionId: string): string => sessionId.slice(0, 8)
}

export const DEFAULT_EMPTY_BRANCH_LABEL = 'No branch'

// Why: copy the raw input rather than re-group it. The main already guarantees
// project -> branch (newest first). We only decorate for display.
export function buildPiHistoryViewModel(
  result: PiSessionsListResult | null | undefined,
  formatters: PiHistoryFormatters = defaultPiHistoryFormatters,
  emptyBranchLabel: string = DEFAULT_EMPTY_BRANCH_LABEL
): PiHistoryViewModel {
  const projects: PiHistoryProjectView[] = []
  let sessionCount = 0

  for (const group of result?.projects ?? []) {
    const branches: PiHistoryBranchView[] = []
    for (const branchGroup of group.branches ?? []) {
      branches.push({
        branch: branchGroup.branch,
        branchLabel: branchGroup.branch ?? emptyBranchLabel,
        sessions: (branchGroup.sessions ?? []).map((session) => {
          sessionCount += 1
          return {
            sessionPath: session.sessionPath,
            timeLabel: formatters.formatTime(session.timestamp),
            shortId: formatters.shortId(session.sessionId),
            cwd: session.cwd
          }
        })
      })
    }
    projects.push({ project: group.project, branches })
  }

  return {
    projects,
    sessionCount,
    hasSessions: sessionCount > 0
  }
}

/** Classified outcome of a `switch_session` response frame. */
export type PiSwitchResultKind = 'done' | 'cancelled' | 'error'

/** A parsed switch_session response frame that matches the shell we care about. */
export type PiSwitchFrameMatch = {
  /** The echo id provided on the original send command, when present. */
  id: string | undefined
  kind: PiSwitchResultKind
}

/**
 * Classifies a raw RPC frame payload. Returns null for anything that is not a
 * `switch_session` response (so the caller can ignore unrelated frames).
 * `success:false` (or a thrown/absent success) maps to 'error'; a cancelled
 * switch maps to 'cancelled' (a normal, non-error outcome); everything else is
 * 'done'.
 */
export function parsePiSwitchResponse(payload: unknown): PiSwitchFrameMatch | null {
  if (typeof payload !== 'object' || payload === null) {
    return null
  }
  const p = payload as Record<string, unknown>
  if (p.type !== 'response' || p.command !== 'switch_session') {
    return null
  }
  const id = typeof p.id === 'string' ? p.id : undefined
  let kind: PiSwitchResultKind
  if (p.success !== true) {
    kind = 'error'
  } else {
    const data = (typeof p.data === 'object' && p.data !== null ? p.data : {}) as Record<
      string,
      unknown
    >
    kind = data.cancelled === true ? 'cancelled' : 'done'
  }
  return { id, kind }
}
