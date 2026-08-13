---
{
  "id": "DEVX-054",
  "title": "Collapse the three pi entry points in the new-tab menu into one, without losing the orca-ui skill the spike carries",
  "state": "ready",
  "lane": "high-risk",
  "priority": "P2",
  "risk": "high",
  "depends_on": ["DEVX-052"],
  "blocked_on": [],
  "capabilities": ["repository-read", "repository-write"],
  "scope": {"allow": [
    "apps/desktop/orca/src/renderer/src/components/tab-bar/TabBar.tsx",
    "apps/desktop/orca/src/renderer/src/lib/launch-pi-agent-spike.ts",
    "apps/desktop/orca/src/shared/tui-agent-config.ts",
    "apps/desktop/orca/src/main/pi-rpc/client.ts",
    "docs/planning/evidence/DEVX-054-gate.json",
    "docs/coop/tasks/DEVX-054.md"
  ]},
  "profiles": {"worker": "high", "reviewer": "high"},
  "budget": {"wall_minutes": 180, "attempts": 1, "reworks": 2},
  "gates": [
    {
      "command": "node tools/coop-dev/validate-task.mjs docs/coop/tasks/DEVX-054.md",
      "purpose": "Validate the task contract"
    },
    {
      "command": "node tools/coop-dev/validate-gate-artifact.mjs docs/planning/evidence/DEVX-054-gate.json",
      "purpose": "Prove gate evidence is bound to the result SHA"
    },
    {
      "command": "tools/pnpm-arm64.cmd exec vitest run --config config/vitest.config.ts src/main/pi-rpc src/shared/tui-agent-startup.test.ts",
      "purpose": "pi RPC and agent-startup suites still pass, from apps/desktop/orca"
    },
    {
      "command": "tools/pnpm-arm64.cmd exec tsc --noEmit -p config/tsconfig.node.json",
      "purpose": "Typecheck, from apps/desktop/orca"
    }
  ]
}
---

# DEVX-054 · One way to start Prime Agent, not three

## Outcome

The new-tab menu offers a single Prime Agent entry point (or one entry plus a
clearly-labelled terminal variant, if the investigation shows both are still
needed), and no capability is lost in the process.

## Acceptance

- [ ] The investigation is done and written down **before** anything is removed:
      for each of the three current entries, what it launches, which pi binary it
      resolves, and what it can do that the others cannot. The three today are
      the catalog agent `pi` (`tui-agent-config.ts:115`, `launchCmd: 'pi'` — the
      pi on `PATH`, i.e. the global install), `pi (spike)`
      (`TabBar.tsx:1292`, `launch-pi-agent-spike.ts` — the fork at an absolute
      path, plus the `orca-ui` skill and the UI connection env vars), and
      `pi (RPC)` (`TabBar.tsx:1298` — the React conversation column).
- [ ] The `orca-ui` skill and its connection env vars are not dropped. That is
      the only real capability the spike entry has over the catalog agent
      (`launch-pi-agent-spike.ts:11-21` builds `--skill` into the launch command;
      `window.api.orcaUi.getConnectionInfo()` supplies port and token through the
      PTY env so the token never reaches shell history). Whatever survives must
      still deliver both, and the token must still never be written to a shell
      command line.
- [ ] The menu ends with no entry whose label leaks the word "spike" and no two
      entries that a user cannot tell apart.
- [ ] The absolute fork path in `launch-pi-agent-spike.ts:10-11` is no longer the
      only way to reach the fork. Either the catalog entry can be pointed at it,
      or an override exists — mirroring what `client.ts` already does with
      `ORCA_PI_PROVIDER` / `ORCA_PI_MODEL` (landed in commit `e509963cc`).
      Hardcoding a second absolute path is not acceptable.
- [ ] If consolidating genuinely requires changing the `tui-agent-config` schema
      (for example because `launchCmd` cannot carry `--skill` and an env
      payload), stop and report that as a scope finding with the evidence, and
      leave the menu as it is. A precise blocked report is a correct outcome for
      this task; a half-migration that loses the skill is not.

## Non-goals

- Do not rename any pi label — DEVX-052 owns that and runs first.
- Do not change the RPC protocol, the conversation column, or the provider form.
- Do not delete `launch-pi-agent-spike.ts` until the surviving path is proven to
  deliver the skill and the connection env vars; a deletion whose replacement is
  untested fails criterion 2.
- Do not widen scope into `src/main/ipc/` or the orca-ui HTTP server.

## Sources and decisions

- `apps/desktop/orca/src/shared/tui-agent-config.ts:115-122` — the registered
  `pi` catalog entry: `launchCmd: 'pi'`, `promptInjectionMode: 'argv'`,
  `draftPromptEnvVar: 'ORCA_PI_PREFILL'`.
- `apps/desktop/orca/src/renderer/src/lib/launch-pi-agent-spike.ts:10-21` — the
  absolute fork path, the `orca-ui` skill directory, and the comment recording
  why the skill name uses a hyphen (pi rejects underscores).
- `apps/desktop/orca/src/renderer/src/components/tab-bar/TabBar.tsx:616-621,
  1292-1303` — both menu entries and the comment stating the spike "is not meant
  to ship as-is".
- `apps/desktop/orca/src/main/pi-rpc/client.ts` — the env-override pattern
  (`ORCA_PI_PROVIDER`, `ORCA_PI_MODEL`, `buildPiRpcArgs`) that criterion 4 asks
  this task to mirror rather than reinvent.
- Open decision, deliberately left to the investigation: whether the terminal
  (TUI) entry point survives at all once the RPC column carries the skill. Do not
  assume; decide from what criterion 1 finds, and state the decision.

## Plan and test mapping

1. Write the three-way comparison from the code before touching anything.
   Criterion 1.
2. Establish how the surviving entry delivers `--skill` and the connection env
   vars, and prove the token still travels by env and not by command line.
   Criterion 2.
3. Replace the hardcoded fork path with an override in the same style as
   `client.ts`. Criterion 4.
4. Reduce the menu and confirm the remaining labels are distinguishable.
   Criterion 3.
5. If step 2 or 3 hits the schema wall, stop and write the finding.
   Criterion 5.
6. Run the declared gates and write `docs/planning/evidence/DEVX-054-gate.json`
   per `docs/coop/gate-artifact-v1.md`.

## Handoff

Worker and reviewer return evidence to the dispatcher/state owner. The reviewer
must confirm the `orca-ui` skill still reaches the agent and that no token
appears in any command line — a green typecheck says nothing about either.
