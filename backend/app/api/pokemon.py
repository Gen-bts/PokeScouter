"""ポケモンデータ API."""

from __future__ import annotations

from fastapi import APIRouter, Query

from app.dependencies import get_game_data

router = APIRouter(prefix="/api/pokemon", tags=["pokemon"])


@router.get("/names")
def get_pokemon_names(lang: str = Query("ja")) -> dict:
    """指定言語のポケモン名辞書を返す（オートコンプリート用）."""
    game_data = get_game_data()
    lang_data = game_data.names.get(lang, {})
    return {"pokemon": lang_data.get("pokemon", {})}
