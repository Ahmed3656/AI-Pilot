from __future__ import annotations

import json
from typing import Any
from urllib.request import Request

from agent_ai.browser.session_cleanup import close_orphaned_sessions


class FakeResponse:
    def __init__(self, payload: dict[str, Any] | None = None) -> None:
        self.payload = payload

    def __enter__(self) -> FakeResponse:
        return self

    def __exit__(self, *_: Any) -> None:
        return None

    def read(self) -> bytes:
        return json.dumps(self.payload).encode() if self.payload is not None else b""


def test_closes_sessions_reported_by_the_dedicated_grid() -> None:
    requests: list[str | Request] = []

    def opener(request: str | Request, **_: Any) -> FakeResponse:
        requests.append(request)
        if isinstance(request, str):
            return FakeResponse(
                {
                    "value": {
                        "nodes": [
                            {
                                "slots": [
                                    {"session": {"sessionId": "stale-session"}},
                                    {"session": None},
                                ]
                            }
                        ]
                    }
                }
            )
        return FakeResponse()

    assert (
        close_orphaned_sessions(
            "http://browser:4444/wd/hub",
            opener=opener,
        )
        == 1
    )
    assert requests[0] == "http://browser:4444/status"
    assert isinstance(requests[1], Request)
    assert requests[1].full_url == "http://browser:4444/wd/hub/session/stale-session"
    assert requests[1].method == "DELETE"


def test_ignores_a_slot_reserved_during_session_creation() -> None:
    def opener(request: str | Request, **_: Any) -> FakeResponse:
        assert isinstance(request, str)
        return FakeResponse(
            {"value": {"nodes": [{"slots": [{"session": {"sessionId": "reserved"}}]}]}}
        )

    assert close_orphaned_sessions("http://browser:4444/wd/hub", opener=opener) == 0
