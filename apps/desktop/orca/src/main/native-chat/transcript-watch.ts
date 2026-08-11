import { watch } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, dirname, extname } from 'node:path'
import type { NativeChatMessage } from '../../shared/native-chat-types'
import { resolveSessionFilePath } from './session-file-resolver'
import { installTranscriptWatcher } from './transcript-watch-engine'
import type {
  NativeChatTranscriptSubscription,
  SubscribeNativeChatTranscriptArgs
} from './transcript-watch-contract'
import { nativeChatLineDecoderForAgent } from './transcript-tail-reader'

export { readNativeChatTranscriptTail } from './transcript-tail-reader'
export { getActiveNativeChatWatcherCount } from './transcript-watch-engine'
export type {
  NativeChatTranscriptSubscription,
  SubscribeNativeChatTranscriptArgs
} from './transcript-watch-contract'

/** One resolve+install attempt. Returns null while the transcript file itself
 *  is unresolved; native-watch failure degrades to reconciliation-only mode. */
async function attemptInstall(
  args: SubscribeNativeChatTranscriptArgs,
  decode: (line: string, fallbackId: string) => NativeChatMessage | null
): Promise<NativeChatTranscriptSubscription | null> {
  const filePath = args.filePath ?? (await resolveSessionFilePath(args.agent, args.sessionId, args))
  if (!filePath) {
    return null
  }
  const pathStat = await stat(filePath).catch(() => null)
  if (pathStat?.isDirectory()) {
    // Why: a directory sitting at the transcript path is a persistent read
    // error (every tail read throws EISDIR), not a not-yet-flushed session.
    // On POSIX the tail reader reaches EISDIR and the engine's error frame
    // fires; on Windows stat().size of a directory is 0, so the reader
    // short-circuits into an empty "success" frame and the degraded-UX
    // message is silently dropped. Detect it up front.
    return installDirectoryErrorSubscription(filePath, decode, args)
  }
  return installTranscriptWatcher(filePath, decode, args)
}

/**
 * Subscription for a transcript path that stat-succeeds but is a directory:
 * emits the friendly error snapshot once and keeps a native watcher bound so
 * the subscription still recovers (real snapshot, same subscription) once a
 * readable transcript replaces the directory.
 */
function installDirectoryErrorSubscription(
  filePath: string,
  decode: (line: string, fallbackId: string) => NativeChatMessage | null,
  args: SubscribeNativeChatTranscriptArgs
): NativeChatTranscriptSubscription {
  const watchedName = basename(filePath)
  const { onInitialSnapshot } = args
  let closed = false
  let engine: NativeChatTranscriptSubscription | null = null
  let watcher: ReturnType<typeof watch> | null = null

  if (onInitialSnapshot) {
    onInitialSnapshot([], false, 0, 'Transcript unavailable')
  }

  function installEngine(): void {
    if (closed || engine) {
      return
    }
    void installTranscriptWatcher(filePath, decode, args).then((subscription) => {
      if (closed) {
        subscription?.unsubscribe()
        return
      }
      if (subscription) {
        engine = subscription
        watcher?.close()
        watcher = null
      }
    })
  }

  try {
    // Why: watch the parent so a directory->file replacement (rename) is
    // visible, mirroring transcript-native-watcher's strategy.
    watcher = watch(dirname(filePath), (_event, changedName) => {
      if (changedName !== null && changedName.toString() !== watchedName) {
        return
      }
      void stat(filePath)
        .then((value) => {
          if (!value.isDirectory()) {
            installEngine()
          }
        })
        .catch(() => {
          // Path still missing/unreachable — keep watching for the replacement.
        })
    })
    watcher.unref?.()
    watcher.on('error', () => {
      // Keep the error frame; a later event or reconciliation attempt can
      // still install the engine once the path becomes readable.
    })
  } catch {
    // Best-effort watch: the error frame is already out; recovery is limited
    // to whatever fs.watch provides when the path becomes watchable again.
  }

  return {
    watching: true,
    unsubscribe: () => {
      if (closed) {
        return
      }
      closed = true
      watcher?.close()
      watcher = null
      engine?.unsubscribe()
      engine = null
    }
  }
}

// Why: Claude Code (and other agents) can take from ~3s to minutes to flush a
// brand-new session's first JSONL line (#8401) — resolveSessionFilePath
// genuinely has nothing to find yet. Poll for it instead of going deaf. Exact
// hook paths are probed on every retry; the recursive
// session-id fallback runs less often because a large Claude tree is expensive.
const INITIAL_RESOLVE_POLL_MS = 500
const MAX_RESOLVE_POLL_MS = 5_000
const FALLBACK_RESOLVE_POLL_MS = 5_000

