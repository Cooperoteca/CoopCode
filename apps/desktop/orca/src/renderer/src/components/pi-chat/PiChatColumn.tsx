// Why: spike - render the pi (prime-agent) conversation as a structured React
// column instead of terminal bytes. Frames arrive over IPC from the main-process
// pi-rpc client (see src/main/pi-rpc/), are reduced into user/assistant messages
// with streaming text and collapsible tool calls, and are composed with the
// house ui primitives so the column reads like native Orca chrome.
//
// This is intentionally a spike mount: opt-in via PI_CHAT_OPEN_EVENT, rendered as a
// right-edge overlay column, and absent entirely from the web (browser) build.

import { useEffect, useRef, useState } from 'react'
import { Bot, ChevronDown, ChevronRight, Loader2, Send, User, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import {
  appendLocalUserMessage,
  emptyPiChatState,
  reducePiChatState,
  type PiChatState,
  type ToolCallView
} from './pi-chat-events'

const TOOL_STATE_LABEL: Record<ToolCallView['state'], { key: string; fallback: string }> = {
  running: {
    key: 'auto.components.pi.chat.PiChatColumn.38c30bd5df',
    fallback: 'Running'
  },
  done: {
    key: 'auto.components.pi.chat.PiChatColumn.a4b5217d8a',
    fallback: 'Done'
  },
  error: {
    key: 'auto.components.pi.chat.PiChatColumn.fb64c8e273',
    fallback: 'Error'
  }
}

export const PI_CHAT_OPEN_EVENT = 'pi-chat:open'

const HEADER_TITLE_KEY = 'auto.components.pi.chat.PiChatColumn.c98e2d87d6'
const STATUS_STREAMING_KEY = 'auto.components.pi.chat.PiChatColumn.d09f4293d5'
const STATUS_IDLE_KEY = 'auto.components.pi.chat.PiChatColumn.bc091e55d8'
const CONNECT_ERROR_KEY = 'auto.components.pi.chat.PiChatColumn.cc1fb4745e'
const EMPTY_TITLE_KEY = 'auto.components.pi.chat.PiChatColumn.602dc45f05'
const THINKING_KEY = 'auto.components.pi.chat.PiChatColumn.0ef30e745f'
const INPUT_PLACEHOLDER_KEY = 'auto.components.pi.chat.PiChatColumn.8f15ef3d75'
const SEND_KEY = 'auto.components.pi.chat.PiChatColumn.c3a72b9e07'
const CLOSE_KEY = 'auto.components.pi.chat.PiChatColumn.105693b503'

export function PiChatColumn({ onClose }: { onClose?: () => void }): React.JSX.Element {
  const [state, setState] = useState<PiChatState>(emptyPiChatState)
  const [draft, setDraft] = useState('')
  const [connectError, setConnectError] = useState<string | null>(null)
  const [expandedToolIds, setExpandedToolIds] = useState<Record<string, boolean>>({})
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const api = window.api?.piRpc

  useEffect(() => {
    if (!api) {
      return
    }
    let disposed = false
    // Why: keep the preload subscription local to this host and tear it down on unmount.
    const unsubscribe = api.onFrame((frame) => {
      if (disposed) {
        return
      }
      const payload = (frame as { payload?: unknown })?.payload
      if (payload !== undefined && payload !== null) {
        setState((previous) => reducePiChatState(previous, payload as never))
      }
    })
    void api
      .start({})
      .catch((error: unknown) => {
        if (disposed) {
          return
        }
        setConnectError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      disposed = true
      unsubscribe()
      // Why: closing the column must also kill the pi child, or a closed conversation
      // leaves a live agent process behind for the rest of the app session.
      void api.dispose?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Why: the piRpc surface is stable for the preload lifetime.
  }, [])

  // Auto-scroll to the newest message as streaming text and tool calls land.
  useEffect(() => {
    const el = scrollRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [state.items])

  const busy = state.pendingAssistantId !== null
  const canSend = !busy && draft.trim().length > 0 && connectError === null && api !== undefined

  const submit = (): void => {
    if (!canSend) {
      return
    }
    const message = draft.trim()
    setDraft('')
    setState((previous) => appendLocalUserMessage(previous, message))
    void api.send({ type: 'prompt', message }).catch((error: unknown) => {
      setConnectError(error instanceof Error ? error.message : String(error))
    })
  }

  const toggleTool = (toolId: string): void => {
    setExpandedToolIds((previous) => ({ ...previous, [toolId]: !previous[toolId] }))
  }

  return (
    <section
      aria-label={translate(HEADER_TITLE_KEY, 'pi')}
      data-spike-pi-chat-column="true"
      className="pointer-events-auto flex h-full w-full flex-col border-l border-border/60 bg-background"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-3">
        <Bot className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{translate(HEADER_TITLE_KEY, 'pi')}</h2>
        <Badge variant="secondary" className="ml-auto">
          {busy
            ? translate(STATUS_STREAMING_KEY, 'Working…')
            : translate(STATUS_IDLE_KEY, 'Ready')}
        </Badge>
        {onClose ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={translate(CLOSE_KEY, 'Close pi')}
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        ) : null}
      </header>

      <div
        ref={scrollRef}
        className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-4 py-4"
        data-testid="pi-chat-scroll"
      >
        {connectError !== null && (
          <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {translate(CONNECT_ERROR_KEY, 'pi could not start: {{error}}', {
              error: connectError
            })}
          </div>
        )}

        {state.items.length === 0 && connectError === null && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Bot className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {translate(
                EMPTY_TITLE_KEY,
                'The pi agent is ready. Send a prompt below to start a conversation.'
              )}
            </p>
          </div>
        )}

        <ul className="flex flex-col gap-3">
          {state.items.map((item) => {
            if (item.kind === 'user') {
              return (
                <li key={item.id} className="flex justify-end gap-2">
                  <div className="max-w-[80%] rounded-xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
                    {item.text}
                  </div>
                  <span
                    aria-hidden="true"
                    className="mt-2 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted"
                  >
                    <User className="size-3 text-muted-foreground" />
                  </span>
                </li>
              )
            }

            return (
              <li key={item.id} className="flex gap-2">
                <span
                  aria-hidden="true"
                  className="mt-2 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted"
                >
                  <Bot className="size-3 text-muted-foreground" />
                </span>
                <div className="min-w-0 max-w-[85%] flex-1 space-y-2">
                  <div className="rounded-xl rounded-tl-sm border border-border/70 bg-card px-3 py-2 text-sm text-card-foreground">
                    {item.streaming && item.text.length === 0 && item.toolCalls.length === 0 ? (
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="size-3.5 animate-spin" />
                        {translate(THINKING_KEY, 'Thinking…')}
                      </span>
                    ) : (
                      <p className="whitespace-pre-wrap break-words">{item.text}</p>
                    )}
                    {item.toolCalls.map((tool) => {
                      const expanded = expandedToolIds[tool.id] ?? false
                      const stateLabel = TOOL_STATE_LABEL[tool.state]
                      return (
                        <div key={tool.id} className="mt-2">
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-auto justify-start gap-1 px-0 text-xs"
                              onClick={() => toggleTool(tool.id)}
                            >
                              {expanded ? (
                                <ChevronDown className="size-3.5 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="size-3.5 text-muted-foreground" />
                              )}
                              <code className="font-mono text-[12px]">{tool.name}</code>
                            </Button>
                            <Badge variant="outline" className="text-[10px]">
                              {translate(stateLabel.key, stateLabel.fallback)}
                            </Badge>
                          </div>
                          {expanded && tool.args !== undefined && (
                            <pre className="mt-1 overflow-x-auto rounded-md border border-border/60 bg-muted/40 p-2 text-[11px] text-muted-foreground">
                              {JSON.stringify(tool.args, null, 2)}
                            </pre>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      <footer className="shrink-0 border-t border-border/60 p-3">
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={busy || connectError !== null}
            placeholder={translate(INPUT_PLACEHOLDER_KEY, 'Message pi…')}
            aria-label={translate(INPUT_PLACEHOLDER_KEY, 'Message pi…')}
            className="flex-1"
            data-testid="pi-chat-input"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!canSend}
            aria-label={translate(SEND_KEY, 'Send')}
            data-testid="pi-chat-send"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </form>
      </footer>
    </section>
  )
}

export function PiChatColumnHost(): React.JSX.Element | null {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onOpen = (): void => setOpen(true)
    window.addEventListener(PI_CHAT_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(PI_CHAT_OPEN_EVENT, onOpen)
  }, [])

  // Why: mounting is opt-in. The column fills the window and its child effect spawns
  // a pi process, so an always-on mount would both hide the rest of Orca and start an
  // agent nobody asked for. The web build has no piRpc surface at all.
  if (!open || !window.api?.piRpc) {
    return null
  }
  return (
    // pointer-events-none on the full-screen layer: it only positions the column,
    // and must not swallow clicks aimed at the rest of the app behind it.
    <div className="pointer-events-none fixed inset-0 z-40 flex justify-end">
      <div className="pointer-events-auto flex h-full w-full max-w-2xl flex-col">
        <PiChatColumn onClose={() => setOpen(false)} />
      </div>
    </div>
  )
}
