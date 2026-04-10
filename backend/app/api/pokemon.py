"""ポケモンデータ API."""

from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException, Query

from app.dependencies import get_game_data

_WIKI_MARKUP_RE = re.compile(r"\[([^\]]*)\]\{[^}]+\}")


def _strip_wiki_markup(text: str) -> str:
    """Strip [text]{mechanic:xxx} markup, keeping visible text."""
    def _replace(m: re.Match) -> str:  # type: ignore[type-arg]
        visible = m.group(1)
        if visible:
            return visible
        # []{type:electric} → "electric"
        ref = m.group(0)
        colon_idx = ref.rfind(":")
        brace_idx = ref.rfind("}")
        if colon_idx != -1 and brace_idx != -1:
            return ref[colon_idx + 1 : brace_idx]
        return ""
    return _WIKI_MARKUP_RE.sub(_replace, text)

router = APIRouter(prefix="/api/pokemon", tags=["pokemon"])


@router.get("/names")
def get_pokemon_names(lang: str = Query("ja")) -> dict:
    """指定言語のポケモン名辞書を返す（オートコンプリート用）."""
    game_data = get_game_data()
    lang_data = game_data.names.get(lang, {})
    return {"pokemon": lang_data.get("pokemon", {})}


@router.get("/{pokemon_id}/detail")
def get_pokemon_detail(pokemon_id: int, lang: str = Query("ja")) -> dict:
    """ポケモンの詳細情報（タイプ・種族値・とくせい・タイプ相性）を返す."""
    game_data = get_game_data()
    pdata = game_data.get_pokemon_by_id(pokemon_id)
    if pdata is None:
        raise HTTPException(status_code=404, detail="Pokemon not found")

    # とくせい名の逆引き辞書 (ability_id -> 日本語名)
    lang_data = game_data.names.get(lang, {})
    ability_id_to_name: dict[int, str] = {
        v: k for k, v in lang_data.get("abilities", {}).items()
    }

    # identifier → ability_id_str の逆引き
    ability_id_by_ident: dict[str, str] = {}
    for aid, adata in game_data.abilities.items():
        if aid == "_meta":
            continue
        ability_id_by_ident[adata.get("identifier", "")] = aid

    # とくせいを日本語名 + effect に変換
    raw_abilities = pdata.get("abilities", {})

    def _resolve_ability(identifier: str) -> dict[str, str]:
        aid_str = ability_id_by_ident.get(identifier)
        if not aid_str:
            return {"name": identifier, "effect": ""}
        ability_data = game_data.abilities[aid_str]
        name = ability_id_to_name.get(int(aid_str), identifier)
        # 日本語リクエストなら flavor_text_ja、なければ英語 effect
        effect = ""
        if lang == "ja":
            effect = ability_data.get("flavor_text_ja", "")
        if not effect:
            effect = _strip_wiki_markup(ability_data.get("effect", ""))
        return {"name": name, "effect": effect}

    normal_abilities = [
        _resolve_ability(a) for a in raw_abilities.get("normal", [])
    ]

    hidden_raw = raw_abilities.get("hidden")
    hidden_ability: dict[str, str] | None = None
    if hidden_raw:
        hidden_ability = _resolve_ability(hidden_raw)

    # ポケモン名の逆引き
    pokemon_name_map: dict[int, str] = {
        v: k for k, v in lang_data.get("pokemon", {}).items()
    }
    name = pokemon_name_map.get(pdata.get("species_id", -1), pdata.get("name", ""))

    # タイプ相性計算
    pokemon_types: list[str] = pdata.get("types", [])
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

    return {
        "pokemon_id": pokemon_id,
        "name": name,
        "types": pokemon_types,
        "base_stats": pdata.get("base_stats", {}),
        "abilities": {"normal": normal_abilities, "hidden": hidden_ability},
        "type_effectiveness": {
            "weak": weak,
            "resist": resist,
            "immune": immune,
        },
    }


@router.get("/type-consistency")
def get_type_consistency(
    pokemon_ids: str = Query(..., description="カンマ区切りのポケモンID"),
) -> dict:
    """相手チームに対するタイプ一貫性を算出する."""
    game_data = get_game_data()
    ids = [int(x) for x in pokemon_ids.split(",") if x.strip()]
    results = game_data.calc_type_consistency(ids)
    return {"results": results, "pokemon_count": len(ids)}
