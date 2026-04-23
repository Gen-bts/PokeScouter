"""相手ポケモンのステータス推定.

相手のステータスポイント配分が不明なため、種族値から役割を推定し、
ヒューリスティクスに基づいて 66 ポイントを配分する。

EV 幅バリアント生成 & 未知特性バリアント生成もここで行う。
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

# --- 防御側ステータスバリアント定義（レガシー、後方互換用）---

_VARIANT_MIN_BULK: dict[str, int] = {
    "hp": 0, "atk": 32, "def": 0, "spa": 0, "spd": 0, "spe": 32,
}
_VARIANT_MAX_PHYS_BULK: dict[str, int] = {
    "hp": 32, "atk": 0, "def": 32, "spa": 0, "spd": 2, "spe": 0,
}
_VARIANT_MAX_SPEC_BULK: dict[str, int] = {
    "hp": 32, "atk": 0, "def": 0, "spa": 0, "spd": 32, "spe": 2,
}

# --- 攻撃側ステータスバリアント定義（レガシー、後方互換用）---

_VARIANT_MIN_OFFENSE: dict[str, int] = {
    "hp": 32, "atk": 0, "def": 32, "spa": 0, "spd": 2, "spe": 0,
}
_VARIANT_MAX_PHYS_OFFENSE: dict[str, int] = {
    "hp": 0, "atk": 32, "def": 0, "spa": 0, "spd": 2, "spe": 32,
}
_VARIANT_MAX_SPEC_OFFENSE: dict[str, int] = {
    "hp": 0, "atk": 0, "def": 0, "spa": 32, "spd": 2, "spe": 32,
}

# ---------------------------------------------------------------------------
# 明示選択用プリセット（合計 66pt）
# ---------------------------------------------------------------------------

# 耐久配分プリセット（相手防御側用 = 与ダメージ計算）
# フロントは "none" / "h" / "hb" / "hd" を送る
DEFENSE_PRESETS: dict[str, dict[str, int]] = {
    "none": {"hp": 0, "atk": 32, "def": 0, "spa": 0, "spd": 2, "spe": 32},   # 無振り（AS ベース）
    "h":    {"hp": 32, "atk": 0, "def": 0, "spa": 0, "spd": 2, "spe": 32},   # H振り
    "hb":   {"hp": 32, "atk": 0, "def": 32, "spa": 0, "spd": 2, "spe": 0},   # HB振り
    "hd":   {"hp": 32, "atk": 0, "def": 0, "spa": 0, "spd": 32, "spe": 2},   # HD振り
}

# 火力配分プリセット（相手攻撃側用 = 被ダメージ計算）
# フロントは "none" / "a" / "c" を送る
OFFENSE_PRESETS: dict[str, dict[str, int]] = {
    "none": {"hp": 32, "atk": 0, "def": 32, "spa": 0, "spd": 2, "spe": 0},   # 無振り（HB ベース）
    "a":    {"hp": 0, "atk": 32, "def": 0, "spa": 0, "spd": 2, "spe": 32},   # A振り
    "c":    {"hp": 0, "atk": 0, "def": 0, "spa": 32, "spd": 2, "spe": 32},   # C振り
}

# 性格補正対象ステータス（1.1 倍補正）
# フロントは null / "atk" / "def" / "spa" / "spd" / "spe" を送る
NATURE_BOOST_STATS: set[str] = {"atk", "def", "spa", "spd", "spe"}

# --- ダメージに影響する防御側特性 ---

DAMAGE_REDUCING_ABILITIES: set[str] = {
    "multiscale",     # HP満タン時ダメージ半減
    "shadowshield",   # 同上
    "filter",         # 効果抜群ダメージ 3/4
    "solidrock",      # 同上
    "prismarmor",     # 同上
    "furcoat",        # 物理ダメージ半減（ぼうぎょ2倍扱い）
    "icescales",      # 特殊ダメージ半減
    "thickfat",       # ほのお/こおり技の攻撃力半減
    "fluffy",         # 接触技ダメージ半減（ただしほのお2倍）
    "waterbubble",    # ほのお技ダメージ半減
    "purifyingsalt",  # ゴースト技ダメージ半減
    "wonderguard",    # 効果抜群以外無効
    "levitate",       # じめん無効
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
    nature_mods: dict[str, float] | None = None,
) -> dict[str, int]:
    """Champions ステータス計算式で実数値を算出する.

    Args:
        base_stats: 種族値 {hp, atk, def, spa, spd, spe}
        stat_points: ステータスポイント配分 {hp, atk, def, spa, spd, spe}
        nature_mods: 性格補正 {stat_name: modifier}（例: {"def": 1.1}）

    Returns:
        実数値 {hp, atk, def, spa, spd, spe}
    """
    nm = nature_mods or {}
    return {
        "hp":  _calc_hp(base_stats["hp"], stat_points.get("hp", 0)),
        "atk": _calc_stat(base_stats["atk"], stat_points.get("atk", 0), nm.get("atk", 1.0)),
        "def": _calc_stat(base_stats["def"], stat_points.get("def", 0), nm.get("def", 1.0)),
        "spa": _calc_stat(base_stats["spa"], stat_points.get("spa", 0), nm.get("spa", 1.0)),
        "spd": _calc_stat(base_stats["spd"], stat_points.get("spd", 0), nm.get("spd", 1.0)),
        "spe": _calc_stat(base_stats["spe"], stat_points.get("spe", 0), nm.get("spe", 1.0)),
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


# ---------------------------------------------------------------------------
# 明示選択によるステータス計算
# ---------------------------------------------------------------------------


def calc_opponent_defense_stats(
    base_stats: dict[str, int],
    defense_preset: str,
    nature_boost_stat: str | None = None,
    custom_sp: dict[str, int] | None = None,
) -> dict[str, int]:
    """相手の耐久配分プリセットから実数値を算出する（与ダメージ計算用）.

    Args:
        base_stats: 種族値 {hp, atk, def, spa, spd, spe}
        defense_preset: 耐久配分プリセット ("none" / "h" / "hb" / "hd" / "custom")
        nature_boost_stat: 性格で 1.1 倍にするステータス (null / "atk" / "def" / "spa" / "spd" / "spe")
        custom_sp: defense_preset == "custom" の場合に使う SP 配分 (HBD 推定値). None なら "none" にフォールバック

    Returns:
        実数値 {hp, atk, def, spa, spd, spe}
    """
    if defense_preset == "custom" and custom_sp is not None:
        stat_points = {
            "hp": int(custom_sp.get("hp", 0)),
            "atk": int(custom_sp.get("atk", 0)),
            "def": int(custom_sp.get("def", 0)),
            "spa": int(custom_sp.get("spa", 0)),
            "spd": int(custom_sp.get("spd", 0)),
            "spe": int(custom_sp.get("spe", 0)),
        }
    else:
        stat_points = DEFENSE_PRESETS.get(defense_preset, DEFENSE_PRESETS["none"])
    nature_mods: dict[str, float] | None = None
    if nature_boost_stat and nature_boost_stat in NATURE_BOOST_STATS:
        nature_mods = {nature_boost_stat: 1.1}
    return calc_champions_stats(base_stats, stat_points, nature_mods)


def calc_opponent_offense_stats(
    base_stats: dict[str, int],
    offense_preset: str,
    nature_boost_stat: str | None = None,
) -> dict[str, int]:
    """相手の火力配分プリセットから実数値を算出する（被ダメージ計算用）.

    Args:
        base_stats: 種族値 {hp, atk, def, spa, spd, spe}
        offense_preset: 火力配分プリセット ("none" / "a" / "c")
        nature_boost_stat: 性格で 1.1 倍にするステータス (null / "atk" / "def" / "spa" / "spd" / "spe")

    Returns:
        実数値 {hp, atk, def, spa, spd, spe}
    """
    stat_points = OFFENSE_PRESETS.get(offense_preset, OFFENSE_PRESETS["none"])
    nature_mods: dict[str, float] | None = None
    if nature_boost_stat and nature_boost_stat in NATURE_BOOST_STATS:
        nature_mods = {nature_boost_stat: 1.1}
    return calc_champions_stats(base_stats, stat_points, nature_mods)


def build_defender_data(
    pokemon_data: dict[str, Any],
    pokemon_key: str,
) -> dict[str, Any]:
    """GameData のポケモンデータから calc-service 用の defender データを構築する.

    Args:
        pokemon_data: GameData.get_pokemon_by_key() の返り値

    Returns:
        calc-service の DefenderInput 形式の辞書
    """
    base_stats = pokemon_data.get("base_stats", {})
    stats = estimate_opponent_stats(base_stats)
    abilities = pokemon_data.get("abilities", {})
    normal_abilities = abilities.get("normal", [])
    ability_key = normal_abilities[0] if normal_abilities else None

    return {
        "pokemon_key": pokemon_key,
        "stats": stats,
        "ability_key": ability_key,
        "item_key": None,
    }


# ---------------------------------------------------------------------------
# EV 幅バリアント生成
# ---------------------------------------------------------------------------


def generate_defender_variants(
    base_stats: dict[str, int],
) -> dict[str, dict[str, int]]:
    """防御側ステータスバリアントを生成する.

    Returns:
        {
            "nominal":       ロール推定ベースの実数値（現行動作）,
            "min_bulk":      最低耐久（攻撃特化、HP/B/D=0、性格補正なし）,
            "max_phys_bulk": 最大物理耐久（HP32+B32、ずぶとい）,
            "max_spec_bulk": 最大特殊耐久（HP32+D32、おだやか）,
        }
    """
    nominal = estimate_opponent_stats(base_stats)
    min_bulk = calc_champions_stats(base_stats, _VARIANT_MIN_BULK)
    max_phys = calc_champions_stats(
        base_stats, _VARIANT_MAX_PHYS_BULK, nature_mods={"def": 1.1},
    )
    max_spec = calc_champions_stats(
        base_stats, _VARIANT_MAX_SPEC_BULK, nature_mods={"spd": 1.1},
    )
    return {
        "nominal": nominal,
        "min_bulk": min_bulk,
        "max_phys_bulk": max_phys,
        "max_spec_bulk": max_spec,
    }


def generate_attacker_variants(
    base_stats: dict[str, int],
) -> dict[str, dict[str, int]]:
    """攻撃側ステータスバリアントを生成する（被ダメージ計算用）.

    Returns:
        {
            "nominal":          ロール推定ベースの実数値,
            "min_offense":      最低火力（耐久特化、A/C=0、性格補正なし）,
            "max_phys_offense": 最大物理火力（A32+S32、いじっぱり）,
            "max_spec_offense": 最大特殊火力（C32+S32、ひかえめ）,
        }
    """
    nominal = estimate_opponent_stats(base_stats)
    min_off = calc_champions_stats(base_stats, _VARIANT_MIN_OFFENSE)
    max_phys = calc_champions_stats(
        base_stats, _VARIANT_MAX_PHYS_OFFENSE, nature_mods={"atk": 1.1},
    )
    max_spec = calc_champions_stats(
        base_stats, _VARIANT_MAX_SPEC_OFFENSE, nature_mods={"spa": 1.1},
    )
    return {
        "nominal": nominal,
        "min_offense": min_off,
        "max_phys_offense": max_phys,
        "max_spec_offense": max_spec,
    }


# ---------------------------------------------------------------------------
# 未知特性バリアント
# ---------------------------------------------------------------------------


def get_ability_variants(
    pokemon_data: dict[str, Any],
    detected_ability: str | None,
) -> list[str | None]:
    """ダメージ計算に使用する特性バリアントのリストを返す.

    Args:
        pokemon_data: GameData.get_pokemon_by_key() の返り値
        detected_ability: 検出済み特性 key（None = 未検出）

    Returns:
        特性 key のリスト（計算バリアント用）。
        特性が判明している場合は 1 要素、未判明でダメージ影響特性を持つ場合は複数要素。
    """
    if detected_ability is not None:
        return [detected_ability]

    abilities = pokemon_data.get("abilities", {})
    normal: list[str] = abilities.get("normal", [])
    hidden: str | None = abilities.get("hidden")

    all_abilities: list[str] = list(normal)
    if hidden and hidden not in all_abilities:
        all_abilities.append(hidden)

    if len(all_abilities) <= 1:
        return [all_abilities[0]] if all_abilities else [None]

    # ダメージ影響特性を抽出
    damage_relevant = [a for a in all_abilities if a in DAMAGE_REDUCING_ABILITIES]
    non_relevant = [a for a in all_abilities if a not in DAMAGE_REDUCING_ABILITIES]

    if not damage_relevant:
        # ダメージ影響特性なし → 最初の通常特性のみ
        return [normal[0] if normal else None]

    # ベース特性（ダメージ非影響のもの）+ 各ダメージ影響特性
    base = non_relevant[0] if non_relevant else damage_relevant[0]
    variants: list[str | None] = [base]
    for ability in damage_relevant:
        if ability != base:
            variants.append(ability)

    return variants
