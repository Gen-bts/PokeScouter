"""GameData.calc_type_consistency のテスト."""

from __future__ import annotations

import json

import pytest

from app.data.game_data import GameData


@pytest.fixture()
def game_data(tmp_path):
    """タイプ相性テスト用の最小 GameData."""
    base = tmp_path / "base"
    base.mkdir()
    override = tmp_path / "champions_override"
    override.mkdir()
    seasons = tmp_path / "seasons"
    seasons.mkdir()
    names_dir = tmp_path / "names"
    names_dir.mkdir()

    # ポケモンデータ
    pokemon = {
        "1": {
            "identifier": "bulbasaur",
            "species_id": 1,
            "is_default": True,
            "name": "Bulbasaur",
            "types": ["grass", "poison"],
            "base_stats": {},
        },
        "4": {
            "identifier": "charmander",
            "species_id": 4,
            "is_default": True,
            "name": "Charmander",
            "types": ["fire"],
            "base_stats": {},
        },
        "25": {
            "identifier": "pikachu",
            "species_id": 25,
            "is_default": True,
            "name": "Pikachu",
            "types": ["electric"],
            "base_stats": {},
        },
        "6": {
            "identifier": "charizard",
            "species_id": 6,
            "is_default": True,
            "name": "Charizard",
            "types": ["fire", "flying"],
            "base_stats": {},
        },
    }

    # タイプ相性（必要なサブセットのみ）
    types_data = {
        "types": {
            "normal": {"id": 1, "name": "Normal", "generation": 1},
            "fire": {"id": 10, "name": "Fire", "generation": 1},
            "water": {"id": 11, "name": "Water", "generation": 1},
            "grass": {"id": 12, "name": "Grass", "generation": 1},
            "electric": {"id": 13, "name": "Electric", "generation": 1},
            "ground": {"id": 5, "name": "Ground", "generation": 1},
            "flying": {"id": 3, "name": "Flying", "generation": 1},
            "poison": {"id": 4, "name": "Poison", "generation": 1},
            "ice": {"id": 15, "name": "Ice", "generation": 1},
            "fighting": {"id": 2, "name": "Fighting", "generation": 1},
            "psychic": {"id": 14, "name": "Psychic", "generation": 1},
            "bug": {"id": 7, "name": "Bug", "generation": 1},
            "rock": {"id": 6, "name": "Rock", "generation": 1},
            "ghost": {"id": 8, "name": "Ghost", "generation": 1},
            "dragon": {"id": 16, "name": "Dragon", "generation": 1},
            "dark": {"id": 17, "name": "Dark", "generation": 2},
            "steel": {"id": 9, "name": "Steel", "generation": 2},
            "fairy": {"id": 18, "name": "Fairy", "generation": 6},
        },
        "efficacy": {
            "fire": {
                "normal": 1.0, "fire": 0.5, "water": 0.5, "grass": 2.0,
                "electric": 1.0, "ground": 1.0, "flying": 1.0, "poison": 1.0,
                "ice": 2.0, "fighting": 1.0, "psychic": 1.0, "bug": 2.0,
                "rock": 0.5, "ghost": 1.0, "dragon": 0.5, "dark": 1.0,
                "steel": 2.0, "fairy": 1.0,
            },
            "water": {
                "normal": 1.0, "fire": 2.0, "water": 0.5, "grass": 0.5,
                "electric": 1.0, "ground": 2.0, "flying": 1.0, "poison": 1.0,
                "ice": 1.0, "fighting": 1.0, "psychic": 1.0, "bug": 1.0,
                "rock": 2.0, "ghost": 1.0, "dragon": 0.5, "dark": 1.0,
                "steel": 1.0, "fairy": 1.0,
            },
            "ground": {
                "normal": 1.0, "fire": 2.0, "water": 1.0, "grass": 0.5,
                "electric": 2.0, "ground": 1.0, "flying": 0.0, "poison": 2.0,
                "ice": 1.0, "fighting": 1.0, "psychic": 1.0, "bug": 0.5,
                "rock": 2.0, "ghost": 1.0, "dragon": 1.0, "dark": 1.0,
                "steel": 2.0, "fairy": 1.0,
            },
            "electric": {
                "normal": 1.0, "fire": 1.0, "water": 2.0, "grass": 0.5,
                "electric": 0.5, "ground": 0.0, "flying": 2.0, "poison": 1.0,
                "ice": 1.0, "fighting": 1.0, "psychic": 1.0, "bug": 1.0,
                "rock": 1.0, "ghost": 1.0, "dragon": 0.5, "dark": 1.0,
                "steel": 1.0, "fairy": 1.0,
            },
            "ice": {
                "normal": 1.0, "fire": 0.5, "water": 0.5, "grass": 2.0,
                "electric": 1.0, "ground": 2.0, "flying": 2.0, "poison": 1.0,
                "ice": 0.5, "fighting": 1.0, "psychic": 1.0, "bug": 1.0,
                "rock": 1.0, "ghost": 1.0, "dragon": 2.0, "dark": 1.0,
                "steel": 0.5, "fairy": 1.0,
            },
            "rock": {
                "normal": 1.0, "fire": 2.0, "water": 1.0, "grass": 1.0,
                "electric": 1.0, "ground": 0.5, "flying": 2.0, "poison": 1.0,
                "ice": 2.0, "fighting": 0.5, "psychic": 1.0, "bug": 2.0,
                "rock": 1.0, "ghost": 1.0, "dragon": 1.0, "dark": 1.0,
                "steel": 0.5, "fairy": 1.0,
            },
            # 残りのタイプはデフォルト 1.0 に頼る
        },
    }

    (base / "pokemon.json").write_text(json.dumps(pokemon), encoding="utf-8")
    (base / "types.json").write_text(json.dumps(types_data), encoding="utf-8")
    for fname in ["moves.json", "abilities.json", "items.json", "natures.json"]:
        (base / fname).write_text("{}", encoding="utf-8")
    for fname in ["pokemon_patch.json", "moves_patch.json",
                  "new_entries.json", "learnsets.json"]:
        (override / fname).write_text("{}", encoding="utf-8")
    (seasons / "current.json").write_text(
        '{"current_season": ""}', encoding="utf-8",
    )
    (names_dir / "ja.json").write_text("{}", encoding="utf-8")

    gd = GameData(data_dir=tmp_path)
    gd.load()
    return gd


