"""ダメージ計算 API."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.damage.client import CalcServiceClient
from app.damage.stat_estimator import (
    calc_champions_stats,
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

    defense_preset: str = "none"  # "none" / "h" / "hb" / "hd" / "custom"
    nature_boost_stat: str | None = None  # null / "atk" / "def" / "spa" / "spd" / "spe"
    # defense_preset == "custom" の場合の SP 配分（HBD 推定値）
    custom_sp: dict[str, int] | None = None


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


# --- /api/damage/test 用モデル（マニュアル入力） ---


_VALID_STATS = {"atk", "def", "spa", "spd", "spe"}
_VALID_STATUSES = {"slp", "psn", "brn", "frz", "par", "tox"}


class TestSideInput(BaseModel):
    """テスト画面の片側入力."""

    pokemon_key: str
    ev_allocation: dict[str, int]  # {hp,atk,def,spa,spd,spe} 各 0-32
    nature_up: str | None = None  # "atk" / "def" / "spa" / "spd" / "spe" / null
    nature_down: str | None = None  # 同上（up と同じ stat は不可）
    ability_key: str | None = None
    item_key: str | None = None
    boosts: dict[str, int] | None = None  # -6..+6
    status: str | None = None  # "slp"|"psn"|"brn"|"frz"|"par"|"tox"|null
    is_mega_active: bool = False


class TestAttackerInput(TestSideInput):
    """テスト画面の攻撃側（技付き）."""

    move_keys: list[str]  # 最大 4（空文字は無視）


class DamageTestRequest(BaseModel):
    """マニュアル入力ダメージ計算リクエスト."""

    attacker: TestAttackerInput
    defender: TestSideInput
    field: FieldData | None = None


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
        custom_sp = preset.custom_sp if preset else None

        stats = calc_opponent_defense_stats(
            base_stats, defense_preset, nature_boost_stat, custom_sp,
        )

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


@router.post("/damage/test")
async def calculate_damage_test(req: DamageTestRequest) -> dict[str, Any]:
    """マニュアル入力のダメージ計算（テスト画面用）.

    EV（0-32）、性格（上昇 1.1 / 下降 0.9）、状態異常、メガ発動を明示的に受け取り、
    Champions 式で実数値を算出して calc-service に送信する。
    """
    game_data = get_game_data()
    calc_client: CalcServiceClient = get_calc_client()

    # 攻撃側 / 防御側の解決
    atk_key, atk_stats, atk_ability = _resolve_test_side(req.attacker, "攻撃", game_data)
    def_key, def_stats, def_ability = _resolve_test_side(req.defender, "防御", game_data)

    # 技の検証（空や不正 key は除外）
    move_keys: list[str] = []
    for move_key in req.attacker.move_keys:
        if not move_key:
            continue
        if game_data.get_move_by_key(move_key) is not None:
            move_keys.append(move_key)

    if not move_keys:
        return {
            "results": [],
            "attacker_stats": atk_stats,
            "defender_stats": def_stats,
            "attacker_pokemon_key": atk_key,
            "defender_pokemon_key": def_key,
        }

    # calc-service リクエスト構築
    attacker_payload = _build_test_payload(
        atk_key, atk_stats, atk_ability, req.attacker,
    )
    defender_payload = _build_test_payload(
        def_key, def_stats, def_ability, req.defender,
    )

    calc_request = {
        "attacker": attacker_payload,
        "defenders": [defender_payload],
        "moves": [{"move_key": mk} for mk in move_keys],
        "field": _build_field(req.field),
    }

    try:
        result = await calc_client.calculate_damage(calc_request)
    except Exception as e:
        logger.error("calc-service 呼び出しエラー（テスト）: %s", e)
        raise HTTPException(
            status_code=503,
            detail="ダメージ計算サービスに接続できません",
        ) from e

    # わざ名を日本語に差し替え
    ja_moves = game_data.names.get("ja", {}).get("moves", {})
    move_key_to_ja: dict[str, str] = {str(v): k for k, v in ja_moves.items()}

    raw_results: list[dict[str, Any]] = result.get("results", [])
    for dr in raw_results:
        for move_res in dr.get("moves", []):
            mk = move_res.get("move_key", "")
            if mk in move_key_to_ja:
                move_res["move_name"] = move_key_to_ja[mk]

    return {
        "results": raw_results,
        "attacker_stats": atk_stats,
        "defender_stats": def_stats,
        "attacker_pokemon_key": atk_key,
        "defender_pokemon_key": def_key,
    }


# ---------------------------------------------------------------------------
# ヘルパー関数
# ---------------------------------------------------------------------------


def _resolve_test_side(
    side: TestSideInput,
    role: str,
    game_data: Any,
) -> tuple[str, dict[str, int], str | None]:
    """テスト入力から (effective_pokemon_key, stats, ability_key) を解決する.

    メガ発動時は effective_pokemon_key と base_stats を mega 側で差し替え、
    特性も mega 固定特性で上書きする。
    """
    pokemon_data = game_data.get_pokemon_by_key(side.pokemon_key)
    if not pokemon_data:
        raise HTTPException(
            status_code=404,
            detail=f"{role}側ポケモンが見つかりません: {side.pokemon_key}",
        )

    effective_key = side.pokemon_key
    effective_data = pokemon_data
    mega_activated = False

    if side.is_mega_active and side.item_key:
        mega_info = game_data.get_mega_form_for_item(side.item_key)
        if mega_info is not None:
            mega_base = mega_info.get("base_species_key")
            pokemon_base = pokemon_data.get("base_species_key", side.pokemon_key)
            if not mega_base or mega_base == pokemon_base:
                mega_key = mega_info.get("mega_pokemon_key")
                if mega_key:
                    mega_data = game_data.get_pokemon_by_key(mega_key)
                    if mega_data is not None:
                        effective_key = mega_key
                        effective_data = mega_data
                        mega_activated = True

    base_stats = effective_data.get("base_stats", {})

    # 性格補正の組み立て
    if side.nature_up is not None and side.nature_up not in _VALID_STATS:
        raise HTTPException(
            status_code=422,
            detail=f"{role}側の性格上昇ステータスが不正です: {side.nature_up}",
        )
    if side.nature_down is not None and side.nature_down not in _VALID_STATS:
        raise HTTPException(
            status_code=422,
            detail=f"{role}側の性格下降ステータスが不正です: {side.nature_down}",
        )
    if (
        side.nature_up is not None
        and side.nature_down is not None
        and side.nature_up == side.nature_down
    ):
        raise HTTPException(
            status_code=422,
            detail=f"{role}側の性格補正: 上昇と下降で同じステータスを指定できません",
        )

    nature_mods: dict[str, float] = {}
    if side.nature_up:
        nature_mods[side.nature_up] = 1.1
    if side.nature_down:
        nature_mods[side.nature_down] = 0.9

    ev_allocation = {
        "hp": int(side.ev_allocation.get("hp", 0)),
        "atk": int(side.ev_allocation.get("atk", 0)),
        "def": int(side.ev_allocation.get("def", 0)),
        "spa": int(side.ev_allocation.get("spa", 0)),
        "spd": int(side.ev_allocation.get("spd", 0)),
        "spe": int(side.ev_allocation.get("spe", 0)),
    }

    stats = calc_champions_stats(base_stats, ev_allocation, nature_mods)

    # 特性解決（メガ発動時は強制上書き）
    if mega_activated:
        mega_abilities = effective_data.get("abilities", {}).get("normal", [])
        ability_key = mega_abilities[0] if mega_abilities else None
    elif side.ability_key:
        ability_key = side.ability_key
    else:
        normal_abilities = effective_data.get("abilities", {}).get("normal", [])
        ability_key = normal_abilities[0] if normal_abilities else None

    return effective_key, stats, ability_key


def _build_test_payload(
    pokemon_key: str,
    stats: dict[str, int],
    ability_key: str | None,
    side: TestSideInput,
) -> dict[str, Any]:
    """calc-service に送る片側 payload を組み立てる."""
    payload: dict[str, Any] = {
        "pokemon_key": pokemon_key,
        "stats": stats,
        "ability_key": ability_key,
        "item_key": side.item_key,
    }
    if side.boosts:
        # 0 の key は削除（calc-service 側で意味を持たないため）
        filtered = {k: v for k, v in side.boosts.items() if v != 0}
        if filtered:
            payload["boosts"] = filtered
    if side.status:
        if side.status not in _VALID_STATUSES:
            raise HTTPException(
                status_code=422,
                detail=f"不正な状態異常です: {side.status}",
            )
        payload["status"] = side.status
    return payload


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


