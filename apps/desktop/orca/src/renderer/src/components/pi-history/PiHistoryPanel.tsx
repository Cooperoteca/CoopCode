// Why: spike - the session-history tab of the pi shell. Lists every pi session the
// main process has indexed (window.api.piSessions.list()), grouped as a
// project -> branch -> sessions tree, and lets the user switch the live pi
// conversation back to an older session by sending { type:'switch_session',
// sessionPath, id } over the existing pi RPC surface and correlating the
// matching response frame. Cancelled switches are a normal outcome (neutral
// feedback), not an error. The conversation refresh itself is owned by the
// pi-chat tab (it already reduces the frame stream); this panel only reports
// whether the switch was accepted.
//
// Deliberately a thin React shell: all shaping/translation of the raw IPC result
// and all frame classification live in the pure pi-history-view-model module.

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, History, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { PiSessionsListResult } from '../../../../shared/pi-rpc'
import {
  buildPiHistoryViewModel,
  defaultPiHistoryFormatters,
  parsePiSwitchResponse,
  type PiHistorySessionView,
  type PiHistoryViewModel,
  type PiSwitchResultKind
} from './pi-history-view-model'

const TITLE_KEY = 'auto.components.pi.history.PiHistoryPanel.title'
const REFRESH_KEY = 'auto.components.pi.history.PiHistoryPanel.refresh'
const LOADING_KEY = 'auto.components.pi.history.PiHistoryPanel.loading'
const LOAD_ERROR_KEY = 'auto.components.pi.history.PiHistoryPanel.loadError'
const EMPTY_TITLE_KEY = 'auto.components.pi.history.PiHistoryPanel.empty'
const NO_BRANCH_KEY = 'auto.components.pi.history.PiHistoryPanel.noBranch'
const SWITCHING_KEY = 'auto.components.pi.history.PiHistoryPanel.switching'
const SWITCH_DONE_KEY = 'auto.components.pi.history.PiHistoryPanel.switchDone'
const SWITCH_CANCELLED_KEY = 'auto.components.pi.history.PiHistoryPanel.switchCancelled'
const SWITCH_ERROR_KEY = 'auto.components.pi.history.PiHistoryPanel.switchError'
const SWITCH_TIMEOUT_KEY = 'auto.components.pi.history.PiHistoryPanel.switchTimeout'
const SESSION_COUNT_KEY = 'auto.components.pi.history.PiHistoryPanel.sessionCount'

/** Max time we wait for the { command:'switch_session' } response frame. */
const SWITCH_RESPONSE_TIMEOUT_MS = 10_000

type LoadState = 'loading' | 'ready' | 'error'

export type PiSwitchFeedback =
  | { kind: 'switching'; sessionPath: string }
  | { kind: 'done'; sessionPath: string }
  | { kind: 'cancelled'; sessionPath: string }
  | { kind: 'error'; sessionPath: string; reason: 'send' | 'timeout' }

type PiPendingSwitch = {
  id: string
  sessionPath: string
  timer: ReturnType<typeof setTimeout>
  resolve: (kind: PiSwitchResultKind) => void
}

