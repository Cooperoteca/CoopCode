/**
 * Local, deliberately-narrow projection of the pi RPC event stream the PiChat
 * column cares about. The pi CLI (external_repos) owns the authoritative schema;
 * this module only mirrors the subset needed to render a structured conversation:
 * user prompts, assistant text (streamed via text_delta), and tool calls (shown
 * collapsed with an expandable body). Keeping the reducer pure here makes it
 * trivially testable and keeps the React component free of protocol logic.
 */

export type PiRpcAssistantMessageEvent = {
  type?: string
  contentIndex?: number
  delta?: string
  content?: string
  toolCall?: {
    type?: string
    id?: string
    name?: string
    arguments?: unknown
  }
}

export type PiRpcMessage = {
  role?: string
  content?: unknown
  timestamp?: number
}

export type PiRpcFramePayload = {
  type?: string
  message?: PiRpcMessage
  assistantMessageEvent?: PiRpcAssistantMessageEvent
  toolCallId?: string
  toolName?: string
  isError?: boolean
}

export type ToolCallView = {
  id: string
  name: string
  state: 'running' | 'done' | 'error'
  args?: unknown
  result?: string
}

export type PiChatItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; toolCalls: ToolCallView[]; streaming: boolean }

export type PiChatState = {
  items: PiChatItem[]
  pendingAssistantId: string | null
}

export const emptyPiChatState: PiChatState = { items: [], pendingAssistantId: null }

let nextId = 0
function makeId(prefix: string): string {
  nextId += 1
  return `${prefix}-${nextId}`
}

function contentText(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string') {
          return (block as { text: string }).text
        }
        return ''
      })
      .join('')
  }
  return ''
}

function toolCallsFromContent(content: unknown): ToolCallView[] {
  if (!Array.isArray(content)) {
    return []
  }
  const calls: ToolCallView[] = []
  for (const block of content) {
    if (
      block &&
      typeof block === 'object' &&
      (block as { type?: string }).type === 'toolCall'
    ) {
      const b = block as { id?: string; name?: string; arguments?: unknown }
      calls.push({
        id: b.id ?? makeId('tool'),
        name: b.name ?? 'tool',
        state: 'done',
        args: b.arguments
      })
    }
  }
  return calls
}

/** Shows the prompt immediately on send; pi's echo of it is dropped by the reducer. */
export function appendLocalUserMessage(state: PiChatState, text: string): PiChatState {
  return { ...state, items: [...state.items, { kind: 'user', id: makeId('user'), text }] }
}

/** Pure reducer over one parsed pi RPC frame. Returns a new state object. */
export function reducePiChatState(state: PiChatState, frame: PiRpcFramePayload): PiChatState {
  const type = frame.type

  if (type === 'message_start') {
    const role = frame.message?.role
    if (role === 'user') {
      const text = contentText(frame.message?.content)
      // The composer already appended this locally so the message shows on click
      // instead of after the round-trip; drop pi's echo of it.
      const last = state.items.at(-1)
      if (last?.kind === 'user' && last.text === text) {
        return state
      }
      return { ...state, items: [...state.items, { kind: 'user', id: makeId('user'), text }] }
    }
    if (role === 'assistant') {
      const id = makeId('assistant')
      return {
        ...state,
        items: [...state.items, { kind: 'assistant', id, text: '', toolCalls: [], streaming: true }],
        pendingAssistantId: id
      }
    }
    return state
  }

  if (type === 'message_update') {
    const ev = frame.assistantMessageEvent
    if (!ev) {
      return state
    }
    // Streaming assistant text arrives as text_delta.
    if (ev.type === 'text_delta' && typeof ev.delta === 'string' && state.pendingAssistantId) {
      return {
        ...state,
        items: state.items.map((item) =>
          item.kind === 'assistant' && item.id === state.pendingAssistantId
            ? { ...item, text: item.text + ev.delta }
            : item
        )
      }
    }
    // A tool call is finalized on toolcall_end.
    if (ev.type === 'toolcall_end' && ev.toolCall && state.pendingAssistantId) {
      const call = ev.toolCall
      return {
        ...state,
        items: state.items.map((item) =>
          item.kind === 'assistant' && item.id === state.pendingAssistantId
            ? {
                ...item,
                toolCalls: [
                  ...item.toolCalls,
                  {
                    id: call.id ?? makeId('tool'),
                    name: call.name ?? 'tool',
                    state: 'done',
                    args: call.arguments
                  }
                ]
              }
            : item
        )
      }
    }
    return state
  }

  if (type === 'message_end') {
    const role = frame.message?.role
    if (role === 'assistant' && state.pendingAssistantId) {
      const content = frame.message?.content
      const text = contentText(content)
      const toolCalls = toolCallsFromContent(content)
      return {
        ...state,
        items: state.items.map((item) =>
          item.kind === 'assistant' && item.id === state.pendingAssistantId
            ? { ...item, text, toolCalls, streaming: false }
            : item
        ),
        pendingAssistantId: null
      }
    }
    return state
  }

  // Agent-level tool execution lifecycle (optional status refinement).
  if (type === 'tool_execution_end' && frame.toolCallId && state.pendingAssistantId) {
    return {
      ...state,
      items: state.items.map((item) =>
        item.kind === 'assistant' && item.id === state.pendingAssistantId
          ? {
              ...item,
              toolCalls: item.toolCalls.map((tc) =>
                tc.id === frame.toolCallId ? { ...tc, state: frame.isError ? 'error' : 'done' } : tc
              )
            }
          : item
      )
    }
  }

  return state
}
