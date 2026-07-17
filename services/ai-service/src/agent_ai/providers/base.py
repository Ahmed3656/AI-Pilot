from typing import Any, Protocol


class AIProvider(Protocol):
    """Minimal provider boundary; it intentionally defines no product operation."""

    @property
    def name(self) -> str: ...

    async def health(self) -> dict[str, Any]: ...
