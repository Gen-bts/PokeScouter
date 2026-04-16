"""stat_estimator のバリアント生成テスト."""

import pytest

from app.damage.stat_estimator import (
    DAMAGE_REDUCING_ABILITIES,
    DEFENSE_PRESETS,
    OFFENSE_PRESETS,
    calc_champions_stats,
    calc_opponent_defense_stats,
    calc_opponent_offense_stats,
    classify_role,
    generate_attacker_variants,
    generate_defender_variants,
    get_ability_variants,
)

# --- テスト用種族値 ---

DRAGONITE_BASE = {"hp": 91, "atk": 134, "def": 95, "spa": 100, "spd": 100, "spe": 80}
GARCHOMP_BASE = {"hp": 108, "atk": 130, "def": 95, "spa": 80, "spd": 85, "spe": 102}
SHEDINJA_BASE = {"hp": 1, "atk": 90, "def": 45, "spa": 30, "spd": 30, "spe": 40}
BLISSEY_BASE = {"hp": 255, "atk": 10, "def": 10, "spa": 75, "spd": 135, "spe": 55}


class TestGenerateDefenderVariants:
    """generate_defender_variants のテスト."""

    def test_returns_four_variants(self) -> None:
        variants = generate_defender_variants(DRAGONITE_BASE)
        assert set(variants.keys()) == {
            "nominal", "min_bulk", "max_phys_bulk", "max_spec_bulk",
        }

    def test_all_variants_have_six_stats(self) -> None:
        variants = generate_defender_variants(GARCHOMP_BASE)
        for name, stats in variants.items():
            assert set(stats.keys()) == {"hp", "atk", "def", "spa", "spd", "spe"}, (
                f"バリアント {name} のステータスが不足"
            )

    def test_max_phys_bulk_higher_def_than_min_bulk(self) -> None:
        variants = generate_defender_variants(DRAGONITE_BASE)
        assert variants["max_phys_bulk"]["def"] > variants["min_bulk"]["def"]
        assert variants["max_phys_bulk"]["hp"] > variants["min_bulk"]["hp"]

    def test_max_spec_bulk_higher_spd_than_min_bulk(self) -> None:
        variants = generate_defender_variants(DRAGONITE_BASE)
        assert variants["max_spec_bulk"]["spd"] > variants["min_bulk"]["spd"]
        assert variants["max_spec_bulk"]["hp"] > variants["min_bulk"]["hp"]

    def test_shedinja_hp_always_one(self) -> None:
        """ヌケニン (HP種族値=1) は全バリアントで HP=1."""
        variants = generate_defender_variants(SHEDINJA_BASE)
        for name, stats in variants.items():
            assert stats["hp"] == 1, f"ヌケニン {name} の HP が 1 ではない: {stats['hp']}"

    def test_nature_mod_applied_to_max_phys(self) -> None:
        """max_phys_bulk はずぶとい補正（ぼうぎょ 1.1x）で計算される."""
        variants = generate_defender_variants(DRAGONITE_BASE)
        # 性格補正なしの場合
        no_nature = calc_champions_stats(
            DRAGONITE_BASE, {"hp": 32, "atk": 0, "def": 32, "spa": 0, "spd": 2, "spe": 0},
        )
        assert variants["max_phys_bulk"]["def"] > no_nature["def"]


class TestGenerateAttackerVariants:
    """generate_attacker_variants のテスト."""

    def test_returns_four_variants(self) -> None:
        variants = generate_attacker_variants(DRAGONITE_BASE)
        assert set(variants.keys()) == {
            "nominal", "min_offense", "max_phys_offense", "max_spec_offense",
        }

    def test_max_phys_higher_atk_than_min(self) -> None:
        variants = generate_attacker_variants(DRAGONITE_BASE)
        assert variants["max_phys_offense"]["atk"] > variants["min_offense"]["atk"]

    def test_max_spec_higher_spa_than_min(self) -> None:
        variants = generate_attacker_variants(DRAGONITE_BASE)
        assert variants["max_spec_offense"]["spa"] > variants["min_offense"]["spa"]


class TestGetAbilityVariants:
    """get_ability_variants のテスト."""

    def test_detected_ability_returns_single(self) -> None:
        """特性検出済みの場合は 1 バリアントのみ."""
        pokemon_data = {
            "abilities": {"normal": ["innerfocus"], "hidden": "multiscale"},
        }
        result = get_ability_variants(pokemon_data, "multiscale")
        assert result == ["multiscale"]

    def test_dragonite_unknown_returns_two_variants(self) -> None:
        """カイリュー（特性未検出）は innerfocus + multiscale の 2 バリアント."""
        pokemon_data = {
            "abilities": {"normal": ["innerfocus"], "hidden": "multiscale"},
        }
        result = get_ability_variants(pokemon_data, None)
        assert len(result) == 2
        assert "innerfocus" in result
        assert "multiscale" in result

    def test_no_damage_reducing_returns_single(self) -> None:
        """ダメージ影響特性なしの場合は 1 バリアント."""
        pokemon_data = {
            "abilities": {"normal": ["roughskin"], "hidden": "sandveil"},
        }
        result = get_ability_variants(pokemon_data, None)
        assert len(result) == 1

    def test_single_ability_returns_single(self) -> None:
        """特性が 1 つしかない場合は 1 バリアント."""
        pokemon_data = {
            "abilities": {"normal": ["levitate"], "hidden": None},
        }
        result = get_ability_variants(pokemon_data, None)
        assert result == ["levitate"]

    def test_empty_abilities(self) -> None:
        """特性データがない場合."""
        pokemon_data: dict = {"abilities": {"normal": [], "hidden": None}}
        result = get_ability_variants(pokemon_data, None)
        assert result == [None]


