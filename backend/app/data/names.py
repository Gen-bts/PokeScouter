"""ポケモン名辞書ユーティリティ."""

from __future__ import annotations

import json
from pathlib import Path

_id_to_name_cache: dict[int, str] | None = None


def get_id_to_name() -> dict[int, str]:
    """ポケモンID→日本語名の逆引き辞書を取得する（キャッシュ付き）."""
    global _id_to_name_cache
    if _id_to_name_cache is None:
        # プロジェクトルート直下の data/names/ja.json を参照
        # __file__ = backend/app/data/names.py → 3つ上が backend/、4つ上がプロジェクトルート
        names_path = Path(__file__).resolve().parent.parent.parent.parent / "data" / "names" / "ja.json"
        if names_path.exists():
            with open(names_path, encoding="utf-8") as f:
                data = json.load(f)
            _id_to_name_cache = {v: k for k, v in data.get("pokemon", {}).items()}
        else:
            _id_to_name_cache = {}
    return _id_to_name_cache
