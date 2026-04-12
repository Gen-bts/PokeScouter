"""GameData のあいまい検索メソッドのテスト."""

from __future__ import annotations

import pytest

from app.data.game_data import GameData


@pytest.fixture()
def game_data(tmp_path):
    """最小限の辞書データで GameData を構築する."""
    import json

    base = tmp_path / "base"
    base.mkdir()
    override = tmp_path / "champions_override"
    override.mkdir()
    seasons = tmp_path / "seasons"
    seasons.mkdir()
    names_dir = tmp_path / "names"
    names_dir.mkdir()

    # 最低限のデータファイル
    for fname in ["pokemon.json", "moves.json", "abilities.json",
                  "types.json", "items.json", "natures.json"]:
        (base / fname).write_text("{}", encoding="utf-8")
    for fname in ["pokemon_patch.json", "moves_patch.json",
                  "new_entries.json", "learnsets.json"]:
        (override / fname).write_text("{}", encoding="utf-8")
    (seasons / "current.json").write_text('{"current_season": ""}', encoding="utf-8")

    # 日本語名辞書
    ja_names = {
        "_meta": {"source": "test", "language": "ja"},
        "pokemon": {
            "リザードン": 6,
            "ガブリアス": 445,
            "ピカチュウ": 25,
            "カイリュー": 149,
            "ニドラン♀": 29,
            "ミミッキュ": 778,
        },
        "moves": {
            "かえんほうしゃ": 53,
            "じしん": 89,
            "10まんボルト": 85,
            "りゅうせいぐん": 434,
            "つるぎのまい": 14,
        },
        "abilities": {
            "もうか": 66,
            "いかく": 22,
            "さめはだ": 24,
        },
        "items": {
            "たべのこし": 234,
            "こだわりハチマキ": 220,
            "いのちのたま": 270,
        },
    }
    (names_dir / "ja.json").write_text(
        json.dumps(ja_names, ensure_ascii=False), encoding="utf-8",
    )

    gd = GameData(data_dir=tmp_path)
    gd.load()
    return gd


class TestOcrNormalize:
    """OCR 正規化のテスト."""

    def test_kanji_to_katakana(self, game_data: GameData) -> None:
        """三→ミ, 二→ニ 等の変換."""
        assert GameData._ocr_normalize("三三ツキユ") == "ミミツキユ"

    def test_small_kana_to_normal(self, game_data: GameData) -> None:
        """捨て仮名の正規化."""
        assert GameData._ocr_normalize("ミミッキュ") == "ミミツキユ"

    def test_mimikyu_ocr_matches(self, game_data: GameData) -> None:
        """三三ツキユ → ミミッキュ にマッチする."""
        result = game_data.fuzzy_match_pokemon_name("三三ツキユ")
        assert result is not None
        assert result["matched_name"] == "ミミッキュ"
        assert result["species_id"] == 778
        assert result["confidence"] == 1.0


class TestFuzzyMatchPokemonName:
    """fuzzy_match_pokemon_name のテスト."""

    def test_exact_match(self, game_data: GameData) -> None:
        result = game_data.fuzzy_match_pokemon_name("リザードン")
        assert result is not None
        assert result["matched_name"] == "リザードン"
        assert result["species_id"] == 6
        assert result["confidence"] == 1.0

    def test_fuzzy_match_one_char_error(self, game_data: GameData) -> None:
        # "リザードソ" は "リザードン" の1文字違い
        result = game_data.fuzzy_match_pokemon_name("リザードソ")
        assert result is not None
        assert result["matched_name"] == "リザードン"
        assert result["confidence"] >= 0.8

    def test_below_threshold_returns_none(self, game_data: GameData) -> None:
        result = game_data.fuzzy_match_pokemon_name("あいうえお", threshold=0.8)
        assert result is None

    def test_empty_string_returns_none(self, game_data: GameData) -> None:
        assert game_data.fuzzy_match_pokemon_name("") is None
        assert game_data.fuzzy_match_pokemon_name("  ") is None

    def test_special_char_pokemon(self, game_data: GameData) -> None:
        result = game_data.fuzzy_match_pokemon_name("ニドラン♀")
        assert result is not None
        assert result["matched_name"] == "ニドラン♀"
        assert result["species_id"] == 29

    def test_missing_lang_returns_none(self, game_data: GameData) -> None:
        result = game_data.fuzzy_match_pokemon_name("リザードン", lang="en")
        assert result is None


