"""わざデータ API."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.dependencies import get_game_data

router = APIRouter(prefix="/api/move", tags=["move"])

# タイプ名の日本語マッピング
TYPE_LABELS_JA: dict[str, str] = {
    "normal": "ノーマル",
    "fire": "ほのお",
    "water": "みず",
    "electric": "でんき",
    "grass": "くさ",
    "ice": "こおり",
    "fighting": "かくとう",
    "poison": "どく",
    "ground": "じめん",
    "flying": "ひこう",
    "psychic": "エスパー",
    "bug": "むし",
    "rock": "いわ",
    "ghost": "ゴースト",
    "dragon": "ドラゴン",
    "dark": "あく",
    "steel": "はがね",
    "fairy": "フェアリー",
    "stellar": "ステラ",
}

# ダメージクラスの日本語マッピング
DAMAGE_CLASS_LABELS_JA: dict[str, str] = {
    "physical": "物理",
    "special": "特殊",
    "status": "変化",
}


@router.get("/{move_key}")
def get_move_detail(move_key: str, lang: str = Query("ja")) -> dict:
    """わざの詳細情報を返す."""
    game_data = get_game_data()
    move_data = game_data.get_move_by_key(move_key)
    if move_data is None:
        raise HTTPException(status_code=404, detail="Move not found")

    # 日本語技名の取得
    ja_moves = game_data.names.get("ja", {}).get("moves", {})
    move_name_ja = None
    for name, key in ja_moves.items():
        if str(key) == move_key:
            move_name_ja = name
            break
    if move_name_ja is None:
        move_name_ja = move_data.get("name", move_key)

    # タイプ情報
    move_type = move_data.get("type", "")
    type_name_ja = TYPE_LABELS_JA.get(move_type, move_type)

    # ダメージクラス情報
    damage_class = move_data.get("damage_class", "")
    damage_class_name_ja = DAMAGE_CLASS_LABELS_JA.get(damage_class, damage_class)

    # 技説明（日本語があればそれを、なければ英語をフォールバック）
    short_desc_en = move_data.get("short_desc", "")
    short_desc_ja = game_data.get_move_desc_ja(move_key) or short_desc_en

    return {
        "move_key": move_key,
        "move_name": move_data.get("name", move_key),
        "move_name_ja": move_name_ja,
        "type": move_type,
        "type_name_ja": type_name_ja,
        "damage_class": damage_class,
        "damage_class_name_ja": damage_class_name_ja,
        "power": move_data.get("power"),
        "accuracy": move_data.get("accuracy"),
        "pp": move_data.get("pp"),
        "priority": move_data.get("priority", 0),
        "target": move_data.get("target"),
        "makes_contact": move_data.get("makes_contact", False),
        "short_desc": short_desc_en,
        "short_desc_ja": short_desc_ja,
    }
