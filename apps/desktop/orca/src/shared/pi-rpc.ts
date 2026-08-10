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

/** Commands accepted by the pi RPC mode. `prompt` drives the conversation. */
export type PiRpcCommand =
  | { type: 'prompt'; message: string }
  | { type: 'abort' }
  | { type: 'new_session' }
  | { type: 'get_state' }

/** Optional spawn overrides passed from the renderer. */
export type PiRpcSpawnConfig = { cwd?: string }

/** One parsed JSONL frame streamed from the pi child process. */
export type PiRpcFrame = { kind: 'frame'; payload: unknown }
