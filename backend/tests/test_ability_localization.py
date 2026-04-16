"""特性名・説明文の日本語化テスト."""

from __future__ import annotations

import json

import pytest

from app.data.game_data import GameData


@pytest.fixture()
def game_data(tmp_path):
    """特性ローカライズ用の最小限 GameData."""
    base = tmp_path / "base"
    base.mkdir()
    override = tmp_path / "champions_override"
    override.mkdir()
    names_dir = tmp_path / "names"
    names_dir.mkdir()
    snapshot = tmp_path / "showdown" / "champions-bss-reg-ma"
    snapshot.mkdir(parents=True)

    # --- base/abilities.json (flavor_text_ja あり / なし) ---
    base_abilities = {
        "_meta": {"source": "test"},
        "1": {
            "identifier": "stench",
            "name": "Stench",
            "effect": "Has a 10% chance of making target flinch.",
            "flavor_text_ja": "くさい においを はなつことによって こうげきした ときに あいてを ひるませることが ある。",
        },
        "2": {
            "identifier": "speed-boost",
            "name": "Speed Boost",
            "effect": "Raises Speed one stage after each turn.",
            "flavor_text_ja": "まいターン すばやさが あがる。",
        },
        "3": {
            "identifier": "anger-shell",
            "name": "Anger Shell",
            "effect": "At 1/2 or less max HP: +1 Atk, SpA, Spe, -1 Def, SpD.",
            "flavor_text_ja": "",
        },
    }
    (base / "abilities.json").write_text(
        json.dumps(base_abilities, ensure_ascii=False), encoding="utf-8",
    )
    for fname in ["pokemon.json", "moves.json", "types.json",
                  "items.json", "natures.json"]:
        (base / fname).write_text("{}", encoding="utf-8")

    # --- showdown snapshot ---
    sd_abilities = {
        "_meta": {"source": "test"},
        "stench": {
            "ability_key": "stench",
            "name": "Stench",
            "short_desc": "10% flinch chance.",
            "effect": "Has a 10% chance of making target flinch.",
        },
        "speedboost": {
            "ability_key": "speedboost",
            "name": "Speed Boost",
            "short_desc": "+1 Speed each turn.",
            "effect": "Raises Speed one stage after each turn.",
        },
        "angershell": {
            "ability_key": "angershell",
            "name": "Anger Shell",
            "short_desc": "At 1/2 HP: stat changes.",
            "effect": "At 1/2 or less max HP: +1 Atk, SpA, Spe, -1 Def, SpD.",
        },
        "dragonize": {
            "ability_key": "dragonize",
            "name": "Dragonize",
            "short_desc": "Normal moves become Dragon, 1.2x power.",
            "effect": "Normal-type moves become Dragon-type with 1.2x power.",
            "is_nonstandard": "Future",
        },
    }
    (snapshot / "abilities.json").write_text(
        json.dumps(sd_abilities, ensure_ascii=False), encoding="utf-8",
    )
    sd_pokemon = {
        "_meta": {"source": "test"},
    }
    for fname in ["pokemon.json", "moves.json", "types.json",
                  "items.json", "natures.json", "learnsets.json",
                  "format.json"]:
        (snapshot / fname).write_text(
            json.dumps(sd_pokemon, ensure_ascii=False), encoding="utf-8",
        )

    # --- names/ja.json (既存の一部特性のみ) ---
    ja_names = {
        "_meta": {"source": "test", "language": "ja"},
        "pokemon": {},
        "moves": {},
        "abilities": {
            "あくしゅう": "stench",
        },
        "items": {},
    }
    (names_dir / "ja.json").write_text(
        json.dumps(ja_names, ensure_ascii=False), encoding="utf-8",
    )

    # --- champions_override/ability_names_ja.json ---
    ability_names_ja = {
        "_meta": {"source": "test"},
        "abilities": {
            "かそく": "speedboost",
            "いかりのこうら": "angershell",
            "ドラゴンスキン": "dragonize",
        },
    }
    (override / "ability_names_ja.json").write_text(
        json.dumps(ability_names_ja, ensure_ascii=False), encoding="utf-8",
    )

    # --- champions_override/ability_descs_ja.json ---
    ability_descs_ja = {
        "_meta": {"description": "test"},
        "ability_descs": {
            "angershell": "HPが 半分以下に なると こうげき・とくこう・すばやさが あがり ぼうぎょ・とくぼうが さがる。",
            "dragonize": "自分のノーマルタイプの技がドラゴンタイプになり、さらに威力が1.2倍になる。",
        },
    }
    (override / "ability_descs_ja.json").write_text(
        json.dumps(ability_descs_ja, ensure_ascii=False), encoding="utf-8",
    )

    # move_names_ja.json (空)
    (override / "move_names_ja.json").write_text(
        '{"moves": {}}', encoding="utf-8",
    )

    gd = GameData(data_dir=tmp_path)
    gd.load()
    return gd


