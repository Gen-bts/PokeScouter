"""ポケモンデータ API."""

from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException, Query

from app.dependencies import get_game_data

_WIKI_MARKUP_RE = re.compile(r"\[([^\]]*)\]\{[^}]+\}")


def _strip_wiki_markup(text: str) -> str:
    def _replace(m: re.Match) -> str:  # type: ignore[type-arg]
        visible = m.group(1)
        if visible:
            return visible
        ref = m.group(0)
        colon_idx = ref.rfind(":")
        brace_idx = ref.rfind("}")
        if colon_idx != -1 and brace_idx != -1:
            return ref[colon_idx + 1 : brace_idx]
        return ""
    return _WIKI_MARKUP_RE.sub(_replace, text)


def _calc_type_effectiveness(
    game_data, pokemon_types: list[str],
) -> dict[str, list[dict]]:
    """Calculate weak/resist/immune lists for the given type combination."""
    efficacy = game_data.types.get("efficacy", {})
    all_atk_types = [t for t in efficacy if t != "stellar"]

    weak: list[dict] = []
    resist: list[dict] = []
    immune: list[dict] = []
    for atk_type in all_atk_types:
        multiplier = 1.0
        for def_type in pokemon_types:
            multiplier *= game_data.get_type_efficacy(atk_type, def_type)
        if multiplier == 0.0:
            immune.append({"type": atk_type, "multiplier": 0.0})
        elif multiplier > 1.0:
            weak.append({"type": atk_type, "multiplier": multiplier})
        elif multiplier < 1.0:
            resist.append({"type": atk_type, "multiplier": multiplier})

    weak.sort(key=lambda x: -x["multiplier"])
    resist.sort(key=lambda x: x["multiplier"])
    return {"weak": weak, "resist": resist, "immune": immune}


router = APIRouter(prefix="/api/pokemon", tags=["pokemon"])


def _localize_entry_name(game_data, category: str, entry_key: str, lang: str) -> str:
    if category == "pokemon":
        return game_data.localize_pokemon_name(entry_key, lang) or entry_key
    return game_data.localize_name(category, entry_key, lang) or entry_key


def _resolve_ability(game_data, ability_key: str, lang: str) -> dict[str, str]:
    ability_data = game_data.get_ability_by_key(ability_key) or {}
    name = _localize_entry_name(game_data, "abilities", ability_key, lang)
    effect = _strip_wiki_markup(ability_data.get("effect", ""))
    return {"name": name, "effect": effect}


@router.get("/names")
def get_pokemon_names(lang: str = Query("ja")) -> dict:
    game_data = get_game_data()
    return {"pokemon": game_data.get_pokemon_name_choices(lang)}


@router.get("/{pokemon_key}/detail")
def get_pokemon_detail(pokemon_key: str, lang: str = Query("ja")) -> dict:
    game_data = get_game_data()
    pdata = game_data.get_pokemon_by_key(pokemon_key) or game_data.get_pokemon_by_id(pokemon_key)
    if pdata is None:
        raise HTTPException(status_code=404, detail="Pokemon not found")
    resolved_key = pdata.get("pokemon_key") or pdata.get("key") or pokemon_key

    name = _localize_entry_name(game_data, "pokemon", resolved_key, lang) or pdata.get(
        "name", resolved_key,
    )

    pokemon_types: list[str] = pdata.get("types", [])
    type_eff = _calc_type_effectiveness(game_data, pokemon_types)

    raw_abilities = pdata.get("abilities", {})
    normal_abilities = [
        _resolve_ability(game_data, ability_key, lang)
        for ability_key in raw_abilities.get("normal", [])
    ]
    hidden_key = raw_abilities.get("hidden")
    hidden_ability = _resolve_ability(game_data, hidden_key, lang) if hidden_key else None

    raw_mega_forms = game_data.get_mega_forms_for_pokemon(resolved_key)
    mega_forms_response: list[dict] = []
    base_stats = pdata.get("base_stats", {})
    for mega in raw_mega_forms:
        mega_key = mega.get("mega_pokemon_key")
        mega_pdata = game_data.get_pokemon_by_key(mega_key) if mega_key else None
        if mega_pdata is None:
            continue
        mega_name = _localize_entry_name(game_data, "pokemon", mega_key, lang) or (
            mega_pdata.get("name", mega_key)
        )
        ability_keys = mega_pdata.get("abilities", {}).get("normal", [])
        ability_info = (
            _resolve_ability(game_data, ability_keys[0], lang)
            if ability_keys else {"name": "", "effect": ""}
        )

        mega_stats = mega_pdata.get("base_stats", {})
        stat_deltas: dict[str, int] = {}
        for key in ("hp", "atk", "def", "spa", "spd", "spe"):
            stat_deltas[key] = mega_stats.get(key, 0) - base_stats.get(key, 0)

        mega_types = mega_pdata.get("types", [])
        mega_forms_response.append({
            "item_key": mega.get("item_key"),
            "pokemon_key": mega_key,
            "mega_name": mega_name,
            "types": mega_types,
            "ability": ability_info,
            "base_stats": mega_stats,
            "stat_deltas": stat_deltas,
            "type_effectiveness": _calc_type_effectiveness(game_data, mega_types),
        })

    return {
        "pokemon_key": resolved_key,
        "base_species_key": pdata.get("base_species_key", resolved_key),
        "name": name,
        "types": pokemon_types,
        "base_stats": pdata.get("base_stats", {}),
        "abilities": {"normal": normal_abilities, "hidden": hidden_ability},
        "type_effectiveness": type_eff,
        "mega_forms": mega_forms_response,
    }


