---
{
  "id": "DEVX-053",
  "title": "Remove the Orca product name from everything the user sees, leaving CoopCode",
  "state": "ready",
  "lane": "standard",
  "priority": "P1",
  "risk": "high",
  "depends_on": ["DEVX-052"],
  "blocked_on": [],
  "capabilities": ["repository-read", "repository-write"],
  "scope": {"allow": [
    "apps/desktop/orca/src/renderer/src/**",
    "apps/desktop/orca/src/main/**",
    "apps/desktop/orca/config/electron-builder.config.cjs",
    "docs/planning/evidence/DEVX-053-gate.json"
  ]},
  "profiles": {"worker": "high", "reviewer": "high"},
  "budget": {"wall_minutes": 240, "attempts": 1, "reworks": 2},
  "gates": [
    {
      "command": "node tools/coop-dev/validate-task.mjs docs/coop/tasks/DEVX-053.md",
      "purpose": "Validate the task contract"
    },
    {
      "command": "node tools/coop-dev/validate-gate-artifact.mjs docs/planning/evidence/DEVX-053-gate.json",
      "purpose": "Prove gate evidence is bound to the result SHA"
    },
    {
      "command": "tools/pnpm-arm64.cmd run typecheck",
      "purpose": "All three tsc projects, from apps/desktop/orca"
    },
    {
      "command": "tools/pnpm-arm64.cmd exec vitest run --config config/vitest.config.ts",
      "purpose": "Full unit suite — string assertions are where this task breaks things, from apps/desktop/orca"
    },
    {
      "command": "tools/pnpm-arm64.cmd exec oxlint src",
      "purpose": "No new lint findings, from apps/desktop/orca"
    }
  ]
}
---

# DEVX-053 · The app never calls itself Orca in front of the user

## Outcome

Someone using the app sees only "CoopCode". Internal identifiers keep whatever
name they have; this task is about displayed text and the shipped executable.

## Acceptance

- [ ] Every user-visible occurrence of the product name `Orca` in
      `src/renderer/**` and `src/main/**` reads `CoopCode`. The current count is
      **399 lines across 207 files** (non-test `.ts`/`.tsx` matching the word as a
      quoted or rendered string). Report the number actually changed and account
      for any deliberately skipped.
- [ ] All five locale files are updated together. The current counts are
      `en 605`, `es 609`, `ja 601`, `ko 601`, `zh 610` occurrences. A locale left
      behind is a failure.
- [ ] `executableName: 'Orca'` in `config/electron-builder.config.cjs:281`
      becomes the product name, so the shipped binary is not `Orca.exe`.
      `productName`, `appId` and the package name are already `CoopCode` /
      `com.coopcode.app` / `coopcode` — do not change those.
- [ ] Nothing that carries state or identity across an upgrade is renamed:
      `ORCA_*` environment variables, `app.setName` / `userData` path resolution
      (`src/main/index.ts:704,712,1922`, `src/main/persistence.ts:332`),
      `orcaUi` IPC surfaces, the `orca-ui` pi skill directory, the `orca` CLI
      command name, directory names, and test fixture strings referencing the
      upstream repository. Renaming any of these silently migrates or orphans
      existing users' data — if one of them genuinely must change to satisfy
      criterion 1, stop and report it instead of changing it.
- [ ] The full unit suite passes. Several tests assert on product-name strings
      (for example `browser-notices.test.ts`, `palette-results.test.ts`,
      `browser-annotation-output.test.ts`); update the assertions with the copy,
      never by loosening them.

## Non-goals

- Do not rename the repository, the `apps/desktop/orca/` directory, or any file
  or folder. Path renames of this size are a separate decision.
- Do not touch the ~37k internal identifier occurrences outside the four groups
  named in criterion 4 — the point of this task is the user-facing surface only.
- Do not rename the pi agent labels; DEVX-052 owns those and runs first.
- Do not change the release feed, update channel, or anything about auto-update.

## Sources and decisions

- `apps/desktop/orca/config/electron-builder.config.cjs:21,106,107,281` —
  `appId` and `productName` are already CoopCode; `executableName` is not.
- `apps/desktop/orca/src/main/index.ts:704,712,1922` and
  `src/main/persistence.ts:332` — `app.setName` changes the resolved userData
  path; this is the concrete reason criterion 4 forbids touching it.
- Measured baselines for criteria 1 and 2 were taken on `2026-08-12` against
  `spike/pi-terminal-panel`; re-measure before starting and report any drift.
- `apps/desktop/orca/AGENTS.md` — design system and lint rules still apply.

## Plan and test mapping

1. Re-measure the two baselines and record them in the gate artifact before
   changing anything. Criteria 1 and 2.
2. Change renderer and main user-visible strings, then the five locale files in
   the same pass so they cannot drift. Criteria 1 and 2.
3. Change `executableName` and confirm from the builder config alone — do not
   run a full package build for this. Criterion 3.
4. Grep the diff for the criterion-4 groups and prove none appear.
   Criterion 4.
5. Run the full unit suite, fixing assertions alongside the copy they assert on.
   Criterion 5.
6. Run the declared gates and write `docs/planning/evidence/DEVX-053-gate.json`
   per `docs/coop/gate-artifact-v1.md`.

## Handoff

Worker and reviewer return evidence to the dispatcher/state owner. This task is
`high` risk because a careless global replace silently changes userData paths and
env var names, which loses user state on upgrade — the reviewer must check the
diff against criterion 4 specifically, not only that the suite is green.
