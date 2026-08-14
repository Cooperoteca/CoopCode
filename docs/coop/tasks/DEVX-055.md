---
{
  "id": "DEVX-055",
  "title": "Register providers in pi's models.json instead of generating a TypeScript extension, and list what is already registered",
  "state": "ready",
  "lane": "high-risk",
  "priority": "P0",
  "risk": "high",
  "depends_on": [],
  "blocked_on": [],
  "capabilities": ["repository-read", "repository-write"],
  "scope": {"allow": [
    "apps/desktop/orca/src/main/pi-rpc/**",
    "apps/desktop/orca/src/shared/pi-rpc.ts",
    "apps/desktop/orca/src/preload/index.ts",
    "apps/desktop/orca/src/preload/api-types.ts",
    "apps/desktop/orca/src/renderer/src/components/pi-providers/**",
    "apps/desktop/orca/tests/e2e/pi-shell-model-and-provider.spec.ts",
    "docs/planning/evidence/DEVX-055-gate.json"
  ]},
  "profiles": {"worker": "high", "reviewer": "high"},
  "budget": {"wall_minutes": 180, "attempts": 1, "reworks": 2},
  "gates": [
    {
      "command": "node tools/coop-dev/validate-task.mjs docs/coop/tasks/DEVX-055.md",
      "purpose": "Validate the task contract"
    },
    {
      "command": "node tools/coop-dev/validate-gate-artifact.mjs docs/planning/evidence/DEVX-055-gate.json",
      "purpose": "Prove gate evidence is bound to the result SHA"
    },
    {
      "command": "tools/pnpm-arm64.cmd exec vitest run --config config/vitest.config.ts src/main/pi-rpc",
      "purpose": "Writer unit suite including the merge and corruption cases, from apps/desktop/orca"
    },
    {
      "command": "tools/pnpm-arm64.cmd exec vitest run --config config/vitest.renderer.config.ts src/renderer/src/components/pi-providers",
      "purpose": "Form unit suite, from apps/desktop/orca"
    },
    {
      "command": "tools/pnpm-arm64.cmd exec tsc --noEmit -p config/tsconfig.node.json",
      "purpose": "Typecheck, from apps/desktop/orca"
    },
    {
      "command": "tools/pnpm-arm64.cmd exec oxlint src/main/pi-rpc src/renderer/src/components/pi-providers",
      "purpose": "Zero lint findings in the touched directories, from apps/desktop/orca"
    },
    {
      "command": "tools/pnpm-arm64.cmd exec electron-vite build --mode e2e",
      "purpose": "Build the out/ tree the e2e harness needs, from apps/desktop/orca"
    },
    {
      "command": "tools/pnpm-arm64.cmd exec playwright test --config tests/playwright.config.ts --project=electron-headless pi-shell-model-and-provider",
      "purpose": "Prove the form writes models.json for real, from apps/desktop/orca with SKIP_BUILD=1 and ORCA_E2E_HEADLESS=1"
    }
  ]
}
---

# DEVX-055 · Providers are data in models.json, not generated code

## Outcome

Saving a provider writes an entry in `~/.prime/agent/models.json`, the file pi
already defines and validates for exactly this, and the form shows which
providers are registered there.

## Acceptance

- [ ] Saving writes `providers["<id>"]` into `~/.prime/agent/models.json` with
      `name`, `baseUrl`, `apiKey`, `api` and `models[]`, matching
      `ProviderConfigSchema` (`model-registry.ts:193-206` in the pi source).
      No `.ts` file is generated any more; `extension-writer.ts`'s code-emitting
      path goes away rather than staying behind as a second writer.
- [ ] Saving never damages the file, proven by three unit tests against a temp
      directory. **Merge**: starting from a file holding two providers, saving a
      third leaves all three — the writer merges into the existing `providers`
      map and never rewrites the file from the form's state. **Atomicity**: the
      write goes to a temporary file in the same directory and is renamed over
      the target, so a failure mid-write leaves the original untouched.
      **Refusal**: a malformed or non-JSON `models.json` is never overwritten;
      the save fails with a message naming the file, so the user can repair it by
      hand — which is the point of the format being data.
- [ ] The credential rule is unchanged and still enforced in the main process,
      not only in the form: `apiKey` receives an environment variable NAME or a
      `!command`, and anything that looks like a raw key is refused. This
      transfers as-is because `models.json`'s `apiKey` goes through the same
      `resolveConfigValue` (`resolve-config-value.ts:17-23`) that the extension
      path used. Keep `looksLikeRawApiKey` and its tests.
- [ ] The form lists the providers currently in `models.json` — id, display name
      and model count — and saving an id that already exists overwrites that
      entry. Reading back is the payoff of this migration; a form that still only
      writes has not delivered it.