class TestCalcChampionsStatsNatureMods:
    """calc_champions_stats の性格補正テスト."""

    def test_no_nature_mods(self) -> None:
        stats = calc_champions_stats(DRAGONITE_BASE, {"hp": 0, "atk": 0, "def": 0, "spa": 0, "spd": 0, "spe": 0})
        assert stats["def"] == calc_champions_stats(
            DRAGONITE_BASE, {"hp": 0, "atk": 0, "def": 0, "spa": 0, "spd": 0, "spe": 0}, nature_mods={},
        )["def"]

    def test_def_boost(self) -> None:
        base = calc_champions_stats(DRAGONITE_BASE, {"hp": 0, "atk": 0, "def": 0, "spa": 0, "spd": 0, "spe": 0})
        boosted = calc_champions_stats(
            DRAGONITE_BASE, {"hp": 0, "atk": 0, "def": 0, "spa": 0, "spd": 0, "spe": 0},
            nature_mods={"def": 1.1},
        )
        assert boosted["def"] > base["def"]
        # 他のステータスは変わらない
        assert boosted["atk"] == base["atk"]
        assert boosted["hp"] == base["hp"]


class TestDefensePresets:
    """耐久配分プリセットのテスト."""

    def test_all_presets_sum_to_66(self) -> None:
        for name, points in DEFENSE_PRESETS.items():
            total = sum(points.values())
            assert total == 66, f"プリセット {name} の合計が 66 ではない: {total}"

    def test_hb_has_high_hp_and_def(self) -> None:
        assert DEFENSE_PRESETS["hb"]["hp"] == 32
        assert DEFENSE_PRESETS["hb"]["def"] == 32

    def test_hd_has_high_hp_and_spd(self) -> None:
        assert DEFENSE_PRESETS["hd"]["hp"] == 32
        assert DEFENSE_PRESETS["hd"]["spd"] == 32


class TestOffensePresets:
    """火力配分プリセットのテスト."""

    def test_all_presets_sum_to_66(self) -> None:
        for name, points in OFFENSE_PRESETS.items():
            total = sum(points.values())
            assert total == 66, f"プリセット {name} の合計が 66 ではない: {total}"

    def test_a_has_high_atk(self) -> None:
        assert OFFENSE_PRESETS["a"]["atk"] == 32

    def test_c_has_high_spa(self) -> None:
        assert OFFENSE_PRESETS["c"]["spa"] == 32


class TestCalcOpponentDefenseStats:
    """calc_opponent_defense_stats のテスト."""

    def test_returns_six_stats(self) -> None:
        stats = calc_opponent_defense_stats(DRAGONITE_BASE, "none")
        assert set(stats.keys()) == {"hp", "atk", "def", "spa", "spd", "spe"}

    def test_hb_has_higher_def_than_none(self) -> None:
        none_stats = calc_opponent_defense_stats(DRAGONITE_BASE, "none")
        hb_stats = calc_opponent_defense_stats(DRAGONITE_BASE, "hb")
        assert hb_stats["def"] > none_stats["def"]
        assert hb_stats["hp"] > none_stats["hp"]

    def test_hd_has_higher_spd_than_none(self) -> None:
        none_stats = calc_opponent_defense_stats(DRAGONITE_BASE, "none")
        hd_stats = calc_opponent_defense_stats(DRAGONITE_BASE, "hd")
        assert hd_stats["spd"] > none_stats["spd"]
        assert hd_stats["hp"] > none_stats["hp"]

    def test_nature_boost_applies(self) -> None:
        no_boost = calc_opponent_defense_stats(DRAGONITE_BASE, "hb", None)
        with_boost = calc_opponent_defense_stats(DRAGONITE_BASE, "hb", "def")
        assert with_boost["def"] > no_boost["def"]
        assert with_boost["hp"] == no_boost["hp"]

    def test_unknown_preset_falls_back_to_none(self) -> None:
        stats = calc_opponent_defense_stats(DRAGONITE_BASE, "invalid_preset")
        none_stats = calc_opponent_defense_stats(DRAGONITE_BASE, "none")
        assert stats == none_stats


class TestCalcOpponentOffenseStats:
    """calc_opponent_offense_stats のテスト."""

    def test_returns_six_stats(self) -> None:
        stats = calc_opponent_offense_stats(DRAGONITE_BASE, "a")
        assert set(stats.keys()) == {"hp", "atk", "def", "spa", "spd", "spe"}

    def test_a_has_higher_atk_than_none(self) -> None:
        none_stats = calc_opponent_offense_stats(DRAGONITE_BASE, "none")
        a_stats = calc_opponent_offense_stats(DRAGONITE_BASE, "a")
        assert a_stats["atk"] > none_stats["atk"]

    def test_c_has_higher_spa_than_none(self) -> None:
        none_stats = calc_opponent_offense_stats(DRAGONITE_BASE, "none")
        c_stats = calc_opponent_offense_stats(DRAGONITE_BASE, "c")
        assert c_stats["spa"] > none_stats["spa"]

    def test_nature_boost_applies(self) -> None:
        no_boost = calc_opponent_offense_stats(DRAGONITE_BASE, "a", None)
        with_boost = calc_opponent_offense_stats(DRAGONITE_BASE, "a", "atk")
        assert with_boost["atk"] > no_boost["atk"]

    def test_unknown_preset_falls_back_to_none(self) -> None:
        stats = calc_opponent_offense_stats(DRAGONITE_BASE, "invalid_preset")
        none_stats = calc_opponent_offense_stats(DRAGONITE_BASE, "none")
        assert stats == none_stats