class TestFuzzyMatchMoveName:
    """fuzzy_match_move_name のテスト."""

    def test_exact_match(self, game_data: GameData) -> None:
        result = game_data.fuzzy_match_move_name("かえんほうしゃ")
        assert result is not None
        assert result["matched_name"] == "かえんほうしゃ"
        assert result["move_id"] == 53
        assert result["confidence"] == 1.0

    def test_fuzzy_match(self, game_data: GameData) -> None:
        # "かえんほうしや" (最後が "や") vs "かえんほうしゃ"
        result = game_data.fuzzy_match_move_name("かえんほうしや")
        assert result is not None
        assert result["matched_name"] == "かえんほうしゃ"
        assert result["confidence"] > 0.8

    def test_number_prefix_move(self, game_data: GameData) -> None:
        result = game_data.fuzzy_match_move_name("10まんボルト")
        assert result is not None
        assert result["matched_name"] == "10まんボルト"
        assert result["move_id"] == 85

    def test_below_threshold_returns_none(self, game_data: GameData) -> None:
        result = game_data.fuzzy_match_move_name("でんこうせっか", threshold=0.8)
        assert result is None

    def test_empty_string_returns_none(self, game_data: GameData) -> None:
        assert game_data.fuzzy_match_move_name("") is None


class TestFuzzyMatchAbilityName:
    """fuzzy_match_ability_name のテスト."""

    def test_exact_match(self, game_data: GameData) -> None:
        result = game_data.fuzzy_match_ability_name("もうか")
        assert result is not None
        assert result["matched_name"] == "もうか"
        assert result["ability_id"] == 66
        assert result["confidence"] == 1.0

    def test_fuzzy_match_one_char_error(self, game_data: GameData) -> None:
        result = game_data.fuzzy_match_ability_name("もうが")
        assert result is not None
        assert result["matched_name"] == "もうか"
        assert result["confidence"] >= 0.6

    def test_below_threshold_returns_none(self, game_data: GameData) -> None:
        result = game_data.fuzzy_match_ability_name("あいうえお", threshold=0.8)
        assert result is None

    def test_empty_string_returns_none(self, game_data: GameData) -> None:
        assert game_data.fuzzy_match_ability_name("") is None


class TestFuzzyMatchItemName:
    """fuzzy_match_item_name のテスト."""

    def test_exact_match(self, game_data: GameData) -> None:
        result = game_data.fuzzy_match_item_name("たべのこし")
        assert result is not None
        assert result["matched_name"] == "たべのこし"
        assert result["item_id"] == 234
        assert result["confidence"] == 1.0

    def test_fuzzy_match_one_char_error(self, game_data: GameData) -> None:
        result = game_data.fuzzy_match_item_name("たべのこじ")
        assert result is not None
        assert result["matched_name"] == "たべのこし"
        assert result["confidence"] >= 0.6

    def test_below_threshold_returns_none(self, game_data: GameData) -> None:
        result = game_data.fuzzy_match_item_name("あいうえおかき", threshold=0.8)
        assert result is None

    def test_empty_string_returns_none(self, game_data: GameData) -> None:
        assert game_data.fuzzy_match_item_name("") is None


