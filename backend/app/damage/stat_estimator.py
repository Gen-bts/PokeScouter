"""相手ポケモンのステータス推定.

相手のステータスポイント配分が不明なため、種族値から役割を推定し、
ヒューリスティクスに基づいて 66 ポイントを配分する。
"""

from __future__ import annotations

import math
from typing import Any

# Champions ステータス計算定数
_LEVEL = 50
_FIXED_IV = 31

# --- stat_points 配分テンプレート（合計 66）---

ALLOCATION_TEMPLATES: dict[str, dict[str, int]] = {
    "physical_sweeper":  {"hp": 0, "atk": 32, "def": 0, "spa": 0, "spd": 2, "spe": 32},
    "special_sweeper":   {"hp": 0, "atk": 0, "def": 0, "spa": 32, "spd": 2, "spe": 32},
    "physical_tank":     {"hp": 32, "atk": 2, "def": 32, "spa": 0, "spd": 0, "spe": 0},
    "special_tank":      {"hp": 32, "atk": 0, "def": 0, "spa": 2, "spd": 32, "spe": 0},
    "balanced_offense":  {"hp": 0, "atk": 16, "def": 2, "spa": 16, "spd": 0, "spe": 32},
    "bulky_offense_phys": {"hp": 4, "atk": 32, "def": 0, "spa": 0, "spd": 0, "spe": 30},
    "bulky_offense_spec": {"hp": 4, "atk": 0, "def": 0, "spa": 32, "spd": 0, "spe": 30},
}


def _calc_hp(base: int, stat_points: int) -> int:
    """Champions HP 計算式."""
    if base == 1:  # Shedinja
        return 1
    return math.floor((2 * base + _FIXED_IV) * _LEVEL / 100 + _LEVEL + 10) + stat_points


def _calc_stat(base: int, stat_points: int, nature_mod: float = 1.0) -> int:
    """Champions HP 以外のステータス計算式."""
    raw = math.floor((2 * base + _FIXED_IV) * _LEVEL / 100 + 5) + stat_points
    return math.floor(raw * nature_mod)


def classify_role(base_stats: dict[str, int]) -> str:
    """種族値から役割を推定する.

    Returns:
        テンプレートキー（ALLOCATION_TEMPLATES のキー）
    """
    atk = base_stats.get("atk", 0)
    spa = base_stats.get("spa", 0)
    defense = base_stats.get("def", 0)
    spd = base_stats.get("spd", 0)
    spe = base_stats.get("spe", 0)
    hp = base_stats.get("hp", 0)

    # 耐久型: HP + 防御/特防 が非常に高い
    bulk_physical = hp + defense
    bulk_special = hp + spd
    offense = max(atk, spa)

    if bulk_physical >= 200 and offense < 90:
        return "physical_tank"
    if bulk_special >= 200 and offense < 90:
        return "special_tank"

    # 速度が高いアタッカー
    if spe >= 80:
        if atk >= spa + 20:
            return "physical_sweeper"
        if spa >= atk + 20:
            return "special_sweeper"
        if atk >= 80 and spa >= 80:
            return "balanced_offense"

    # 鈍足アタッカー
    if atk >= spa + 20:
        return "bulky_offense_phys"
    if spa >= atk + 20:
        return "bulky_offense_spec"

    # デフォルト
    if atk >= spa:
        return "physical_sweeper"
    return "special_sweeper"


def calc_champions_stats(
    base_stats: dict[str, int],
    stat_points: dict[str, int],
) -> dict[str, int]:
    """Champions ステータス計算式で実数値を算出する.

    Args:
        base_stats: 種族値 {hp, atk, def, spa, spd, spe}
        stat_points: ステータスポイント配分 {hp, atk, def, spa, spd, spe}

    Returns:
        実数値 {hp, atk, def, spa, spd, spe}
    """
    return {
        "hp":  _calc_hp(base_stats["hp"], stat_points.get("hp", 0)),
        "atk": _calc_stat(base_stats["atk"], stat_points.get("atk", 0)),
        "def": _calc_stat(base_stats["def"], stat_points.get("def", 0)),
        "spa": _calc_stat(base_stats["spa"], stat_points.get("spa", 0)),
        "spd": _calc_stat(base_stats["spd"], stat_points.get("spd", 0)),
        "spe": _calc_stat(base_stats["spe"], stat_points.get("spe", 0)),
    }


def estimate_opponent_stats(
    base_stats: dict[str, int],
) -> dict[str, int]:
    """相手ポケモンのステータスを推定する.

    種族値から役割を推定し、ヒューリスティクスに基づいて
    66 ポイントを配分、Champions 式で実数値を算出する。

    Args:
        base_stats: 種族値 {hp, atk, def, spa, spd, spe}

    Returns:
        推定実数値 {hp, atk, def, spa, spd, spe}
    """
    role = classify_role(base_stats)
    stat_points = ALLOCATION_TEMPLATES[role]
    return calc_champions_stats(base_stats, stat_points)


def build_defender_data(
    pokemon_data: dict[str, Any],
) -> dict[str, Any]:
    """GameData のポケモンデータから calc-service 用の defender データを構築する.

    Args:
        pokemon_data: GameData.get_pokemon_by_id() の返り値

    Returns:
        calc-service の DefenderInput 形式の辞書
    """
    base_stats = pokemon_data.get("base_stats", {})
    stats = estimate_opponent_stats(base_stats)

    types = pokemon_data.get("types", [])

    # 特性: 通常特性の最初のものをデフォルトとして使用
    abilities = pokemon_data.get("abilities", {})
    normal_abilities = abilities.get("normal", [])
    ability = normal_abilities[0] if normal_abilities else None

    return {
        "species_id": pokemon_data.get("species_id", pokemon_data.get("pokemon_id", 0)),
        "name": pokemon_data.get("name", "Unknown"),
        "types": types,
        "stats": stats,
        "ability": ability,
        "item": None,
    }
