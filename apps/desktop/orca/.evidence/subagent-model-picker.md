# Subagent report: model-picker (Phase 3a - model picker UI)

Feature: clickable provider/model picker in the pi conversation column header.
Scope is UI-only against the existing wire protocol (`src/shared/pi-rpc.ts` +
main-process client). No commits, no full gates (`test:main/test:renderer/
typecheck/lint`); only `vitest` on the owned files via
`config/vitest.renderer.config.ts`.

## Files touched

Created (all under `apps/desktop/orca/src/renderer/src/components/pi-chat/`):
- `PiChatModelPicker.tsx` - the header picker component (get_state on mount,
  lazy get_available_models on open w/ cache + loading/error, set_model on
  select -> updates header from response). Uses house `DropdownMenu`,
  `DropdownMenuItem`, `Button`, lucide icons; renders nothing at rest beyond
  the ghost trigger; returns a compact trigger showing `provider/modelId`.
- `pi-rpc-request.ts` - correlation helper: unique `id`, subscribe `api.onFrame`,
  resolve `data` on matching `response` frame, 10s timeout, unsubscribe on
  settle; rejects on `success:false` and on send failure.
- `pi-model-catalog.ts` - `PiRpcModel` projection + pure `groupModelsByProvider`,
  `compareModels`, `modelLabel`, `projectModel` (provider grouping, featured
  first then alpha).
- `pi-rpc-request.test.ts` - 11 unit tests (correlation, wrong-id ignored,
  success:false, timeout, send-failure, unsubscribe, id uniqueness).
- `pi-model-catalog.test.ts` - 9 unit tests (group/sort/label/project).
- `PiChatModelPicker.test.tsx` - 5 component tests (happy-dom; mocked
  dropdown/button/i18n; fake piRpc preload surface).

Edited:
- `src/renderer/src/components/pi-chat/PiChatColumn.tsx` - header-only wiring:
  1 import line + `{api ? <PiChatModelPicker api={api}/> : null}` between the
  `h2` and the status badge, plus a `w-px bg-border/60` separator span. No other
  part of the file changed.

## Decisions
- **Wire contract confirmed from source** (`src/shared/pi-rpc.ts`):
  `get_state`, `get_available_models` (no args), `set_model {provider,
  modelId}` all carry optional `id?`; response echoes that `id`. Preload
  `PiRpcApi.onFrame(cb)` -> unsubscribe with `{kind:'frame';payload}`.
- **Model shape**: projected only the fields actually rendered, mirroring
  `@earendil-works/pi-ai` `Model` (`id, name, api, provider, reasoning,
  featured, contextWindow, maxTokens`). Unknown/malformed model -> placeholder.
- **Lazy fetch + cache**: `get_available_models` sent on first dropdown open
  and cached in a ref for the component lifetime (no refetch on re-open, no
  flood on toggle).
- **get_state failures are swallowed** on mount: the conversation column owns
  connect errors; the picker stays on the "No model" placeholder.
- **Provider labels in the menu** are rendered verbatim (provider proper
  nouns, not translated).
- **Type safety**: `PiRpcApi` is structurally assignable to the minimal
  `PiRpcSender` used by `requestRpc` (identical `send`/`onFrame` signatures).
  Type-only import from `../../../preload/api-types` (file is included in
  `config/tsconfig.web.json`).
- **Design tokens / STYLEGUIDE**: compact ghost trigger, `h-6 max-w-[180px]`,
  `text-muted-foreground hover:text-foreground`, `border-border/60` separator,
  truncating label - following the pi-chat header and `src/renderer/src/assets/
  main.css` tokens.

## i18n keys (prefix `auto.components.pi.chat.PiChatModelPicker.`)
> Locale JSON files were NOT edited; these are the keys the component reads and
> the fallback literals. New keys added by this feature:

| key | fallback |
|-----|----------|
| `title` | `Model` |
| `noModel` | `No model` |
| `loadingModels` | `Loading models…` |
| `modelsError` | `Could not load models: {{error}}` |
| `currentModel` | `Current: {{model}}` |
| `menuLabel` | (dynamic: `Current: {{model}}` when a model is set, else `No model`) |

The `.menuLabel` key never renders static text; it delegates to
`.noModel`/`.currentModel` for the actual copy.

## Test results
Command (run from `apps/desktop/orca`):
`npx vitest run --config config/vitest.renderer.config.ts src/renderer/src/
components/pi-chat`

Result: **3 test files passed, 25 tests passed** (0 failed).

- `pi-rpc-request.test.ts` - 11 passed
- `pi-model-catalog.test.ts` - 9 passed
- `PiChatModelPicker.test.tsx` - 5 passed

(Only owned files under `src/renderer/src/components/pi-chat/` were run.)
