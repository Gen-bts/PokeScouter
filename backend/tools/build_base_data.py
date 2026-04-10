"""
PokeAPI CSV → data/base/ JSON 変換スクリプト

使い方:
    # 事前に PokeAPI リポジトリの CSV を取得
    git clone --depth 1 --filter=blob:none --sparse https://github.com/PokeAPI/pokeapi.git /tmp/pokeapi
    cd /tmp/pokeapi && git sparse-checkout set data/v2/csv

    # 変換実行
    cd backend
    python -m tools.build_base_data --csv-dir /tmp/pokeapi/data/v2/csv --out-dir ../data/base

出力ファイル:
    data/base/pokemon.json    - 種族値・タイプ・とくせい
    data/base/moves.json      - 技データ
    data/base/abilities.json  - とくせいデータ
    data/base/types.json      - タイプ相性表
    data/base/items.json      - もちものデータ
    data/base/natures.json    - 性格データ
    data/names/ja.json        - 日本語名辞書（OCR照合用）
    data/names/en.json        - 英語名辞書
    data/names/ko.json        - 韓国語名辞書
    data/names/zh_hant.json   - 中国語（繁体字）名辞書
    data/names/zh_hans.json   - 中国語（簡体字）名辞書
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from datetime import date
from pathlib import Path

# PokeAPI language_id → 出力ファイル名マッピング
# 1=ja-hrkt(ひらがな/カタカナ), 11=ja(漢字混じり)
LANG_MAP: dict[int, str] = {
    1: "ja",       # ja-hrkt（カタカナ表記、OCR に最適）
    9: "en",
    3: "ko",
    4: "zh_hant",  # 繁体字
    12: "zh_hans",  # 簡体字
}

# stat_id → key
STAT_KEY: dict[int, str] = {
    1: "hp",
    2: "atk",
    3: "def",
    4: "spa",
    5: "spd",
    6: "spe",
}

# damage_class_id → key
DAMAGE_CLASS: dict[int, str] = {
    1: "status",
    2: "physical",
    3: "special",
}


def read_csv(path: Path) -> list[dict[str, str]]:
    """CSV ファイルを辞書のリストとして読み込む。"""
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def build_pokemon(csv_dir: Path) -> dict:
    """pokemon.json を構築する。"""
    # デフォルトフォーム（is_default=1）のポケモン一覧
    pokemon_rows = read_csv(csv_dir / "pokemon.csv")
    species_rows = read_csv(csv_dir / "pokemon_species.csv")

    # species_id → species情報
    species_info: dict[int, dict] = {}
    for row in species_rows:
        sid = int(row["id"])
        species_info[sid] = {
            "generation_id": int(row["generation_id"]),
            "is_legendary": row["is_legendary"] == "1",
            "is_mythical": row["is_mythical"] == "1",
        }

    # pokemon_id → base_stats
    stats_rows = read_csv(csv_dir / "pokemon_stats.csv")
    pokemon_stats: dict[int, dict[str, int]] = defaultdict(dict)
    for row in stats_rows:
        pid = int(row["pokemon_id"])
        stat_id = int(row["stat_id"])
        if stat_id in STAT_KEY:
            pokemon_stats[pid][STAT_KEY[stat_id]] = int(row["base_stat"])

    # pokemon_id → types (slot順)
    types_rows = read_csv(csv_dir / "pokemon_types.csv")
    type_names = _build_type_id_to_identifier(csv_dir)
    pokemon_types: dict[int, list[str]] = defaultdict(list)
    for row in sorted(types_rows, key=lambda r: int(r["slot"])):
        pid = int(row["pokemon_id"])
        tid = int(row["type_id"])
        pokemon_types[pid].append(type_names.get(tid, f"unknown-{tid}"))

    # pokemon_id → abilities
    abilities_rows = read_csv(csv_dir / "pokemon_abilities.csv")
    ability_names = _build_ability_id_to_identifier(csv_dir)
    pokemon_abilities: dict[int, dict] = defaultdict(lambda: {"normal": [], "hidden": None})
    for row in abilities_rows:
        pid = int(row["pokemon_id"])
        aid = int(row["ability_id"])
        name = ability_names.get(aid, f"unknown-{aid}")
        if row["is_hidden"] == "1":
            pokemon_abilities[pid]["hidden"] = name
        else:
            pokemon_abilities[pid]["normal"].append(name)

    # 英語名 (language_id=9)
    en_names = _build_species_names(csv_dir, lang_id=9)

    # 組み立て
    result: dict[str, dict] = {}
    for row in pokemon_rows:
        pid = int(row["id"])
        species_id = int(row["species_id"])
        is_default = row["is_default"] == "1"

        # メガシンカ等のフォームも含める
        entry: dict = {
            "identifier": row["identifier"],
            "species_id": species_id,
            "is_default": is_default,
            "name": en_names.get(species_id, row["identifier"]),
            "types": pokemon_types.get(pid, []),
            "base_stats": pokemon_stats.get(pid, {}),
            "abilities": {
                "normal": pokemon_abilities[pid]["normal"],
                "hidden": pokemon_abilities[pid]["hidden"],
            },
            "height": int(row["height"]),
            "weight": int(row["weight"]),
        }

        # species 情報があれば追加
        if species_id in species_info:
            si = species_info[species_id]
            entry["generation"] = si["generation_id"]
            entry["is_legendary"] = si["is_legendary"]
            entry["is_mythical"] = si["is_mythical"]

        result[str(pid)] = entry

    return result


def build_moves(csv_dir: Path) -> dict:
    """moves.json を構築する。"""
    moves_rows = read_csv(csv_dir / "moves.csv")
    type_names = _build_type_id_to_identifier(csv_dir)

    # move_id → meta情報
    meta_rows = read_csv(csv_dir / "move_meta.csv")
    move_meta: dict[int, dict] = {}
    for row in meta_rows:
        mid = int(row["move_id"])
        move_meta[mid] = {
            "crit_rate": int(row["crit_rate"]),
            "drain": int(row["drain"]),
            "healing": int(row["healing"]),
            "min_hits": int(row["min_hits"]) if row["min_hits"] else None,
            "max_hits": int(row["max_hits"]) if row["max_hits"] else None,
            "flinch_chance": int(row["flinch_chance"]),
            "stat_chance": int(row["stat_chance"]),
        }

    # 英語名 (language_id=9)
    name_rows = read_csv(csv_dir / "move_names.csv")
    en_names: dict[int, str] = {}
    for row in name_rows:
        if int(row["local_language_id"]) == 9:
            en_names[int(row["move_id"])] = row["name"]

    result: dict[str, dict] = {}
    for row in moves_rows:
        mid = int(row["id"])
        type_id = int(row["type_id"]) if row["type_id"] else None
        damage_class_id = int(row["damage_class_id"]) if row["damage_class_id"] else None

        entry: dict = {
            "identifier": row["identifier"],
            "name": en_names.get(mid, row["identifier"]),
            "type": type_names.get(type_id, None) if type_id else None,
            "power": int(row["power"]) if row["power"] else None,
            "pp": int(row["pp"]) if row["pp"] else None,
            "accuracy": int(row["accuracy"]) if row["accuracy"] else None,
            "priority": int(row["priority"]),
            "damage_class": DAMAGE_CLASS.get(damage_class_id) if damage_class_id else None,
            "generation": int(row["generation_id"]),
        }

        # meta 追加
        if mid in move_meta:
            entry["meta"] = move_meta[mid]

        result[str(mid)] = entry

    return result


def build_abilities(csv_dir: Path) -> dict:
    """abilities.json を構築する。"""
    rows = read_csv(csv_dir / "abilities.csv")

    # 英語名
    name_rows = read_csv(csv_dir / "ability_names.csv")
    en_names: dict[int, str] = {}
    for row in name_rows:
        if int(row["local_language_id"]) == 9:
            en_names[int(row["ability_id"])] = row["name"]

    # 英語説明
    prose_rows = read_csv(csv_dir / "ability_prose.csv")
    en_effects: dict[int, str] = {}
    for row in prose_rows:
        if int(row["local_language_id"]) == 9:
            en_effects[int(row["ability_id"])] = row["short_effect"]

    # 日本語フレーバーテキスト (ability_flavor_text, lang=1=ja-hrkt)
    # 各 ability の最新 version_group のテキストを採用
    flavor_rows = read_csv(csv_dir / "ability_flavor_text.csv")
    ja_flavor: dict[int, str] = {}
    ja_flavor_vg: dict[int, int] = {}  # 最新 version_group 追跡用
    for row in flavor_rows:
        if int(row["language_id"]) != 1:
            continue
        aid = int(row["ability_id"])
        vg = int(row["version_group_id"])
        if aid not in ja_flavor_vg or vg > ja_flavor_vg[aid]:
            ja_flavor_vg[aid] = vg
            # 全角スペースと改行を整形
            text = row["flavor_text"].replace("\u3000", " ").replace("\n", "")
            ja_flavor[aid] = text

    result: dict[str, dict] = {}
    for row in rows:
        aid = int(row["id"])
        if row["is_main_series"] != "1":
            continue
        result[str(aid)] = {
            "identifier": row["identifier"],
            "name": en_names.get(aid, row["identifier"]),
            "generation": int(row["generation_id"]),
            "effect": en_effects.get(aid, ""),
            "flavor_text_ja": ja_flavor.get(aid, ""),
        }

    return result


def build_types(csv_dir: Path) -> dict:
    """types.json を構築する（タイプ相性表を含む）。"""
    type_rows = read_csv(csv_dir / "types.csv")
    type_id_to_ident = _build_type_id_to_identifier(csv_dir)

    # 英語名
    name_rows = read_csv(csv_dir / "type_names.csv")
    en_names: dict[int, str] = {}
    for row in name_rows:
        if int(row["local_language_id"]) == 9:
            en_names[int(row["type_id"])] = row["name"]

    # タイプ相性
    efficacy_rows = read_csv(csv_dir / "type_efficacy.csv")
    efficacy: dict[str, dict[str, float]] = defaultdict(dict)
    for row in efficacy_rows:
        atk_type = type_id_to_ident.get(int(row["damage_type_id"]))
        def_type = type_id_to_ident.get(int(row["target_type_id"]))
        if atk_type and def_type:
            factor = int(row["damage_factor"]) / 100.0
            efficacy[atk_type][def_type] = factor

    # タイプ一覧
    types_list: dict[str, dict] = {}
    for row in type_rows:
        tid = int(row["id"])
        ident = row["identifier"]
        # ??? や shadow は除外
        if ident in ("unknown", "shadow"):
            continue
        types_list[ident] = {
            "id": tid,
            "name": en_names.get(tid, ident),
            "generation": int(row["generation_id"]),
        }

    return {
        "types": types_list,
        "efficacy": dict(efficacy),
    }


def build_items(csv_dir: Path) -> dict:
    """items.json を構築する（バトル関連アイテムのみ）。"""
    rows = read_csv(csv_dir / "items.csv")

    # 英語名
    name_rows = read_csv(csv_dir / "item_names.csv")
    en_names: dict[int, str] = {}
    for row in name_rows:
        if int(row["local_language_id"]) == 9:
            en_names[int(row["item_id"])] = row["name"]

    # 英語説明
    prose_rows = read_csv(csv_dir / "item_prose.csv")
    en_effects: dict[int, str] = {}
    for row in prose_rows:
        if int(row["local_language_id"]) == 9:
            en_effects[int(row["item_id"])] = row["short_effect"]

    result: dict[str, dict] = {}
    for row in rows:
        iid = int(row["id"])
        result[str(iid)] = {
            "identifier": row["identifier"],
            "name": en_names.get(iid, row["identifier"]),
            "category_id": int(row["category_id"]),
            "cost": int(row["cost"]),
            "fling_power": int(row["fling_power"]) if row["fling_power"] else None,
            "effect": en_effects.get(iid, ""),
        }

    return result


def build_natures(csv_dir: Path) -> dict:
    """natures.json を構築する。"""
    rows = read_csv(csv_dir / "natures.csv")
    stat_map = {2: "atk", 3: "def", 4: "spa", 5: "spd", 6: "spe"}

    # 英語名
    name_rows = read_csv(csv_dir / "nature_names.csv")
    en_names: dict[int, str] = {}
    for row in name_rows:
        if int(row["local_language_id"]) == 9:
            en_names[int(row["nature_id"])] = row["name"]

    result: dict[str, dict] = {}
    for row in rows:
        nid = int(row["id"])
        inc = int(row["increased_stat_id"])
        dec = int(row["decreased_stat_id"])
        result[str(nid)] = {
            "identifier": row["identifier"],
            "name": en_names.get(nid, row["identifier"]),
            "increased_stat": stat_map.get(inc),
            "decreased_stat": stat_map.get(dec),
            "is_neutral": inc == dec,
        }

    return result


def build_name_dicts(csv_dir: Path, out_dir: Path) -> None:
    """多言語名辞書を data/names/ に出力する。"""
    species_names = read_csv(csv_dir / "pokemon_species_names.csv")
    move_names_rows = read_csv(csv_dir / "move_names.csv")
    ability_names_rows = read_csv(csv_dir / "ability_names.csv")
    item_names_rows = read_csv(csv_dir / "item_names.csv")

    for lang_id, filename in LANG_MAP.items():
        # ポケモン名: 表示名 → species_id
        pokemon_dict: dict[str, int] = {}
        for row in species_names:
            if int(row["local_language_id"]) == lang_id and row["name"]:
                pokemon_dict[row["name"]] = int(row["pokemon_species_id"])

        # 技名: 表示名 → move_id
        move_dict: dict[str, int] = {}
        for row in move_names_rows:
            if int(row["local_language_id"]) == lang_id and row["name"]:
                move_dict[row["name"]] = int(row["move_id"])

        # 特性名: 表示名 → ability_id
        ability_dict: dict[str, int] = {}
        for row in ability_names_rows:
            if int(row["local_language_id"]) == lang_id and row["name"]:
                ability_dict[row["name"]] = int(row["ability_id"])

        # アイテム名: 表示名 → item_id
        item_dict: dict[str, int] = {}
        for row in item_names_rows:
            if int(row["local_language_id"]) == lang_id and row["name"]:
                item_dict[row["name"]] = int(row["item_id"])

        data = {
            "_meta": {
                "source": "PokeAPI",
                "language": filename,
                "last_updated": str(date.today()),
            },
            "pokemon": pokemon_dict,
            "moves": move_dict,
            "abilities": ability_dict,
            "items": item_dict,
        }

        out_path = out_dir / f"{filename}.json"
        _write_json(out_path, data)
        print(
            f"  {out_path} ({len(pokemon_dict)} pokemon, {len(move_dict)} moves, "
            f"{len(ability_dict)} abilities, {len(item_dict)} items)",
        )


# --- ヘルパー ---

def _build_type_id_to_identifier(csv_dir: Path) -> dict[int, str]:
    rows = read_csv(csv_dir / "types.csv")
    return {int(r["id"]): r["identifier"] for r in rows}


def _build_ability_id_to_identifier(csv_dir: Path) -> dict[int, str]:
    rows = read_csv(csv_dir / "abilities.csv")
    return {int(r["id"]): r["identifier"] for r in rows}


def _build_species_names(csv_dir: Path, lang_id: int) -> dict[int, str]:
    rows = read_csv(csv_dir / "pokemon_species_names.csv")
    return {
        int(r["pokemon_species_id"]): r["name"]
        for r in rows
        if int(r["local_language_id"]) == lang_id and r["name"]
    }


def _write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def main() -> None:
    parser = argparse.ArgumentParser(description="PokeAPI CSV → data/base/ JSON 変換")
    parser.add_argument(
        "--csv-dir",
        type=Path,
        default=Path("/tmp/pokeapi/data/v2/csv"),
        help="PokeAPI CSV ディレクトリ",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path(__file__).resolve().parent.parent.parent / "data" / "base",
        help="出力ディレクトリ (data/base/)",
    )
    parser.add_argument(
        "--names-dir",
        type=Path,
        default=None,
        help="名前辞書の出力ディレクトリ (data/names/)",
    )
    args = parser.parse_args()

    if args.names_dir is None:
        args.names_dir = args.out_dir.parent / "names"

    meta = {
        "_meta": {
            "source": "PokeAPI",
            "last_updated": str(date.today()),
            "description": "Auto-generated from PokeAPI CSV data",
        },
    }

    print("=== PokeAPI CSV → JSON 変換 ===")
    print(f"CSV: {args.csv_dir}")
    print(f"出力: {args.out_dir}")
    print()

    # pokemon.json
    print("[1/7] pokemon.json ...")
    pokemon_data = build_pokemon(args.csv_dir)
    _write_json(args.out_dir / "pokemon.json", {**meta, **pokemon_data})
    print(f"  → {len(pokemon_data)} entries")

    # moves.json
    print("[2/7] moves.json ...")
    moves_data = build_moves(args.csv_dir)
    _write_json(args.out_dir / "moves.json", {**meta, **moves_data})
    print(f"  → {len(moves_data)} entries")

    # abilities.json
    print("[3/7] abilities.json ...")
    abilities_data = build_abilities(args.csv_dir)
    _write_json(args.out_dir / "abilities.json", {**meta, **abilities_data})
    print(f"  → {len(abilities_data)} entries")

    # types.json
    print("[4/7] types.json ...")
    types_data = build_types(args.csv_dir)
    _write_json(args.out_dir / "types.json", {**meta, **types_data})
    type_count = len(types_data["types"])
    print(f"  → {type_count} types, {type_count}x{type_count} efficacy matrix")

    # items.json
    print("[5/7] items.json ...")
    items_data = build_items(args.csv_dir)
    _write_json(args.out_dir / "items.json", {**meta, **items_data})
    print(f"  → {len(items_data)} entries")

    # natures.json
    print("[6/7] natures.json ...")
    natures_data = build_natures(args.csv_dir)
    _write_json(args.out_dir / "natures.json", {**meta, **natures_data})
    print(f"  → {len(natures_data)} entries")

    # 多言語名辞書
    print("[7/7] 多言語名辞書 ...")
    build_name_dicts(args.csv_dir, args.names_dir)

    print()
    print("完了!")


if __name__ == "__main__":
    main()
