"""アイテムデータ API."""

from __future__ import annotations

from fastapi import APIRouter, Query

from app.dependencies import get_game_data

router = APIRouter(prefix="/api/item", tags=["item"])


@router.get("/names")
def get_item_names(lang: str = Query("ja")) -> dict:
    """全アイテムの key ↔ 名前マップを返す (autocomplete 用)."""
    game_data = get_game_data()
    lang_items = game_data.names.get(lang, {}).get("items", {})
    items = [
        {"key": str(key), "name": str(name)}
        for name, key in lang_items.items()
        if not str(key).startswith("_")
    ]
    items.sort(key=lambda m: m["name"])
    return {"items": items}
