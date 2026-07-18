"""Per-run AI orchestration and canonical control-plane client."""

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from agent_ai.orchestrator.manager import RunManager

__all__ = ["RunManager"]


def __getattr__(name: str) -> Any:
    """Load the manager lazily so ranking can be imported without a cycle."""
    if name != "RunManager":
        raise AttributeError(name)
    from agent_ai.orchestrator.manager import RunManager

    return RunManager
