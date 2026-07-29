"""Secondary visual grounding used when primary browser coordinates become stale."""

from agent_ai.vision.gemini_locator import GeminiVisionFallbackLocator
from agent_ai.vision.ui_locator import (
    OpenRouterVisionFallbackLocator,
    VisionFallbackLocator,
    VisualTarget,
)

__all__ = [
    "GeminiVisionFallbackLocator",
    "OpenRouterVisionFallbackLocator",
    "VisualTarget",
    "VisionFallbackLocator",
]
