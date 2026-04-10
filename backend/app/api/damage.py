"""ダメージ計算 API.

フロントエンドから攻撃側データ + 防御側 species_id を受け取り、
GameData で補完した上で calc-service に転送する。
"""

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

    pokemon_id: int
    stats: dict[str, int]  # 実数値（OCR 取得済み）
    move_ids: list[int]  # 技 ID（最大 4）
    ability_id: int | None = None
    item_id: int | None = None
    boosts: dict[str, int] | None = None


class FieldData(BaseModel):
    """フィールド状態."""

    weather: str | None = None
    terrain: str | None = None


class DamageCalcRequest(BaseModel):
    """ダメージ計算リクエスト."""

    attacker: AttackerData
    defender_species_ids: list[int]
    field: FieldData | None = None


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
    attacker_pokemon = game_data.get_pokemon_by_id(req.attacker.pokemon_id)
    if not attacker_pokemon:
        raise HTTPException(
            status_code=404,
            detail=f"攻撃側ポケモンが見つかりません: {req.attacker.pokemon_id}",
        )

    attacker_types = attacker_pokemon.get("types", [])
    attacker_name = attacker_pokemon.get("name", "Unknown")

    # 特性名の解決
    attacker_ability: str | None = None
    if req.attacker.ability_id is not None:
        ability_data = game_data.abilities.get(str(req.attacker.ability_id))
        if ability_data:
            attacker_ability = ability_data.get("name", ability_data.get("identifier"))

    # アイテム名の解決 + メガストーン判定
    attacker_item: str | None = None
    if req.attacker.item_id is not None:
        item_data = game_data.items.get(str(req.attacker.item_id))
        if item_data:
            attacker_item = item_data.get("name", item_data.get("identifier"))

        # メガストーン → メガフォームのステータス・タイプ・特性に差し替え
        mega_form = game_data.get_mega_form_for_item(req.attacker.item_id)
        if mega_form:
            attacker_name = mega_form.get("mega_name", attacker_name)
            attacker_types = mega_form.get("types", attacker_types)
            mega_ability = mega_form.get("ability", {})
            if mega_ability:
                attacker_ability = mega_ability.get("name", attacker_ability)

    # 技データの補完
    moves: list[dict[str, Any]] = []
    for move_id in req.attacker.move_ids:
        move_data = game_data.get_move_by_id(move_id)
        if move_data:
            moves.append({
                "move_id": move_id,
                "name": move_data.get("name", move_data.get("identifier", "Unknown")),
                "type": move_data.get("type", "normal"),
                "power": move_data.get("power"),
                "damage_class": move_data.get("damage_class", "physical"),
                "makes_contact": move_data.get("meta", {}).get("makes_contact", False)
                    if move_data.get("meta") else False,
            })

    if not moves:
        return {"results": []}

    # --- 防御側データの補完 ---
    defenders: list[dict[str, Any]] = []
    for species_id in req.defender_species_ids:
        pokemon_data = game_data.get_pokemon_by_id(species_id)
        if not pokemon_data:
            logger.warning("防御側ポケモンが見つかりません: %d", species_id)
            continue
        defenders.append(build_defender_data(pokemon_data))

    if not defenders:
        return {"results": []}

    # --- わざ名逆引きマップ（move_id → 日本語名）---
    ja_moves = game_data.names.get("ja", {}).get("moves", {})
    move_id_to_ja: dict[int, str] = {v: k for k, v in ja_moves.items()}

    # --- calc-service リクエスト構築 ---
    calc_request = {
        "attacker": {
            "species_id": req.attacker.pokemon_id,
            "name": attacker_name,
            "types": attacker_types,
            "stats": req.attacker.stats,
            "ability": attacker_ability,
            "item": attacker_item,
            "boosts": req.attacker.boosts,
        },
        "defenders": defenders,
        "moves": moves,
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
            mid = move_result.get("move_id")
            if mid and mid in move_id_to_ja:
                move_result["move_name"] = move_id_to_ja[mid]

    return result