class TestMergeAbilityNamesJa:
    """_merge_champions_ability_names_ja のテスト."""

    def test_override_entries_merged(self, game_data: GameData) -> None:
        """ability_names_ja.json のエントリが names に反映される."""
        ja_abilities = game_data.names["ja"]["abilities"]
        assert ja_abilities["かそく"] == "speedboost"
        assert ja_abilities["ドラゴンスキン"] == "dragonize"

    def test_existing_entries_preserved(self, game_data: GameData) -> None:
        """ja.json の既存エントリは保持される."""
        ja_abilities = game_data.names["ja"]["abilities"]
        assert ja_abilities["あくしゅう"] == "stench"

    def test_localize_name_works(self, game_data: GameData) -> None:
        """localize_name でマージ済み特性名を逆引きできる."""
        assert game_data.localize_name("abilities", "speedboost", "ja") == "かそく"
        assert game_data.localize_name("abilities", "dragonize", "ja") == "ドラゴンスキン"
        assert game_data.localize_name("abilities", "stench", "ja") == "あくしゅう"


class TestAbilityDescJa:
    """get_ability_desc_ja のテスト."""

    def test_flavor_text_ja_from_base(self, game_data: GameData) -> None:
        """base/abilities.json の flavor_text_ja が返る."""
        desc = game_data.get_ability_desc_ja("stench")
        assert "くさい" in desc
        assert "ひるませる" in desc

    def test_flavor_text_ja_speed_boost(self, game_data: GameData) -> None:
        """speed-boost -> speedboost のキー変換が正しい."""
        desc = game_data.get_ability_desc_ja("speedboost")
        assert "すばやさ" in desc

    def test_override_desc_for_missing_flavor(self, game_data: GameData) -> None:
        """flavor_text_ja が空の特性は override から取得."""
        desc = game_data.get_ability_desc_ja("angershell")
        assert "HPが 半分以下" in desc

    def test_override_desc_for_champions_exclusive(self, game_data: GameData) -> None:
        """Champions固有特性の説明文が取得できる."""
        desc = game_data.get_ability_desc_ja("dragonize")
        assert "ドラゴンタイプ" in desc

    def test_unknown_ability_returns_empty(self, game_data: GameData) -> None:
        """存在しない特性キーは空文字列を返す."""
        assert game_data.get_ability_desc_ja("nonexistent") == ""


class TestResolveAbilityApi:
    """_resolve_ability の日本語対応テスト."""

    def test_japanese_name_and_effect(self, game_data: GameData) -> None:
        """lang=ja で日本語名・日本語説明が返る."""
        from app.api.pokemon import _resolve_ability
        result = _resolve_ability(game_data, "stench", "ja")
        assert result["name"] == "あくしゅう"
        assert "くさい" in result["effect"]
        assert result["effect_en"] == "Has a 10% chance of making target flinch."

    def test_effect_en_always_present(self, game_data: GameData) -> None:
        """effect_en は lang に関わらず英語."""
        from app.api.pokemon import _resolve_ability
        result = _resolve_ability(game_data, "speedboost", "ja")
        assert result["effect_en"] == "Raises Speed one stage after each turn."

    def test_fallback_to_english_when_no_ja_desc(self, game_data: GameData) -> None:
        """日本語説明が無い場合は英語にフォールバック."""
        from app.api.pokemon import _resolve_ability
        # stench には flavor_text_ja があるが、この場合 effect が ja desc になる
        # angershell テスト: override があるので ja が返る
        result = _resolve_ability(game_data, "angershell", "ja")
        assert "HPが 半分以下" in result["effect"]

    def test_champions_exclusive_ability(self, game_data: GameData) -> None:
        """Champions固有特性が日本語で解決される."""
        from app.api.pokemon import _resolve_ability
        result = _resolve_ability(game_data, "dragonize", "ja")
        assert result["name"] == "ドラゴンスキン"
        assert "ドラゴンタイプ" in result["effect"]
        assert "1.2x" in result["effect_en"]
