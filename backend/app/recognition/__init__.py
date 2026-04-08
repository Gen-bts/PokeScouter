"""シーン認識モジュール.

テンプレートマッチングによるシーン検出と、
階層型ステートマシンによるシーン自動判定を提供する。
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.recognition.pokemon_matcher import MatchResult, PokemonMatcher
    from app.recognition.scene_detector import DetectionResult, SceneDetector
    from app.recognition.scene_state import SceneState, SceneStateMachine


def __getattr__(name: str) -> object:  # noqa: N807
    """遅延インポート（GPU 関連の依存を必要になるまで読み込まない）."""
    if name in ("SceneState", "SceneStateMachine"):
        from app.recognition.scene_state import SceneState, SceneStateMachine

        return {"SceneState": SceneState, "SceneStateMachine": SceneStateMachine}[name]
    if name in ("SceneDetector", "DetectionResult"):
        from app.recognition.scene_detector import DetectionResult, SceneDetector

        return {"SceneDetector": SceneDetector, "DetectionResult": DetectionResult}[name]
    if name in ("PokemonMatcher", "MatchResult"):
        from app.recognition.pokemon_matcher import MatchResult, PokemonMatcher

        return {"PokemonMatcher": PokemonMatcher, "MatchResult": MatchResult}[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "DetectionResult",
    "MatchResult",
    "PokemonMatcher",
    "SceneDetector",
    "SceneState",
    "SceneStateMachine",
]
