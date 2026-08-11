# Subagent Report — history-panel (Phase 2 renderer)

**Agent:** history-panel
**Repo:** CoopCode/Orca — `apps/desktop/orca`
**Branch:** `spike/pi-terminal-panel`
**Date:** 2026-08-11

## Scope (Phase 2 renderer)
Session-history tab in the FlexLayout pi shell: list sessions from the main
process (`piSessions.list`), render a project → branch → sessions collapsible
tree with dense styling, and switch the live pi session back to an older one via
`piRpc.send({ type:'switch_session', sessionPath, id })`, correlating the
`{command:'switch_session'}` response frame.

## Files touched
### Created (owned: `src/renderer/src/components/pi-history/**`)
- `src/renderer/src/components/pi-history/pi-history-view-model.ts` — pure module.
- `src/renderer/src/components/pi-history/pi-history-view-model.test.ts` — unit tests.
- `src/renderer/src/components/pi-history/PiHistoryPanel.tsx` — React component.
- `src/renderer/src/components/pi-history/pi-history-panel.component.test.tsx` — happy-dom component test.

### Edited (owned: only these two)
- `src/renderer/src/components/flex-shell/flex-shell-model.ts`
- `src/renderer/src/components/flex-shell/FlexShellRegion.tsx`

### Untouched
`pi-chat/*`, `pi-providers/*`, `src/main/*`, `preload`, `shared`, and all locale
JSONs. `git status` confirms no other owned path was modified.

## Decisions
1. **No re-grouping.** `piSessions.list()` data is already grouped/ordered by the
   main process; `buildPiHistoryViewModel` only decorates each bucket (time label,
   short id, null-branch label, session count). Structure is copied, never rebuilt.
2. **Pure display view-model.** All shaping and the `switch_session` response
   classifier live in `pi-history-view-model.ts`, keeping `PiHistoryPanel.tsx` a
   thin shell and the logic unit-testable without DOM/preload. Includes a bugfix
   so the null-branch bucket always gets the translated label.
3. **Switch correlation.** Panel holds one pending switch (ref) with a ~10 s
   timeout. It listens on `api.onFrame`, classifies only `switch_session`
   responses via the echo `id`, and treats `cancelled` as neutral feedback (never
   error). `success:false` or a timeout map to `error`. Conversation refresh stays
   owned by pi-chat; this panel only reports switch acceptance.
4. **Fixed tab ids + select-if-exists.** Added `SHELL_TAB_ID` and
   `buildShellTabJson` in `flex-shell-model.ts`. `openTab` selects an existing tab
   via `getNodeById`/`Actions.selectTab` instead of duplicating, otherwise adds to
   the active tabset (`getActiveTabset ?? getFirstTabSet`) with
   `Actions.addTab(node, tabsetId, DockLocation.CENTER, -1, true)`.
5. **Inline tab content.** History renders as a flexlayout tab (inline), not a
   fullscreen overlay, so it cannot trap pointer events.
6. **Renderers.** Only `pi-chat` and `historico` are registered. `providers` is not
   wired (later phase) and falls through to FlexShell's unknown-tab placeholder.
7. **API verification against .d.ts.** `Actions.addTab(json,toNodeId,location,index,select?)`,
   `Actions.selectTab(id)`, `Model.getNodeById`, `Model.getActiveTabset`,
   `Model.getFirstTabSet`, `Model.doAction`, `DockLocation.CENTER` all confirmed in
   `node_modules/flexlayout-react/types/**`.

## Visível/house styles used
`border-border/60`, `text-muted-foreground`, `scrollbar-sleek`, `bg-background`,
`hover:bg-accent`, `bg-muted/30`, `text-[10px]`, `tabular-nums`. Refresh button uses
the `Button` ghost + `icon-sm` variant (verified in button.tsx: size includes
`'icon-sm'`).

## i18n keys (complete — none added to locale JSONs; all use `translate(key, fallback)`)
All under convention `auto.components.<path>.<Component>.<suffix>`:

### PiHistoryPanel (`auto.components.pi.history.PiHistoryPanel.*`)
| Key | Fallback |
| --- | --- |
| `.title` | `pi history` |
| `.refresh` | `Refresh` |
| `.loading` | `Loading sessions…` |
| `.loadError` | `Could not load session history: {{error}}` |
| `.empty` | `No pi sessions yet.` |
| `.noBranch` | `No branch` |
| `.switching` | `Switching session…` |
| `.switchDone` | `Switched to {{session}}` |
| `.switchCancelled` | `Session switch cancelled` |
| `.switchError` | `Could not switch session` |
| `.switchTimeout` | `Session switch timed out` |
| `.sessionCount` | `{{count}} sessions` |

### FlexShellRegion (new keys, `auto.components.flexshell.FlexShellRegion.*`)
| Key | Fallback |
| --- | --- |
| `.openHistory` | `History` |
| `.openProviders` | `Providers` |
| `.historyTabTitle` | `History` |
| `.providersTabTitle` | `Providers` |
| `.conversa` (pre-existing) | `Conversa` |

## Test results
Command (run from `apps/desktop/orca`):
```
npx vitest run --config config/vitest.renderer.config.ts src/renderer/src/components/pi-history src/renderer/src/components/flex-shell
```
Result: **3 files passed, 20/20 tests green** (exit 0).

- `pi-history/pi-history-view-model.test.ts` — 10 passed (grouping preserved,
  null-branch label, formatters, empty input, `parsePiSwitchResponse`
  done/cancelled/error/null classifiers).
- `pi-history/pi-history-panel.component.test.tsx` — 4 passed (tree renders from
  fixture, null-branch label, click sends `switch_session` with exact
  `sessionPath`, refresh re-lists).
- `flex-shell/flex-shell-model.test.ts` — 6 passed (pre-existing test still green;
  `normalizeShellModelJson` behavior unchanged).

No parent gates run. No commit made. Locale JSONs untouched.
