"""Draw declarative Orca UI panels from the `pi` agent.

The `pi` agent runs as a TUI in a pseudo-terminal, so Orca only sees rendered
terminal bytes. This skill talks to the Orca main-process loopback HTTP server
(started automatically by Orca) to render declarative panels (kanban, table,
markdown) inside the Orca window and to read/write small UI state.

The server address and token are provided as environment variables by Orca:
    ORCA_UI_PORT  - the loopback TCP port (127.0.0.1)
    ORCA_UI_TOKEN - the per-session bearer token

If either variable is missing, every function raises ``OrcaUiNotConfigured``.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

__all__ = ["render", "get_state", "set_state", "OrcaUiNotConfigured", "OrcaUiError"]


class OrcaUiNotConfigured(RuntimeError):
    """Raised when ORCA_UI_PORT / ORCA_UI_TOKEN are not in the environment."""


class OrcaUiError(RuntimeError):
    """Raised when the Orca UI server returns a non-success response."""


def _base_url() -> str:
    port = os.environ.get("ORCA_UI_PORT")
    token = os.environ.get("ORCA_UI_TOKEN")
    if not port or not token:
        raise OrcaUiNotConfigured(
            "ORCA_UI_PORT and ORCA_UI_TOKEN must be set. Launch pi through the "
            "Orca terminal so Orca exports the panel server connection info."
        )
    return f"http://127.0.0.1:{port}"


def _request(method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    token = os.environ.get("ORCA_UI_TOKEN") or ""
    url = f"{_base_url()}{path}"
    data = None
    headers = {"Authorization": f"Bearer {token}"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            body = response.read()
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise OrcaUiError(f"Orca UI {method} {path} failed with {error.code}: {detail}") from error
    except urllib.error.URLError as error:
        raise OrcaUiError(f"Could not reach Orca UI server at {url}: {error}") from error


def render(panel_id: str, spec: dict[str, Any]) -> dict[str, Any]:
    """Render a declarative panel with the given panel id.

    Args:
        panel_id: An agent-chosen stable id used to address the panel (a later
            ``render`` with the same id updates/reopens it).
        spec: A declarative panel spec. One of:

            kanban::
                {"type": "kanban", "title": "Sprint", "columns": [
                    {"id": "todo", "title": "To Do", "cards": [
                        {"id": "c1", "title": "Task A", "body": "optional"}]}]}

            table::
                {"type": "table", "title": "Results", "columns": ["Name", "Count"],
                 "rows": [["a", 3], ["b", 1]]}

            markdown::
                {"type": "markdown", "title": "Notes", "markdown": "# Hi\nbody"}

    Returns:
        The server response (``{ok, panelId, delivered, panels}``).
    """
    return _request("POST", "/ui/render", {"panelId": panel_id, "spec": spec})


def get_state(key: str) -> Any:
    """Read a previously stored UI state value by key.

    Returns the stored value, or raises :class:`OrcaUiError` if the key does not
    exist.
    """
    return _request("GET", f"/ui/state/{key}").get("value")


def set_state(key: str, value: Any) -> dict[str, Any]:
    """Store a UI state value under ``key`` (overwrites any previous value)."""
    return _request("POST", f"/ui/state/{key}", {"value": value})