@pytest.fixture()
def game_data_with_forms(tmp_path):
    """フォーム違いを含むポケモンデータで GameData を構築する."""
    import json

    base = tmp_path / "base"
    base.mkdir()
    override = tmp_path / "champions_override"
    override.mkdir()
    seasons = tmp_path / "seasons"
    seasons.mkdir()
    names_dir = tmp_path / "names"
    names_dir.mkdir()

    pokemon = {
        "479": {
            "identifier": "rotom", "species_id": 479, "is_default": True,
            "name": "Rotom", "types": ["electric", "ghost"],
        },
        "10008": {
            "identifier": "rotom-heat", "species_id": 479, "is_default": False,
            "name": "Rotom", "types": ["electric", "fire"],
        },
        "10009": {
            "identifier": "rotom-wash", "species_id": 479, "is_default": False,
            "name": "Rotom", "types": ["electric", "water"],
        },
        "10010": {
            "identifier": "rotom-frost", "species_id": 479, "is_default": False,
            "name": "Rotom", "types": ["electric", "ice"],
        },
        "10011": {
            "identifier": "rotom-fan", "species_id": 479, "is_default": False,
            "name": "Rotom", "types": ["electric", "flying"],
        },
        "10012": {
            "identifier": "rotom-mow", "species_id": 479, "is_default": False,
            "name": "Rotom", "types": ["electric", "grass"],
        },
        "25": {
            "identifier": "pikachu", "species_id": 25, "is_default": True,
            "name": "Pikachu", "types": ["electric"],
        },
        "6": {
            "identifier": "charizard", "species_id": 6, "is_default": True,
            "name": "Charizard", "types": ["fire", "flying"],
        },
        "10034": {
            "identifier": "charizard-mega-x", "species_id": 6, "is_default": False,
            "name": "Charizard", "types": ["fire", "dragon"],
        },
    }

    (base / "pokemon.json").write_text(
        json.dumps(pokemon, ensure_ascii=False), encoding="utf-8",
    )
    for fname in ["moves.json", "abilities.json",
                  "types.json", "items.json", "natures.json"]:
        (base / fname).write_text("{}", encoding="utf-8")
    for fname in ["pokemon_patch.json", "moves_patch.json",
                  "new_entries.json", "learnsets.json"]:
        (override / fname).write_text("{}", encoding="utf-8")
    (seasons / "current.json").write_text('{"current_season": ""}', encoding="utf-8")
    (names_dir / "ja.json").write_text("{}", encoding="utf-8")

    gd = GameData(data_dir=tmp_path)
    gd.load()
    return gd


class TestExpandSpeciesToPokemonIds:
    """expand_species_to_pokemon_ids のテスト."""

    def test_rotom_expands_all_forms(self, game_data_with_forms: GameData) -> None:
        """species_id=479 でロトム全フォームの pokemon_id が返る."""
        result = game_data_with_forms.expand_species_to_pokemon_ids([479])
        assert sorted(result) == [479, 10008, 10009, 10010, 10011, 10012]

    def test_no_forms_returns_single(self, game_data_with_forms: GameData) -> None:
        """フォーム違いが無いポケモンは pokemon_id のみ."""
        result = game_data_with_forms.expand_species_to_pokemon_ids([25])
        assert result == [25]

    def test_multiple_species(self, game_data_with_forms: GameData) -> None:
        """複数の species_id を展開できる."""
        result = game_data_with_forms.expand_species_to_pokemon_ids([25, 479])
        assert 25 in result
        assert 479 in result
        assert 10008 in result

    def test_empty_list(self, game_data_with_forms: GameData) -> None:
        """空リストは空リストを返す."""
        assert game_data_with_forms.expand_species_to_pokemon_ids([]) == []

    def test_unknown_species(self, game_data_with_forms: GameData) -> None:
        """存在しない species_id はそのまま返す."""
        result = game_data_with_forms.expand_species_to_pokemon_ids([9999])
        assert result == [9999]

    def test_includes_mega_forms(self, game_data_with_forms: GameData) -> None:
        """メガシンカフォームも pokemon_id として含まれる."""
        result = game_data_with_forms.expand_species_to_pokemon_ids([6])
        assert sorted(result) == [6, 10034]
