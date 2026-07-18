from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any, Protocol
from urllib.parse import quote, urlsplit, urlunsplit
from urllib.request import Request, urlopen


class HttpResponse(Protocol):
    def __enter__(self) -> HttpResponse: ...

    def __exit__(self, *_: Any) -> None: ...

    def read(self) -> bytes: ...


def close_orphaned_sessions(
    remote_url: str,
    *,
    timeout: float = 5.0,
    opener: Callable[..., HttpResponse] = urlopen,
) -> int:
    """Close sessions left in the dedicated Grid before this AI process started."""
    with opener(f"{_grid_origin(remote_url)}/status", timeout=timeout) as response:
        payload: Any = json.loads(response.read())

    session_ids = _active_session_ids(payload)
    for session_id in session_ids:
        request = Request(
            f"{remote_url.rstrip('/')}/session/{quote(session_id, safe='')}",
            method="DELETE",
        )
        with opener(request, timeout=timeout):
            pass
    return len(session_ids)


def _grid_origin(remote_url: str) -> str:
    parsed = urlsplit(remote_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Selenium remote URL must be an HTTP(S) URL")
    return urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))


def _active_session_ids(payload: Any) -> list[str]:
    if not isinstance(payload, dict) or not isinstance(payload.get("value"), dict):
        raise ValueError("Selenium status response is invalid")
    nodes = payload["value"].get("nodes", [])
    if not isinstance(nodes, list):
        raise ValueError("Selenium status nodes are invalid")

    session_ids: list[str] = []
    for node in nodes:
        if not isinstance(node, dict) or not isinstance(node.get("slots", []), list):
            continue
        for slot in node.get("slots", []):
            session = slot.get("session") if isinstance(slot, dict) else None
            session_id = session.get("sessionId") if isinstance(session, dict) else None
            if isinstance(session_id, str) and session_id and session_id != "reserved":
                session_ids.append(session_id)
    return session_ids