function exactTranscriptPath(args: SubscribeNativeChatTranscriptArgs): string | null {
  const path = args.transcriptPath?.trim()
  return path && extname(path) === '.jsonl' ? path : null
}

/**
 * Background retry loop for a transcript that hasn't been resolvable yet.
 * Returns a subscription immediately (per subscribeNativeChatTranscript's
 * contract); the loop keeps retrying resolve+install until it succeeds or
 * unsubscribe() cancels it. Reports watching:true — the engine's first drain
 * delivers the initial snapshot once the file appears, so subscribers must not
 * settle a merely not-yet-flushed transcript into a permanent error (#8401).
 */
function subscribeViaResolvePoll(
  args: SubscribeNativeChatTranscriptArgs,
  decode: (line: string, fallbackId: string) => NativeChatMessage | null
): NativeChatTranscriptSubscription {
  let closed = false
  let installed: NativeChatTranscriptSubscription | null = null
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let delay = args.resolvePollIntervalMs ?? INITIAL_RESOLVE_POLL_MS
  let lastFallbackResolveAt = Date.now()
  const exactPath = exactTranscriptPath(args)

  function scheduleAttempt(): void {
    if (closed) {
      return
    }
    const untilFallbackResolve = exactPath
      ? Math.max(0, FALLBACK_RESOLVE_POLL_MS - (Date.now() - lastFallbackResolveAt))
      : delay
    pollTimer = setTimeout(
      () => {
        pollTimer = null
        void runAttempt()
      },
      Math.min(delay, untilFallbackResolve)
    )
    // Why: never hold the event loop open (headless `orca serve` shutdown) for
    // a session that may genuinely never resolve.
    pollTimer.unref?.()
    // Only back off in production; a test-supplied interval stays fixed so
    // tests resolve in bounded, predictable time.
    if (args.resolvePollIntervalMs === undefined) {
      delay = Math.min(delay * 2, MAX_RESOLVE_POLL_MS)
    }
  }

  async function runAttempt(): Promise<void> {
    if (closed) {
      return
    }
    let result: NativeChatTranscriptSubscription | null
    try {
      result = exactPath ? await attemptInstall({ ...args, filePath: exactPath }, decode) : null
      if (
        !result &&
        (!exactPath || Date.now() - lastFallbackResolveAt >= FALLBACK_RESOLVE_POLL_MS)
      ) {
        lastFallbackResolveAt = Date.now()
        result = await attemptInstall(args, decode)
      }
    } catch {
      // Why: a transient resolve failure (EACCES/EIO during the glob) must not
      // kill the poll loop with an unhandled rejection — retry like a miss.
      result = null
    }
    if (closed) {
      // unsubscribe() ran while this attempt was in flight.
      result?.unsubscribe()
      return
    }
    if (result) {
      installed = result
      return
    }
    scheduleAttempt()
  }

  scheduleAttempt()

  return {
    watching: true,
    unsubscribe: () => {
      if (closed) {
        return
      }
      closed = true
      if (pollTimer) {
        clearTimeout(pollTimer)
        pollTimer = null
      }
      installed?.unsubscribe()
      installed = null
    }
  }
}

/**
 * Subscribe to live appends on an agent's transcript file. Returns an
 * unsubscribe fn that tears the watcher down completely.
 *
 * Handles file rotation/replacement: when the file shrinks (a new session id
 * resolved to a smaller/newer file, or the file was truncated), the offset is
 * reset to 0 so the replacement's content is read from the top.
 *
 * When the transcript isn't resolvable yet (a just-created session whose
 * agent hasn't flushed its first JSONL line, #8401), returns the subscription
 * immediately and keeps retrying resolve+install in the background rather
 * than returning a no-op that never recovers.
 */
export async function subscribeNativeChatTranscript(
  args: SubscribeNativeChatTranscriptArgs
): Promise<NativeChatTranscriptSubscription> {
  const decode = nativeChatLineDecoderForAgent(args.agent)
  if (!decode) {
    // Nothing watchable — return a no-op teardown so callers can unconditionally
    // unsubscribe without null-checks.
    return { unsubscribe: () => {}, watching: false }
  }
  // Why: a blank session id (and no explicit file) can never resolve — bail out
  // instead of resolve-polling an unresolvable target forever.
  if (!args.filePath && !args.sessionId.trim()) {
    return { unsubscribe: () => {}, watching: false }
  }

  const installed = await attemptInstall(args, decode)
  if (installed) {
    return installed
  }
  return subscribeViaResolvePoll(args, decode)
}
