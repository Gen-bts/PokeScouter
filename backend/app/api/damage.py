"""ダメージ計算 API."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.damage.client import CalcServiceClient
from app.damage.stat_estimator import (
    calc_opponent_defense_stats,
    calc_opponent_offense_stats,
)
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


class SideData(BaseModel):
    """サイド別フィールド状態（壁・おいかぜ）."""

    is_reflect: bool = False
    is_light_screen: bool = False
    is_aurora_veil: bool = False
    is_tailwind: bool = False


class FieldData(BaseModel):
    """フィールド状態."""

    weather: str | None = None
    terrain: str | None = None
    attacker_side: SideData | None = None
    defender_side: SideData | None = None


class DefenderPreset(BaseModel):
    """相手スロットごとの耐久配分・性格設定."""

    defense_preset: str = "none"  # "none" / "h" / "hb" / "hd"
    nature_boost_stat: str | None = None  # null / "atk" / "def" / "spa" / "spd" / "spe"


class DamageCalcRequest(BaseModel):
    """ダメージ計算リクエスト."""

    attacker: AttackerData
    defender_pokemon_keys: list[str]
    field: FieldData | None = None
    defender_boosts: dict[str, dict[str, int]] | None = None
    defender_items: dict[str, str] | None = None
    defender_abilities: dict[str, str] | None = None
    # 明示選択用: pokemon_key ごとの耐久配分・性格補正
    defender_presets: dict[str, DefenderPreset] | None = None


class DefenderData(BaseModel):
    """防御側データ（自分ポケモン = OCR 実数値あり）."""

    pokemon_key: str
    stats: dict[str, int]
    ability_key: str | None = None
    item_key: str | None = None
    boosts: dict[str, int] | None = None


class IncomingDamageCalcRequest(BaseModel):
    """被ダメージ計算リクエスト."""

    attacker_pokemon_key: str
    attacker_move_keys: list[str]
    attacker_boosts: dict[str, int] | None = None
    attacker_ability_key: str | None = None
    attacker_item_key: str | None = None
    defender: DefenderData
    field: FieldData | None = None
    # 明示選択用: 火力配分・性格補正
    attacker_offense_preset: str | None = None  # "none" / "a" / "c"
    attacker_nature_boost_stat: str | None = None  # null / "atk" / "def" / "spa" / "spd" / "spe"


# --- エンドポイント ---


@router.post("/damage")
async def calculate_damage(req: DamageCalcRequest) -> dict[str, Any]:
    """ダメージ計算を実行する.

    フロントエンドからの軽量リクエストを GameData で補完し、
    明示選択されたプリセット設定で calc-service に転送して結果を返す。
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

    # --- 防御側データ構築（単一設定ベース）---
    defenders: list[dict[str, Any]] = []

    for pokemon_key in req.defender_pokemon_keys:
        pokemon_data = game_data.get_pokemon_by_key(pokemon_key)
        if not pokemon_data:
            logger.warning("防御側ポケモンが見つかりません: %s", pokemon_key)
            continue

        base_stats = pokemon_data.get("base_stats", {})

        # プリセットからステータスを計算
        preset = (
            req.defender_presets.get(pokemon_key)
            if req.defender_presets
            else None
        )
        defense_preset = preset.defense_preset if preset else "none"
        nature_boost_stat = preset.nature_boost_stat if preset else None

        stats = calc_opponent_defense_stats(base_stats, defense_preset, nature_boost_stat)

        # 特性（検出済みの場合は優先、未検出なら先頭の通常特性）
        detected_ability = (
            req.defender_abilities.get(pokemon_key)
            if req.defender_abilities
            else None
        )
        if detected_ability:
            ability_key = detected_ability
        else:
            abilities = pokemon_data.get("abilities", {})
            normal_abilities = abilities.get("normal", [])
            ability_key = normal_abilities[0] if normal_abilities else None

        item_key = (
            req.defender_items.get(pokemon_key)
            if req.defender_items
            else None
        )
        boosts = (
            req.defender_boosts.get(pokemon_key)
            if req.defender_boosts
            else None
        )

        defender: dict[str, Any] = {
            "pokemon_key": pokemon_key,
            "stats": stats,
            "ability_key": ability_key,
            "item_key": item_key,
        }
        if boosts:
            defender["boosts"] = boosts
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
        "field": _build_field(req.field),
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

    # --- 結果を整形（わざ名を日本語に差し替え）---
    raw_results: list[dict[str, Any]] = result.get("results", [])
    for dr in raw_results:
        for move_res in dr.get("moves", []):
            mk = move_res.get("move_key", "")
            if mk in move_key_to_ja:
                move_res["move_name"] = move_key_to_ja[mk]

    return {"results": raw_results}


