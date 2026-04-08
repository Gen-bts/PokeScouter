"""ヘルスチェック API."""

from __future__ import annotations

from fastapi import APIRouter

from app.dependencies import get_recognizer

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
def health() -> dict[str, object]:
    """サーバ状態を返す."""
    recognizer = get_recognizer()
    return {
        "status": "ok",
        "engines_loaded": len(recognizer._engines) > 0,
        "scenes": recognizer._config.scenes,
    }
