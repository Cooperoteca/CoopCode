---
name: orca-ui
description: Draw declarative UI panels (kanban, table, markdown) inside the Orca window from the pi agent, and read/write small UI state, via the local loopback Orca UI server.
---

# Orca UI

The `pi` agent runs as a TUI in a pseudo-terminal, so Orca only sees rendered
terminal bytes. This skill lets the agent draw real UI panels inside the Orca
window using a local loopback HTTP server that Orca starts and secures with a
per-session token.

Call directly from the kernel:

```python
import orca_ui

orca_ui.render("demo", {"type": "markdown", "title": "Notes", "markdown": "# Hello"})
orca_ui.set_state("pi.session", {"step": 3})
```

## API

- `orca_ui.render(panel_id, spec)` — draw/update a panel. `spec` is one of the
  three declarative panel types: `kanban`, `table`, or `markdown` (see the
  module docstring for shapes). Returns `{ok, panelId, delivered, panels}`.
- `orca_ui.get_state(key)` — read a previously stored UI state value.
- `orca_ui.set_state(key, value)` — store a UI state value (any JSON-serializable).

## Environment

Orca exports `ORCA_UI_PORT` and `ORCA_UI_TOKEN` to terminal children. If either
is missing, calls raise `OrcaUiNotConfigured`. Orca must be running with a
terminal session open for this to work.

## Safety

- The server binds only to 127.0.0.1; never change the host.
- The token is per-session and random; do not log or print it.
- Keep panel specs small and declarative; there is no JSX/eval path.