- [ ] `tests/e2e/pi-shell-model-and-provider.spec.ts` is updated to assert
      against `models.json` instead of `extensions/<id>.ts`, and both of its
      tests pass. The model-picker test must keep passing untouched in substance.

## Non-goals

- Do not migrate, rewrite or delete existing `~/.prime/agent/extensions/*.ts`.
  They keep working — pi loads both — and the user's hand-written `clinepass.ts`
  must not be touched. Converting them is a separate decision.
- Do not add a delete button. Overwriting by id covers editing, and a JSON file
  the user can open is exactly what makes deletion by hand acceptable here.
- Do not expose `headers`, `modelOverrides`, `compat` or `authHeader` in the
  form yet, even though `models.json` supports them. Add them when something
  needs them.
- Do not build a CoopCode-side database or JSON store of providers. `models.json`
  is the store; a second copy would only be able to drift from it.
- Do not change the model picker, the conversation column, or the RPC protocol.

## Sources and decisions

- pi source `packages/coding-agent/src/core/model-registry.ts:193-207` —
  `ProviderConfigSchema` and `ModelsConfigSchema`; the contract this task writes.
- pi source `packages/coding-agent/src/config.ts:613-615` — `getModelsPath()`
  resolves to `<agentDir>/models.json`, and `CONFIG_DIR_NAME` defaults to
  `.prime/agent` (`config.ts:508`). Resolve the path the same way rather than
  hardcoding it; the main process already resolves the extensions dir from
  `homedir()` in `extensions-ipc.ts:27`.
- pi source `packages/coding-agent/src/core/resolve-config-value.ts:17-23` — the
  `!command` / env-var / literal resolution, identical for both mechanisms, which
  is why criterion 5 is a transfer and not a redesign.
- pi source `packages/coding-agent/src/core/auth-storage.ts:64-65,296-299,816` —
  `models_json_key` and `models_json_command` auth source types and the fallback
  resolver, confirming models.json custom providers are a supported first-class
  path, not a workaround.
- `apps/desktop/orca/src/main/pi-rpc/extension-writer.ts` — the current writer;
  its validation is sound and should survive, its code generation should not.
- `apps/desktop/orca/tests/e2e/pi-shell-model-and-provider.spec.ts` — the
  existing end-to-end proof; note its header comment about the harness isolating
  HOME, which is why the target path must come from the main process.

## Plan and test mapping

1. Read `ProviderConfigSchema` in the pi source before writing the type. Do not
   infer the shape from the current TypeScript emitter. Criterion 1.
2. Replace the emitter with a read-merge-write of `models.json`, keeping
   `validateProviderExtensionSpec` and `looksLikeRawApiKey`. Criteria 1, 3.
3. Unit test the merge, the atomic write failure, and the malformed-file refusal
   against a temp directory. Criterion 2.
4. Add a read path and render the list in the form. Criterion 4.
5. Update the e2e spec's assertions and run it. Criterion 5.
6. Run the declared gates and write `docs/planning/evidence/DEVX-055-gate.json`
   per `docs/coop/gate-artifact-v1.md`.

## Running the tests

No packaged build is needed; `pnpm run build:win` is irrelevant here. The e2e
gate needs the `out/` tree built with `--mode e2e` — that mode is what exposes
`window.__store`, and a tree built any other way makes every spec hang for 30s on
`waitForFunction(() => Boolean(window.__store))` (see `tests/e2e/AGENTS.md`,
which warns this looks like a broken harness and is not one). Build once, then
run with `SKIP_BUILD=1` and `ORCA_E2E_HEADLESS=1`.

The runner exits non-zero on a `global-teardown` `EBUSY` while removing its temp
repo on Windows, after the tests have passed. Read the `N passed` line rather
than the exit code alone, and say which you relied on in the evidence.

## Handoff

Worker and reviewer return evidence to the dispatcher/state owner. This task is
`high` risk for one reason: `models.json` holds every provider the user has, so a
writer that rewrites instead of merging, or that truncates on failure, destroys
working configuration rather than failing to add to it. The reviewer must check
the merge and atomicity tests specifically, not only that the suites are green.

## Review (attempt 1)

- Reviewer: prime-agent (coop-reviewer)
- Date: 2026-08-14
- Result SHA reviewed: `6c93b9efd9a09bfebe80298a84c3c47cc8cd474a`
- Decision: `accept`
- Findings:
  - INFO — `apps/desktop/orca/src/main/pi-rpc/models-json-writer.ts` — `readModelsJsonDocument` strips `//` comments/trailing commas on read (matching pi's own `stripJsonComments`), and the writer re-serializes via `JSON.stringify(nextDocument, null, 2)`, so a hand-edited `models.json` with comments is normalized (comments dropped) on the next save. Providers are preserved (merge is correct), so this is cosmetic, not data loss. — criterion: 2 (non-blocking)
