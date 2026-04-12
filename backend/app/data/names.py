"""Localized Pokemon name helpers."""

from __future__ import annotations

import json
from pathlib import Path

_key_to_name_cache: dict[str, dict[str, str]] = {}


def get_id_to_name(lang: str = "ja") -> dict[str, str]:
    """Return a Showdown key -> Japanese name mapping.

    The historical function name is kept because several callers still import
    it directly, but the mapping now uses Showdown keys rather than numeric
    identifiers.
    """
    try:
        from app.dependencies import get_game_data

        mapping = get_game_data().get_pokemon_key_to_name_map(lang)
        _key_to_name_cache[lang] = mapping
        return mapping
    except Exception:
        pass

    cached = _key_to_name_cache.get(lang)
    if cached is not None:
        return cached

    data_dir = Path(__file__).resolve().parent.parent.parent.parent / "data"
    names_path = data_dir / "names" / f"{lang}.json"

    if not names_path.exists():
        _key_to_name_cache[lang] = {}
        return _key_to_name_cache[lang]

    with open(names_path, encoding="utf-8") as f:
        names_data = json.load(f)

    _key_to_name_cache[lang] = {
        str(key): name for name, key in names_data.get("pokemon", {}).items()
    }
    return _key_to_name_cache[lang]
