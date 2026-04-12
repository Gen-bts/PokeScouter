from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _load_fetch_module():
    repo_root = Path(__file__).resolve().parents[2]
    module_path = repo_root / "scripts" / "fetch_champions_menu_sprites.py"
    spec = importlib.util.spec_from_file_location(
        "fetch_champions_menu_sprites_test",
        module_path,
    )
    assert spec is not None
    assert spec.loader is not None

    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_parse_menu_cp_title_and_slugify() -> None:
    mod = _load_fetch_module()

    sprite = mod.parse_menu_cp_title("File:Menu CP 0006-Mega X.png")
    assert sprite.num == 6
    assert sprite.form_label == "Mega X"
    assert sprite.form_slug == "mega-x"
    assert sprite.filename == "6-mega-x.png"

    assert mod.slugify_label("Poké Ball") == "poke-ball"


def test_build_manifest_mapping_handles_irregular_forms() -> None:
    mod = _load_fetch_module()
    repo_root = Path(__file__).resolve().parents[2]
    overrides = mod.load_form_overrides(
        repo_root / "data" / "champions_override" / "sprite_form_overrides.json",
    )

    titles = [
        "File:Menu CP 0026-Alola.png",
        "File:Menu CP 0479-Heat.png",
        "File:Menu CP 0681-Blade.png",
        "File:Menu CP 0666-Poké Ball.png",
        "File:Menu CP 0925-Three.png",
        "File:Menu CP 0964-Hero.png",
        "File:Menu CP 0778.png",
    ]
    available = {}
    for title in titles:
        sprite = mod.parse_menu_cp_title(title)
        available[(sprite.num, sprite.form_slug)] = sprite

    snapshot = {
        "raichualola": {
            "num": 26,
            "sprite_id": "raichu-alola",
            "base_species_key": "raichu",
        },
        "rotomheat": {
            "num": 479,
            "sprite_id": "rotom-heat",
            "base_species_key": "rotom",
        },
        "aegislashblade": {
            "num": 681,
            "sprite_id": "aegislash-blade",
            "base_species_key": "aegislash",
        },
        "vivillonpokeball": {
            "num": 666,
            "sprite_id": "vivillon-pokeball",
            "base_species_key": "vivillon",
        },
        "mausholdfour": {
            "num": 925,
            "sprite_id": "maushold-four",
            "base_species_key": "maushold",
        },
        "palafinhero": {
            "num": 964,
            "sprite_id": "palafin-hero",
            "base_species_key": "palafin",
        },
        "mimikyubusted": {
            "num": 778,
            "sprite_id": "mimikyu-busted",
            "base_species_key": "mimikyu",
            "changes_from": "mimikyu",
        },
    }

    manifest, modes = mod.build_manifest_mapping(snapshot, available, overrides)

    assert manifest["raichualola"] == "26-alola.png"
    assert manifest["rotomheat"] == "479-heat.png"
    assert manifest["aegislashblade"] == "681-blade.png"
    assert manifest["vivillonpokeball"] == "666-poke-ball.png"
    assert manifest["mausholdfour"] == "925-three.png"
    assert manifest["palafinhero"] == "964-hero.png"
    assert manifest["mimikyubusted"] == "778.png"
    assert modes["mimikyubusted"] == "base_alias"


def test_collect_required_keys_adds_mega_forms_for_legal_species() -> None:
    mod = _load_fetch_module()

    snapshot = {
        "charizard": {
            "sprite_id": "charizard",
            "base_species_key": "charizard",
        },
        "charizardmegax": {
            "sprite_id": "charizard-megax",
            "base_species_key": "charizard",
        },
        "charizardmegay": {
            "sprite_id": "charizard-megay",
            "base_species_key": "charizard",
        },
        "blastoisemega": {
            "sprite_id": "blastoise-mega",
            "base_species_key": "blastoise",
        },
    }
    format_payload = {"legal_pokemon_keys": ["charizard", "pikachu"]}

    required = mod.collect_required_keys(snapshot, format_payload)

    assert "charizardmegax" in required
    assert "charizardmegay" in required
    assert "blastoisemega" not in required
