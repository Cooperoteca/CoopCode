/** Wire contract for the pi-rpc spike: hosting the `pi` (prime-agent) CLI over
 * its JSONL RPC stdin/stdout protocol inside the Orca main process, and streaming
 * parsed frames to the trusted renderer as a structured conversation column.
 *
 * NOTE: this is a spike. The RPC command and frame payloads intentionally remain
 * loosely typed `unknown` here; the pi CLI (external repo) owns the authoritative
 * event schemas. Consumers in `src/main/pi-rpc` and `src/renderer/src/components/pi-chat`
 * keep their own narrow local projections of the subset they handle.
 */

export const PI_RPC_START_CHANNEL = 'pi-rpc:start'
export const PI_RPC_SEND_CHANNEL = 'pi-rpc:send'
export const PI_RPC_DISPOSE_CHANNEL = 'pi-rpc:dispose'
export const PI_RPC_FRAME_CHANNEL = 'pi-rpc:frame'

/** Commands accepted by the pi RPC mode. `prompt` drives the conversation.
 * The optional `id` is echoed by the pi CLI on the matching `response` frame,
 * letting the renderer correlate request/response pairs over the frame stream.
 * The authoritative schema lives in the external repo
 * (packages/coding-agent/src/modes/rpc/rpc-types.ts); this union mirrors only
 * the subset the shell uses. */
export type PiRpcCommand =
  | { id?: string; type: 'prompt'; message: string }
  | { id?: string; type: 'abort' }
  | { id?: string; type: 'new_session' }
  | { id?: string; type: 'get_state' }
  | { id?: string; type: 'get_available_models' }
  | { id?: string; type: 'set_model'; provider: string; modelId: string }
  | { id?: string; type: 'switch_session'; sessionPath: string }

/** Optional spawn overrides passed from the renderer. */
export type PiRpcSpawnConfig = { cwd?: string }

/** One parsed JSONL frame streamed from the pi child process. */
export type PiRpcFrame = { kind: 'frame'; payload: unknown }

// ---------------------------------------------------------------------------
// Session history index (main-process fs read, not part of the pi RPC protocol
// — the pi CLI has no session-listing command, so the main process reads the
// .jsonl headers directly and serves the grouped index over IPC).
// ---------------------------------------------------------------------------

export const PI_SESSIONS_LIST_CHANNEL = 'pi-sessions:list'

/** One pi session, parsed from the first line of its .jsonl file only. */
export type PiSessionSummary = {
  /** Absolute path of the .jsonl file; the `switch_session` target. */
  sessionPath: string
  sessionId: string
  /** ISO timestamp from the header; empty string when missing/unparseable. */
  timestamp: string
  cwd: string
}

/** Sessions of one branch (the epic grouping), newest first. */
export type PiSessionBranchGroup = {
  /** Git branch from the header; null when the header has no git block. */
  branch: string | null
  sessions: PiSessionSummary[]
}

/** One project (git repoUrl, falling back to cwd) with its branch groups. */
export type PiSessionProjectGroup = {
  project: string
  branches: PiSessionBranchGroup[]
}

export type PiSessionsListResult = { projects: PiSessionProjectGroup[] }

// ---------------------------------------------------------------------------
// Provider registration (main-process fs read/write of
// <homedir>/.prime/agent/models.json, the file pi already validates). The
// renderer never handles raw API keys: `credential` is an environment variable
// NAME or a `!command`, stored as `apiKey` in models.json.
// ---------------------------------------------------------------------------

export const PI_EXTENSIONS_WRITE_PROVIDER_CHANNEL = 'pi-extensions:write-provider'
export const PI_EXTENSIONS_LIST_PROVIDERS_CHANNEL = 'pi-extensions:list-providers'

export type PiProviderModelSpec = {
  id: string
  name: string
  contextWindow: number
  maxTokens: number
  reasoning: boolean
}

export type PiProviderExtensionSpec = {
  /** Provider id used as the models.json `providers` key. */
  providerId: string
  /** Display name. */
  providerName: string
  baseUrl: string
  /** API type, e.g. 'openai-completions'. */
  api: string
  /** Environment variable name or `!command`; NEVER a raw API key. */
  credential: string
  models: PiProviderModelSpec[]
}

export type PiExtensionWriteResult = { ok: true; path: string } | { ok: false; error: string }

/** One provider currently registered in models.json, as the form lists it. */
export type PiProviderSummary = {
  id: string
  /** Display name; falls back to the id when the entry has no name. */
  name: string
  /** Number of entries in the provider's `models` array. */
  modelCount: number
}

export type PiProvidersListResult = {
  providers: PiProviderSummary[]
  /** Present when models.json exists but could not be read/parsed. */
  error?: string
}