@router.post("/damage/incoming")
async def calculate_incoming_damage(req: IncomingDamageCalcRequest) -> dict[str, Any]:
    """被ダメージ計算を実行する.

    相手ポケモン（明示選択されたプリセットステータス）から自分ポケモン（OCR 実数値）への
    ダメージを計算する。
    """
    game_data = get_game_data()
    calc_client: CalcServiceClient = get_calc_client()

    # --- 攻撃側（相手）データの構築 ---
    attacker_pokemon = game_data.get_pokemon_by_key(req.attacker_pokemon_key)
    if not attacker_pokemon:
        raise HTTPException(
            status_code=404,
            detail=f"攻撃側ポケモンが見つかりません: {req.attacker_pokemon_key}",
        )

    # --- 技データの検証 ---
    move_keys: list[str] = []
    for move_key in req.attacker_move_keys:
        move_data = game_data.get_move_by_key(move_key)
        if move_data:
            move_keys.append(move_key)

    if not move_keys:
        return {"results": []}

    # --- 防御側（自分）データの構築 ---
    defender_pokemon = game_data.get_pokemon_by_key(req.defender.pokemon_key)
    if not defender_pokemon:
        raise HTTPException(
            status_code=404,
            detail=f"防御側ポケモンが見つかりません: {req.defender.pokemon_key}",
        )

    defender = {
        "pokemon_key": req.defender.pokemon_key,
        "stats": req.defender.stats,
        "ability_key": req.defender.ability_key,
        "item_key": req.defender.item_key,
        "boosts": req.defender.boosts,
    }

    # --- 攻撃側（相手）ステータス計算（プリセットベース）---
    base_stats = attacker_pokemon.get("base_stats", {})
    offense_preset = req.attacker_offense_preset or "a"
    nature_boost_stat = req.attacker_nature_boost_stat

    attacker_stats = calc_opponent_offense_stats(base_stats, offense_preset, nature_boost_stat)

    # 特性（検出済みの場合は優先、未検出なら先頭の通常特性）
    if req.attacker_ability_key:
        ability_key = req.attacker_ability_key
    else:
        abilities = attacker_pokemon.get("abilities", {})
        normal_abilities = abilities.get("normal", [])
        ability_key = normal_abilities[0] if normal_abilities else None

    attacker_data: dict[str, Any] = {
        "pokemon_key": req.attacker_pokemon_key,
        "stats": attacker_stats,
        "ability_key": ability_key,
        "item_key": req.attacker_item_key,
    }
    if req.attacker_boosts:
        attacker_data["boosts"] = req.attacker_boosts

    field = _build_field(req.field)

    # --- calc-service リクエスト構築 ---
    calc_request = {
        "attacker": attacker_data,
        "defenders": [defender],
        "moves": [{"move_key": mk} for mk in move_keys],
        "field": field,
    }

    # --- calc-service 呼び出し ---
    try:
        result = await calc_client.calculate_damage(calc_request)
    except Exception as e:
        logger.error("calc-service 呼び出しエラー（被ダメージ）: %s", e)
        raise HTTPException(
            status_code=503,
            detail="ダメージ計算サービスに接続できません",
        ) from e

    # --- わざ名逆引きマップ ---
    ja_moves = game_data.names.get("ja", {}).get("moves", {})
    move_key_to_ja: dict[str, str] = {str(v): k for k, v in ja_moves.items()}

    # --- 結果を整形（わざ名を日本語に差し替え）---
    raw_results: list[dict[str, Any]] = result.get("results", [])
    for dr in raw_results:
        for move_res in dr.get("moves", []):
            mk = move_res.get("move_key", "")
            if mk in move_key_to_ja:
                move_res["move_name"] = move_key_to_ja[mk]

    return {"results": raw_results}


# ---------------------------------------------------------------------------
# ヘルパー関数
# ---------------------------------------------------------------------------


def _build_field(field: FieldData | None) -> dict[str, Any]:
    """FieldData を calc-service リクエスト用 dict に変換する."""
    return {
        "weather": field.weather if field else None,
        "terrain": field.terrain if field else None,
        "attacker_side": (
            field.attacker_side.model_dump()
            if field and field.attacker_side
            else None
        ),
        "defender_side": (
            field.defender_side.model_dump()
            if field and field.defender_side
            else None
        ),
    }


