import { useAppStore } from '@/store'

/**
 * Spike-only launcher for the `pi` (prime-agent) CLI: reuses the existing
 * terminal-tab + startup-command pipeline (same one agent launches use) so no
 * new PTY/IPC plumbing is needed. Not a registered TuiAgent — bypasses the
 * agent catalog entirely. Proof-of-concept only; not meant to ship as-is.
 */
const PI_CLI_PATH =
  'C:\\Dev2026\\external_repos\\prime-agent\\packages\\coding-agent\\dist\\cli.js'
// The TUI takes ~4.8s to paint under ConPTY: that is the IPython kernel
// bootstrap, not a stuck render. Measured with node-pty on Windows 11 arm64 —
// first useful frame at 4747ms without TERM set and 4796ms with it, identical
// 1932 printable chars either way. --verbose is not needed; it only adds
// startup logging (6370 printable chars instead of 1932).
const PI_LAUNCH_COMMAND = `node "${PI_CLI_PATH}" --provider clinepass --model cline-pass/deepseek-v4-flash`

export function launchPiAgentSpike(args: {
  worktreeId: string
  groupId: string
}): { tabId: string } {
  const store = useAppStore.getState()
  const tab = store.createTab(args.worktreeId, args.groupId, undefined, {
    quickCommandLabel: 'pi (spike)'
  })
  store.queueTabStartupCommand(tab.id, { command: PI_LAUNCH_COMMAND })
  store.setActiveTabType('terminal')
  return { tabId: tab.id }
}
