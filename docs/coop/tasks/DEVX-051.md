---
{
  "id": "DEVX-051",
  "title": "Let the user resize the pi shell region instead of locking it at 40% of the central column",
  "state": "ready",
  "lane": "standard",
  "priority": "P2",
  "risk": "routine",
  "depends_on": [],
  "blocked_on": [],
  "capabilities": ["repository-read", "repository-write"],
  "scope": {"allow": [
    "apps/desktop/orca/src/renderer/src/components/flex-shell/**",
    "apps/desktop/orca/src/renderer/src/store/slices/ui.ts",
    "apps/desktop/orca/tests/e2e/pi-shell-resize.spec.ts",
    "docs/planning/evidence/DEVX-051-gate.json"
  ]},
  "profiles": {"worker": "routine", "reviewer": "routine"},
  "budget": {"wall_minutes": 90, "attempts": 1, "reworks": 1},
  "gates": [
    {
      "command": "node tools/coop-dev/validate-task.mjs docs/coop/tasks/DEVX-051.md",
      "purpose": "Validate the task contract"
    },
    {
      "command": "node tools/coop-dev/validate-gate-artifact.mjs docs/planning/evidence/DEVX-051-gate.json",
      "purpose": "Prove gate evidence is bound to the result SHA"
    },
    {
      "command": "tools/pnpm-arm64.cmd exec vitest run --config config/vitest.renderer.config.ts src/renderer/src/components/flex-shell",
      "purpose": "Unit coverage for the height clamp and persistence, from apps/desktop/orca"
    },
    {
      "command": "tools/pnpm-arm64.cmd exec tsc --noEmit -p config/tsconfig.node.json",
      "purpose": "Typecheck, from apps/desktop/orca"
    },
    {
      "command": "tools/pnpm-arm64.cmd exec oxlint src/renderer/src/components/flex-shell",
      "purpose": "Zero lint findings in the touched directory, from apps/desktop/orca"
    }
  ]
}
---

# DEVX-051 · The pi shell region is user-resizable and remembers its height

## Outcome

The user can drag the top edge of the pi shell region to change its height, and
the chosen height survives closing and reopening the region and restarting the
app.

## Acceptance

- [ ] Dragging the top edge of the region changes its height live, and releasing
      keeps it. Today `FlexShellRegion.tsx:118` hardcodes
      `style={{ height: '40%' }}` on a `shrink-0` div with no handle at all.
- [ ] The height is clamped so the region can never be dragged to zero, nor so
      tall that the terminals above it collapse. Pick concrete minimums, state
      them in the task handoff, and cover both bounds with unit tests.
- [ ] The height persists through the store's existing UI persistence pipeline —
      the same one `flexShellLayout` already uses (`ui.ts:592-999`,
      `setFlexShellLayout`), not a new persistence mechanism.
- [ ] Closing the last tab still unmounts the region and returns the full height
      to the terminals (current behavior, `handleModelChange`). A persisted
      height must not resurrect the region on next launch.
- [ ] Keyboard accessibility: the handle is focusable and responds to
      Arrow Up/Down. A drag-only handle is not acceptable.

## Non-goals

- Do not add a new dependency for resizable panels. Two in-repo patterns already
  exist to follow: `components/floating-terminal/FloatingTerminalResizeHandles.tsx`
  and `components/github-project/ColumnResizeHandle.tsx`. Pick whichever fits and
  say why in the handoff.
- Do not change what the region contains, how tabs open, or the FlexLayout model.
  Only the region's outer height and its handle.
- Do not make the region dockable to another edge or floatable.

## Sources and decisions

- `apps/desktop/orca/src/renderer/src/components/flex-shell/FlexShellRegion.tsx:115-120`
  — the hardcoded `height: '40%'` and `shrink-0` this task removes.
- `apps/desktop/orca/src/renderer/src/store/slices/ui.ts:592-594, 998-999` —
  `flexShellLayout` and `setFlexShellLayout`, the persistence seam to reuse.
- `apps/desktop/orca/src/renderer/src/components/floating-terminal/FloatingTerminalResizeHandles.tsx`
  and `components/github-project/ColumnResizeHandle.tsx` — the two existing
  resize implementations; there is no `components/ui/resizable.tsx` in this repo.
- `apps/desktop/orca/AGENTS.md` — design system rules; use existing tokens, and
  never add a `max-lines` disable.

## Plan and test mapping

1. Read both existing resize handle implementations before writing one.
   No criterion; prevents a third pattern being invented.
2. Extract the height into state with clamp helpers as pure functions, unit
   tested for both bounds. Criteria 1 and 2.
3. Wire persistence through the existing `ui.ts` seam; unit test that a
   persisted height rehydrates and that an unmounted region stays unmounted.
   Criteria 3 and 4.
4. Add keyboard handling on the focusable handle, unit tested. Criterion 5.
5. Add `tests/e2e/pi-shell-resize.spec.ts` asserting the height changes from the
   DOM after a drag — per `tests/e2e/AGENTS.md`, the final assertion must be
   user-observable, not a store read.
6. Run the declared gates and write `docs/planning/evidence/DEVX-051-gate.json`
   per `docs/coop/gate-artifact-v1.md`.

## Handoff

Worker and reviewer return evidence to the dispatcher/state owner. State the
clamp bounds chosen and which existing resize pattern was reused. If the
persistence seam turns out not to fit the height (for example because the
FlexLayout model JSON owns it), report that as a finding rather than adding a
parallel persistence path.