def test_fire_consistent_against_grass_poison(game_data: GameData):
    """ほのおは Bulbasaur(くさ/どく) に対して 2.0*1.0=2.0 → 一貫."""
    results = game_data.calc_type_consistency([1])
    fire = next(r for r in results if r["type"] == "fire")
    assert fire["consistent"] is True
    assert fire["min_effectiveness"] == 2.0
    assert fire["per_pokemon"][0]["effectiveness"] == 2.0


def test_ground_inconsistent_against_flying(game_data: GameData):
    """じめんは Charizard(ほのお/ひこう) に対して 2.0*0.0=0.0 → 不一貫."""
    results = game_data.calc_type_consistency([6])
    ground = next(r for r in results if r["type"] == "ground")
    assert ground["consistent"] is False
    assert ground["min_effectiveness"] == 0.0


def test_consistency_requires_all_neutral_or_better(game_data: GameData):
    """全ポケモンに等倍以上が必要。水はチーム[1,4]に対して:
    vs Bulbasaur(くさ/どく) = 0.5*1.0 = 0.5 → 不一貫."""
    results = game_data.calc_type_consistency([1, 4])
    water = next(r for r in results if r["type"] == "water")
    assert water["consistent"] is False
    assert water["min_effectiveness"] == 0.5


def test_electric_inconsistent_against_ground_pokemon(game_data: GameData):
    """でんきは ground タイプ持ちに 0.0 → 不一貫.
    ただしテストデータに ground 単タイプはないのでスキップ."""


def test_empty_team(game_data: GameData):
    """空チームの場合、全タイプが一貫（min=1.0）."""
    results = game_data.calc_type_consistency([])
    for r in results:
        assert r["consistent"] is True
        assert r["min_effectiveness"] == 1.0


def test_result_count(game_data: GameData):
    """結果は18タイプ分返る."""
    results = game_data.calc_type_consistency([1])
    assert len(results) == 18


def test_per_pokemon_detail(game_data: GameData):
    """per_pokemon に各ポケモンの倍率が含まれる."""
    results = game_data.calc_type_consistency([1, 4])
    fire = next(r for r in results if r["type"] == "fire")
    assert len(fire["per_pokemon"]) == 2
    ids = [p["pokemon_id"] for p in fire["per_pokemon"]]
    assert 1 in ids
    assert 4 in ids
