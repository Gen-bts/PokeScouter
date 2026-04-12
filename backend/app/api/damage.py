"""ダメージ計算 API."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.damage.client import CalcServiceClient
from app.damage.stat_estimator import build_defender_data
from app.dependencies import get_calc_client, get_game_data

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["damage"])


# --- Pydantic モデル ---


class AttackerData(BaseModel):
    """フロントエンドから送られる攻撃側データ."""

    pokemon_key: str
    stats: dict[str, int]  # 実数値（OCR 取得済み）
    move_keys: list[str]  # 技 key（最大 4）
    ability_key: str | None = None
    item_key: str | None = None
    boosts: dict[str, int] | None = None


class FieldData(BaseModel):
    """フィールド状態."""

    weather: str | None = None
    terrain: str | None = None


class DamageCalcRequest(BaseModel):
    """ダメージ計算リクエスト."""

    attacker: AttackerData
    defender_pokemon_keys: list[str]
    field: FieldData | None = None
    defender_boosts: dict[str, dict[str, int]] | None = None
    defender_items: dict[str, str] | None = None
    defender_abilities: dict[str, str] | None = None


# --- エンドポイント ---


@router.post("/damage")
async def calculate_damage(req: DamageCalcRequest) -> dict[str, Any]:
    """ダメージ計算を実行する.

    フロントエンドからの軽量リクエストを GameData で補完し、
    calc-service に転送して結果を返す。
    """
    game_data = get_game_data()
    calc_client: CalcServiceClient = get_calc_client()

    # --- 攻撃側データの補完 ---
    attacker_pokemon = game_data.get_pokemon_by_key(req.attacker.pokemon_key)
    if not attacker_pokemon:
        raise HTTPException(
            status_code=404,
            detail=f"攻撃側ポケモンが見つかりません: {req.attacker.pokemon_key}",
        )

    # 技データの補完
    move_keys: list[str] = []
    for move_key in req.attacker.move_keys:
        move_data = game_data.get_move_by_key(move_key)
        if move_data:
            move_keys.append(move_key)

    if not move_keys:
        return {"results": []}

    # --- 防御側データの補完 ---
    defenders: list[dict[str, Any]] = []
    for pokemon_key in req.defender_pokemon_keys:
        pokemon_data = game_data.get_pokemon_by_key(pokemon_key)
        if not pokemon_data:
            logger.warning("防御側ポケモンが見つかりません: %s", pokemon_key)
            continue
        defender = build_defender_data(pokemon_data, pokemon_key)
        if req.defender_boosts and pokemon_key in req.defender_boosts:
            defender["boosts"] = req.defender_boosts[pokemon_key]
        # 検出された相手アイテムで上書き
        if req.defender_items and pokemon_key in req.defender_items:
            defender["item_key"] = req.defender_items[pokemon_key]
        # 検出された相手特性で上書き
        if req.defender_abilities and pokemon_key in req.defender_abilities:
            defender["ability_key"] = req.defender_abilities[pokemon_key]
        defenders.append(defender)

    if not defenders:
        return {"results": []}

    # --- わざ名逆引きマップ（move_key → 日本語名）---
    ja_moves = game_data.names.get("ja", {}).get("moves", {})
    move_key_to_ja: dict[str, str] = {str(v): k for k, v in ja_moves.items()}

    # --- calc-service リクエスト構築 ---
    calc_request = {
        "attacker": {
            "pokemon_key": req.attacker.pokemon_key,
            "stats": req.attacker.stats,
            "ability_key": req.attacker.ability_key,
            "item_key": req.attacker.item_key,
            "boosts": req.attacker.boosts,
        },
        "defenders": defenders,
        "moves": [{"move_key": move_key} for move_key in move_keys],
        "field": {
            "weather": req.field.weather if req.field else None,
            "terrain": req.field.terrain if req.field else None,
        },
    }

    # --- calc-service 呼び出し ---
    try:
        result = await calc_client.calculate_damage(calc_request)
    except Exception as e:
        logger.error("calc-service 呼び出しエラー: %s", e)
        raise HTTPException(
            status_code=503,
            detail="ダメージ計算サービスに接続できません",
        ) from e

    # --- わざ名を日本語に差し替え ---
    for defender_result in result.get("results", []):
        for move_result in defender_result.get("moves", []):
            move_key = move_result.get("move_key")
            if move_key and move_key in move_key_to_ja:
                move_result["move_name"] = move_key_to_ja[move_key]

    return result
