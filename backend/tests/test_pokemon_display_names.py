from __future__ import annotations

import json

import pytest

from app.data.game_data import GameData


@pytest.fixture()
def game_data_with_display_forms(tmp_path):
    base = tmp_path / "base"
    base.mkdir()
    override = tmp_path / "champions_override"
    override.mkdir()
    seasons = tmp_path / "seasons"
    seasons.mkdir()
    names_dir = tmp_path / "names"
    names_dir.mkdir()

    pokemon = {
        "rotom": {
            "pokemon_key": "rotom",
            "base_species_key": "rotom",
            "name": "Rotom",
            "base_species_name": "Rotom",
            "forme": "",
            "is_base_form": True,
        },
        "rotomheat": {
            "pokemon_key": "rotomheat",
            "base_species_key": "rotom",
            "name": "Rotom-Heat",
            "base_species_name": "Rotom",
            "forme": "Heat",
            "is_base_form": False,
        },
        "rotomfan": {
            "pokemon_key": "rotomfan",
            "base_species_key": "rotom",
            "name": "Rotom-Fan",
            "base_species_name": "Rotom",
            "forme": "Fan",
            "is_base_form": False,
        },
        "charizard": {
            "pokemon_key": "charizard",
            "base_species_key": "charizard",
            "name": "Charizard",
            "base_species_name": "Charizard",
            "forme": "",
            "is_base_form": True,
        },
        "charizardmegax": {
            "pokemon_key": "charizardmegax",
            "base_species_key": "charizard",
            "name": "Charizard-Mega-X",
            "base_species_name": "Charizard",
            "forme": "Mega-X",
            "is_base_form": False,
        },
        "meowstic": {
            "pokemon_key": "meowstic",
            "base_species_key": "meowstic",
            "name": "Meowstic",
            "base_species_name": "Meowstic",
            "forme": "",
            "is_base_form": True,
        },
        "meowsticf": {
            "pokemon_key": "meowsticf",
            "base_species_key": "meowstic",
            "name": "Meowstic-F",
            "base_species_name": "Meowstic",
            "forme": "F",
            "is_base_form": False,
        },
    }

    for fname in [
        "moves.json",
        "abilities.json",
        "types.json",
        "items.json",
        "natures.json",
    ]:
        (base / fname).write_text("{}", encoding="utf-8")
    (base / "pokemon.json").write_text(
        json.dumps(pokemon, ensure_ascii=False),
        encoding="utf-8",
    )
    for fname in ["pokemon_patch.json", "moves_patch.json", "new_entries.json", "learnsets.json"]:
        (override / fname).write_text("{}", encoding="utf-8")
    (seasons / "current.json").write_text('{"current_season": ""}', encoding="utf-8")

    ja_names = {
        "_meta": {"language": "ja"},
        "pokemon": {
            "ロトム": "rotom",
            "リザードン": "charizard",
            "ニャオニクス": "meowstic",
        },
    }
    (names_dir / "ja.json").write_text(
        json.dumps(ja_names, ensure_ascii=False),
        encoding="utf-8",
    )

    gd = GameData(data_dir=tmp_path)
    gd.load()
    return gd


def test_localize_pokemon_name_synthesizes_rotom_forms(
    game_data_with_display_forms: GameData,
) -> None:
    assert game_data_with_display_forms.localize_pokemon_name("rotom") == "ロトム"
    assert game_data_with_display_forms.localize_pokemon_name("rotomheat") == "ヒートロトム"
    assert game_data_with_display_forms.localize_pokemon_name("rotomfan") == "スピンロトム"


def test_localize_pokemon_name_handles_common_form_templates(
    game_data_with_display_forms: GameData,
) -> None:
    assert (
        game_data_with_display_forms.localize_pokemon_name("charizardmegax")
        == "メガリザードンX"
    )
    assert game_data_with_display_forms.localize_pokemon_name("meowsticf") == "ニャオニクス♀"


def test_get_pokemon_name_choices_includes_form_entries(
    game_data_with_display_forms: GameData,
) -> None:
    choices = game_data_with_display_forms.get_pokemon_name_choices("ja")
    assert choices["ロトム"] == "rotom"
    assert choices["ヒートロトム"] == "rotomheat"
    assert choices["スピンロトム"] == "rotomfan"
    assert choices["メガリザードンX"] == "charizardmegax"
