---
{
  "id": "DEVX-052",
  "title": "Show the pi agent as \"Prime Agent\" in every user-facing label, keeping `pi` only where it is the actual command",
  "state": "ready",
  "lane": "standard",
  "priority": "P2",
  "risk": "routine",
  "depends_on": ["DEVX-055"],
  "blocked_on": [],
  "capabilities": ["repository-read", "repository-write"],
  "scope": {"allow": [
    "apps/desktop/orca/src/renderer/src/components/tab-bar/TabBar.tsx",
    "apps/desktop/orca/src/renderer/src/components/pi-chat/**",
    "apps/desktop/orca/src/renderer/src/components/pi-history/**",
    "apps/desktop/orca/src/renderer/src/components/pi-providers/**",
    "apps/desktop/orca/src/renderer/src/components/flex-shell/FlexShellRegion.tsx",
    "apps/desktop/orca/src/renderer/src/i18n/**",
    "docs/planning/evidence/DEVX-052-gate.json"
  ]},
  "profiles": {"worker": "routine", "reviewer": "routine"},
  "budget": {"wall_minutes": 90, "attempts": 1, "reworks": 1},
  "gates": [
    {
      "command": "node tools/coop-dev/validate-task.mjs docs/coop/tasks/DEVX-052.md",
      "purpose": "Validate the task contract"
    },
    {
      "command": "node tools/coop-dev/validate-gate-artifact.mjs docs/planning/evidence/DEVX-052-gate.json",
      "purpose": "Prove gate evidence is bound to the result SHA"
    },
    {
      "command": "tools/pnpm-arm64.cmd exec vitest run --config config/vitest.renderer.config.ts src/renderer/src/components/pi-chat src/renderer/src/components/pi-history src/renderer/src/components/pi-providers",
      "purpose": "The pi component suites still pass, from apps/desktop/orca"
    },
    {
      "command": "tools/pnpm-arm64.cmd exec tsc --noEmit -p config/tsconfig.node.json",
      "purpose": "Typecheck, from apps/desktop/orca"
    },
    {
      "command": "tools/pnpm-arm64.cmd exec oxlint src/renderer/src/components/pi-chat src/renderer/src/components/pi-history src/renderer/src/components/pi-providers src/renderer/src/components/tab-bar",
      "purpose": "Zero lint findings in the touched directories, from apps/desktop/orca"
    }
  ]
}
---

# DEVX-052 · The product is called Prime Agent in the UI; `pi` stays a command

## Outcome

Every label the user reads for this agent says "Prime Agent". The string `pi`
survives only where it is literally the command or an identifier, the way
`docker` is the command for Docker.

## Acceptance

- [ ] The new-tab menu entries currently reading `pi (spike)` and `pi (RPC)`
      (`TabBar.tsx:1292-1303`, including their `title` tooltips) name the product,
      and each one says what it opens rather than leaking the word "spike" at the
      user. The registered catalog agent shown as `Pi` is covered by DEVX-054 and
      must NOT be renamed here.
- [ ] The conversation column header (`PiChatColumn.tsx`, `HEADER_TITLE_KEY`,
      fallback `'pi'`) reads "Prime Agent", as do its `aria-label` and the close
      button's accessible name.
- [ ] Every translation key added or changed carries its new default in all five
      locale files (`en`, `es`, `ja`, `ko`, `zh`). A key present in `en.json` and
      missing elsewhere is a failure of this criterion.
- [ ] No identifier, testid, event name, env var, file name or directory is
      renamed: `PI_CHAT_OPEN_EVENT`, `pi-model-picker-trigger`,
      `flex-shell-open-providers`, `ORCA_PI_PROVIDER`, `src/main/pi-rpc/`,
      `components/pi-chat/` all stay exactly as they are. This task changes
      displayed text only.
- [ ] `tests/e2e/pi-shell-model-and-provider.spec.ts` still passes. It locates
      elements by testid, so it must not need edits; if it does, that is evidence
      criterion 4 was violated.

## Non-goals

- Do not rename `Orca` to `CoopCode` anywhere. That is DEVX-053, and doing it
  here would collide in the same locale files.
- Do not merge, remove or reorder the three pi menu entries. That is DEVX-054.
- Do not change the pi CLI invocation, its flags, or the RPC protocol.
- Do not change how the provider form stores anything. DEVX-055 rewrites that
  path and runs first; this task only relabels what it renders.

## Sources and decisions

- `apps/desktop/orca/src/renderer/src/components/tab-bar/TabBar.tsx:1292-1303` —
  the two menu entries and their tooltips.
- `apps/desktop/orca/src/renderer/src/components/pi-chat/PiChatColumn.tsx:44,131,137`
  — `HEADER_TITLE_KEY` used as both the section `aria-label` and the visible `h2`.
- `apps/desktop/orca/src/renderer/src/components/flex-shell/FlexShellRegion.tsx:25-29`
  — the shell's own tab-title and button keys.
- The product name is **Prime Agent**; `pi` is its CLI command
  (package `@earendil-works/pi-coding-agent`). Both names are correct in their
  own place, which is why criterion 4 forbids touching identifiers.

## Plan and test mapping

1. Enumerate every user-visible string in the four pi component directories plus
   the two `TabBar.tsx` entries before editing, so criterion 4 can be checked as
   a diff property. Criteria 1 and 2.
2. Change the fallbacks and add the locale entries in the same commit.
   Criterion 3.
3. Re-run the pi component suites and the existing e2e spec unchanged.
   Criterion 5.
4. Run the declared gates and write `docs/planning/evidence/DEVX-052-gate.json`
   per `docs/coop/gate-artifact-v1.md`.

## Handoff

Worker and reviewer return evidence to the dispatcher/state owner. Include the
list of changed strings and confirm from the diff that no identifier moved.