@router.get("/mega-form")
def get_mega_form(
    item_key: str | None = Query(None, description="メガストーンの item_key"),
    item_id: str | None = Query(None, description="legacy alias for item_key"),
    pokemon_key: str | None = Query(None, description="ベースポケモンの pokemon_key（差分計算用）"),
    pokemon_id: str | None = Query(None, description="legacy alias for pokemon_key"),
    lang: str = Query("ja"),
) -> dict:
    game_data = get_game_data()
    item_key = item_key or item_id
    pokemon_key = pokemon_key or pokemon_id
    if item_key is None:
        raise HTTPException(status_code=422, detail="item_key is required")
    mega = game_data.get_mega_form_for_item(item_key)
    if mega is None:
        raise HTTPException(status_code=404, detail="Not a mega stone or no mega form found")

    mega_key = mega.get("mega_pokemon_key")
    mega_pdata = game_data.get_pokemon_by_key(mega_key) if mega_key else None
    if mega_pdata is None:
        raise HTTPException(status_code=404, detail="Mega form not found")

    ability_keys = mega_pdata.get("abilities", {}).get("normal", [])
    ability_info = (
        _resolve_ability(game_data, ability_keys[0], lang)
        if ability_keys else {"name": "", "effect": ""}
    )

    stat_deltas: dict[str, int] | None = None
    if pokemon_key is not None:
        base_pdata = game_data.get_pokemon_by_key(pokemon_key)
        if base_pdata is not None:
            stat_deltas = {}
            base_stats = base_pdata.get("base_stats", {})
            mega_stats = mega_pdata.get("base_stats", {})
            for key in ("hp", "atk", "def", "spa", "spd", "spe"):
                stat_deltas[key] = mega_stats.get(key, 0) - base_stats.get(key, 0)

    mega_types = mega_pdata.get("types", [])
    return {
        "item_key": item_key,
        "pokemon_key": mega_key,
        "mega_name": _localize_entry_name(game_data, "pokemon", mega_key, lang) or (
            mega_pdata.get("name", mega_key)
        ),
        "types": mega_types,
        "ability": ability_info,
        "base_stats": mega_pdata.get("base_stats", {}),
        "stat_deltas": stat_deltas,
        "type_effectiveness": _calc_type_effectiveness(game_data, mega_types),
    }


@router.get("/type-consistency")
def get_type_consistency(
    pokemon_keys: str | None = Query(None, description="カンマ区切りのポケモンkey"),
    pokemon_ids: str | None = Query(None, description="legacy alias for pokemon_keys"),
) -> dict:
    game_data = get_game_data()
    pokemon_keys = pokemon_keys or pokemon_ids or ""
    keys = [x for x in pokemon_keys.split(",") if x.strip()]
    results = game_data.calc_type_consistency(keys)
    return {"results": results, "pokemon_count": len(keys)}