export function PiHistoryPanel(): React.JSX.Element {
  const [view, setView] = useState<PiHistoryViewModel | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [feedback, setFeedback] = useState<PiSwitchFeedback | null>(null)
  // Collapse keys: `p:<project>` and `b:<project>|<branch>`.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const pendingRef = useRef<PiPendingSwitch | null>(null)
  const switchCounter = useRef(0)

  const api = window.api?.piRpc
  const sessions = window.api?.piSessions

  // Why: list sessions on mount and whenever the refresh button bumps the nonce.
  useEffect(() => {
    if (!sessions) {
      setLoadState('error')
      setLoadError('pi sessions API unavailable')
      return
    }
    const branchLabel = translate(NO_BRANCH_KEY, 'No branch')
    let cancelled = false
    setLoadState('loading')
    setLoadError(null)
    void sessions
      .list()
      .then((result: PiSessionsListResult) => {
        if (cancelled) {
          return
        }
        setView(buildPiHistoryViewModel(result, defaultPiHistoryFormatters, branchLabel))
        setLoadState('ready')
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }
        setLoadState('error')
        setLoadError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Why: the API surface is stable for the preload lifetime; refresh is driven by the nonce bump, not by rebinding.
  }, [sessions, refreshNonce])

  // Why: one frame subscription for the panel's lifetime; it only acts while a
  // switch is pending (correlating by the echo id). Unrelated frames are ignored.
  useEffect(() => {
    if (!api) {
      return
    }
    const unsubscribe = api.onFrame((frame) => {
      const pending = pendingRef.current
      if (!pending) {
        return
      }
      const match = parsePiSwitchResponse(frame?.payload)
      if (!match || match.id !== pending.id) {
        return
      }
      clearTimeout(pending.timer)
      pendingRef.current = null
      pending.resolve(match.kind)
    })
    return () => {
      unsubscribe()
      const pending = pendingRef.current
      if (pending) {
        clearTimeout(pending.timer)
        pendingRef.current = null
        pending.resolve('error')
      }
    }
  }, [api])

  const switchSession = (sessionPath: string): void => {
    if (pendingRef.current !== null || !api) {
      return
    }
    switchCounter.current += 1
    const id = `pi-history-${Date.now()}-${switchCounter.current}`
    setFeedback({ kind: 'switching', sessionPath })

    const awaited = new Promise<PiSwitchResultKind>((resolvePromise) => {
      const timer = setTimeout(() => {
        if (pendingRef.current?.id === id) {
          pendingRef.current = null
          resolvePromise('error')
        }
      }, SWITCH_RESPONSE_TIMEOUT_MS)
      pendingRef.current = { id, sessionPath, timer, resolve: resolvePromise }
    })

    void api
      .send({ type: 'switch_session', sessionPath, id })
      .then(() => awaited)
      .then((kind) => {
        if (pendingRef.current?.id === id) {
          clearTimeout(pendingRef.current.timer)
          pendingRef.current = null
        }
        if (kind === 'error') {
          setFeedback({ kind: 'error', sessionPath, reason: 'timeout' })
        } else if (kind === 'cancelled') {
          setFeedback({ kind: 'cancelled', sessionPath })
        } else {
          setFeedback({ kind: 'done', sessionPath })
        }
      })
      .catch(() => {
        if (pendingRef.current?.id === id) {
          clearTimeout(pendingRef.current.timer)
          pendingRef.current = null
        }
        setFeedback({ kind: 'error', sessionPath, reason: 'send' })
      })
  }

  const toggle = (key: string): void =>
    setCollapsed((previous) => ({ ...previous, [key]: !previous[key] }))

  return (
    <section
      aria-label={translate(TITLE_KEY, 'pi history')}
      data-testid="pi-history-panel"
      className="flex h-full w-full flex-col bg-background"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
        <History className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{translate(TITLE_KEY, 'pi history')}</h2>
        {loadState === 'ready' ? (
          <span className="text-xs text-muted-foreground">
            {translate(SESSION_COUNT_KEY, '{{count}} sessions', { count: view?.sessionCount ?? 0 })}
          </span>
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label={translate(REFRESH_KEY, 'Refresh')}
          title={translate(REFRESH_KEY, 'Refresh')}
          data-testid="pi-history-refresh"
          disabled={loadState === 'loading'}
          onClick={() => setRefreshNonce((n) => n + 1)}
        >
          <RefreshCw className={loadState === 'loading' ? 'size-4 animate-spin' : 'size-4'} />
        </Button>
      </header>

      {feedback !== null ? <FeedbackBanner feedback={feedback} /> : null}

      <div
        className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto p-2"
        data-testid="pi-history-scroll"
      >
        {loadState === 'loading' ? (
          <LoadingState />
        ) : loadState === 'error' ? (
          <ErrorState message={loadError} />
        ) : !view?.hasSessions ? (
          <EmptyState />
        ) : (
          view.projects.map((project) => {
            const projectKey = `p:${project.project}`
            const projectCollapsed = collapsed[projectKey] ?? false
            return (
              <div key={projectKey} className="mb-1">
                <button
                  type="button"
                  data-testid="pi-history-project-row"
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs font-medium text-foreground hover:bg-accent"
                  onClick={() => toggle(projectKey)}
                >
                  {projectCollapsed ? (
                    <ChevronRight className="size-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="size-3.5 text-muted-foreground" />
                  )}
                  <span className="truncate">{project.project}</span>
                </button>
                {!projectCollapsed && (
                  <div className="ml-3 border-l border-border/50 pl-2">
                    {project.branches.map((branch) => {
                      const branchKey = `b:${project.project}|${branch.branch ?? ''}`
                      const branchCollapsed = collapsed[branchKey] ?? false
                      return (
                        <div key={branchKey} className="mb-1">
                          <button
                            type="button"
                            data-testid="pi-history-branch-row"
                            className="flex w-full items-center gap-1.5 rounded-md px-2 py-0.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                            onClick={() => toggle(branchKey)}
                          >
                            {branchCollapsed ? (
                              <ChevronRight className="size-3.5" />
                            ) : (
                              <ChevronDown className="size-3.5" />
                            )}
                            <span className="truncate">{branch.branchLabel}</span>
                            <span className="ml-auto text-[10px] tabular-nums">
                              {branch.sessions.length}
                            </span>
                          </button>
                          {!branchCollapsed && (
                            <ul className="ml-4 space-y-0.5">
                              {branch.sessions.map((session) => (
                                <li key={session.sessionPath}>
                                  <SessionRow
                                    session={session}
                                    disabled={feedback?.kind === 'switching'}
                                    onSelect={() => switchSession(session.sessionPath)}
                                  />
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}

function FeedbackBanner({ feedback }: { feedback: PiSwitchFeedback }): React.JSX.Element {
  const message =
    feedback.kind === 'switching'
      ? translate(SWITCHING_KEY, 'Switching session…')
      : feedback.kind === 'done'
        ? translate(SWITCH_DONE_KEY, 'Switched to {{session}}', { session: shortPath(feedback.sessionPath) })
        : feedback.kind === 'cancelled'
          ? translate(SWITCH_CANCELLED_KEY, 'Session switch cancelled')
          : feedback.reason === 'timeout'
            ? translate(SWITCH_TIMEOUT_KEY, 'Session switch timed out')
            : translate(SWITCH_ERROR_KEY, 'Could not switch session')

  const className =
    feedback.kind === 'error'
      ? 'border-destructive/40 bg-destructive/5 text-destructive'
      : 'border-border/60 bg-muted/30 text-muted-foreground'

  return (
    <div
      data-testid="pi-history-feedback"
      className={`flex items-center gap-2 border-b px-3 py-1.5 text-xs ${className}`}
    >
      {feedback.kind === 'switching' ? <Loader2 className="size-3.5 animate-spin" /> : null}
      <span className="truncate">{message}</span>
    </div>
  )
}

function shortPath(sessionPath: string): string {
  const normalized = sessionPath.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index >= 0 ? normalized.slice(index + 1) : sessionPath
}

function SessionRow({
  session,
  disabled,
  onSelect
}: {
  session: PiHistorySessionView
  disabled: boolean
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      data-testid="pi-history-session-row"
      data-session-path={session.sessionPath}
      disabled={disabled}
      className="flex w-full flex-col rounded-md px-2 py-1 text-left hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
      onClick={onSelect}
    >
      <span className="flex items-center gap-1.5 text-xs">
        <span className="truncate text-foreground">{session.timeLabel || session.shortId}</span>
        <code className="shrink-0 text-[10px] text-muted-foreground">{session.shortId}</code>
      </span>
      {session.cwd ? (
        <span className="truncate text-[11px] text-muted-foreground" title={session.cwd}>
          {session.cwd}
        </span>
      ) : null}
    </button>
  )
}

function LoadingState(): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
      <p className="text-xs text-muted-foreground">{translate(LOADING_KEY, 'Loading sessions…')}</p>
    </div>
  )
}

function ErrorState({ message }: { message: string | null }): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
      <p className="text-xs text-destructive">
        {translate(LOAD_ERROR_KEY, 'Could not load session history: {{error}}', {
          error: message ?? 'unknown error'
        })}
      </p>
    </div>
  )
}

function EmptyState(): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
      <History className="size-6 text-muted-foreground" />
      <p className="text-xs text-muted-foreground">{translate(EMPTY_TITLE_KEY, 'No pi sessions yet.')}</p>
    </div>
  )
}
