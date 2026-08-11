import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/slices/worktree-helpers'

/**
 * Spike-only launcher for the `pi` (prime-agent) CLI: reuses the existing
 * terminal-tab + startup-command pipeline (same one agent launches use) so no
 * new PTY/IPC plumbing is needed. Not a registered TuiAgent — bypasses the
 * agent catalog entirely. Proof-of-concept only; not meant to ship as-is.
 */
const PI_CLI_PATH =
  'C:\\Dev2026\\external_repos\\prime-agent\\packages\\coding-agent\\dist\\cli.js'
// The pi skill directory this spike ships for the agent to draw Orca UI panels.
// Why the hyphen: pi rejects underscores in skill names, and derives the python
// import name by replacing hyphens — so `orca-ui` still imports as `orca_ui`.
const ORCA_UI_SKILL_DIR = 'C:\\Dev2026\\agentic-ide\\apps\\desktop\\orca\\resources\\pi-skills\\orca-ui'
// The TUI takes ~4.8s to paint under ConPTY: that is the IPython kernel
// bootstrap, not a stuck render. Measured with node-pty on Windows 11 arm64 —
// first useful frame at 4747ms without TERM set and 4796ms with it, identical
// 1932 printable chars either way. --verbose is not needed; it only adds
// startup logging (6370 printable chars instead of 1932).
const PI_LAUNCH_COMMAND = `node "${PI_CLI_PATH}" --provider clinepass --model cline-pass/deepseek-v4-flash --skill "${ORCA_UI_SKILL_DIR}"`

export async function launchPiAgentSpike(args: {
  worktreeId: string
  groupId: string
}): Promise<{ tabId: string }> {
  const store = useAppStore.getState()
  // Why: connectionInfo must be fetched BEFORE createTab so createTab and
  // queueTabStartupCommand stay synchronous and adjacent — TerminalPane reads
  // pendingStartupByTabId once on first render, so an await between them would
  // arrive too late and the startup command would be silently dropped.
  const connectionInfo = await window.api.orcaUi
    ?.getConnectionInfo()
    .catch(() => null)
  const env: Record<string, string> = {}
  // Why: deliver the Orca UI connection info to the agent as PTY environment
  // variables (never typed into the shell, so the token cannot leak into
  // terminal scrollback/history). The launcher reads the port/token through the
  // trusted renderer IPC and passes them in the tab startup env; pty-connection
  // merges them into the spawn request, so the values survive daemon adoption.
  if (connectionInfo) {
    env.ORCA_UI_PORT = String(connectionInfo.port)
    env.ORCA_UI_TOKEN = connectionInfo.token
  }
  const tab = store.createTab(args.worktreeId, args.groupId, undefined, {
    quickCommandLabel: 'pi (spike)'
  })
  // Why: without this the tab inherits the app's cwd, which in a packaged build is
  // the install dir — agents then run git and file globs against the installed app
  // instead of the repo. Queue before mount, like launch-agent-in-new-tab does.
  const worktreePath = findWorktreeById(store.worktreesByRepo, args.worktreeId)?.path
  if (worktreePath) {
    store.queueTabInitialCwd(tab.id, worktreePath)
  }
  store.queueTabStartupCommand(tab.id, { command: PI_LAUNCH_COMMAND, env })
  store.setActiveTabType('terminal')
  return { tabId: tab.id }
}
