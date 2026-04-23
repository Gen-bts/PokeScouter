"""Seed generator for data/champions_override/item_names_ja.json.

Showdown snapshot (items.json) からメガストーン項目を拾い、
該当メガポケモンの base_species → 日本語名を names/ja.json から引いて
`<base_species_ja>ナイト` の形で JA 名を導出する。

既に names/ja.json の items セクションに同じ JA 名が登録されている場合は
スキップ。重複・矛盾を避けるために別の Showdown キーにマッピングされている
JA 名もスキップする (例: `ガブリアスナイト` は既に `garchompite` に割り当てられて
いるので、Pokemon Champions の追加石 `garchompitez` は手動で別名を振る必要あり)。

Showdown snapshot を更新したらこのスクリプトを再実行する:

    python scripts/gen_item_names_ja.py
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
_SNAPSHOT = _ROOT / "data" / "showdown" / "champions-bss-reg-ma"
_NAMES = _ROOT / "data" / "names" / "ja.json"
_OUT = _ROOT / "data" / "champions_override" / "item_names_ja.json"


def main() -> None:
    items = json.loads((_SNAPSHOT / "items.json").read_text(encoding="utf-8"))
    pokemon = json.loads((_SNAPSHOT / "pokemon.json").read_text(encoding="utf-8"))
    names = json.loads(_NAMES.read_text(encoding="utf-8"))
    items_ja = names.get("items", {})
    pokemon_ja_rev = names.get("pokemon", {})

    # pokemon key → JA 名 (逆引き辞書; 最初に見つかった名前を採用)
    pokemon_key_to_ja: dict[str, str] = {}
    for ja, key in pokemon_ja_rev.items():
        pokemon_key_to_ja.setdefault(key, ja)

    # メガストーン item 一覧
    mega_items = [
        k for k, v in items.items()
        if not k.startswith("_") and v.get("mega_stone") is not None
    ]

    # item → メガポケモン key の逆引き
    item_to_mega_pokemon: dict[str, str] = {}
    for pokemon_key, pdata in pokemon.items():
        if pokemon_key.startswith("_"):
            continue
        if pdata.get("is_mega") and pdata.get("required_item"):
            item_to_mega_pokemon.setdefault(pdata["required_item"], pokemon_key)

    seeds: dict[str, str] = {}
    skipped_existing: list[str] = []
    skipped_no_mega: list[str] = []
    skipped_no_ja: list[str] = []
    skipped_ja_clash: list[str] = []

    for item_key in sorted(mega_items):
        mega_pokemon_key = item_to_mega_pokemon.get(item_key)
        if mega_pokemon_key is None:
            skipped_no_mega.append(item_key)
            continue
        mega_pdata = pokemon.get(mega_pokemon_key) or {}
        base_species = mega_pdata.get("base_species_key") or mega_pokemon_key
        ja = pokemon_key_to_ja.get(base_species)
        if ja is None:
            skipped_no_ja.append(f"{item_key}(base={base_species})")
            continue
        ja_name = f"{ja}ナイト"
        if ja_name in items_ja:
            if items_ja[ja_name] == item_key:
                skipped_existing.append(item_key)
            else:
                skipped_ja_clash.append(
                    f"{ja_name} (existing→{items_ja[ja_name]}, skipped {item_key})"
                )
            continue
        seeds[ja_name] = item_key

    output = {
        "_meta": {
            "source": "scripts/gen_item_names_ja.py",
            "description": (
                "pokemon JA 名 + Showdown mega_stone マッピングから派生した "
                "メガストーン日本語名。names/ja.json に無い分のみシード。"
            ),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "count": len(seeds),
        },
        "items": seeds,
    }
    _OUT.write_text(
        json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"wrote {_OUT} with {len(seeds)} entries")
    print(f"  skipped (existing ja): {len(skipped_existing)}")
    print(f"  skipped (no mega map): {len(skipped_no_mega)}")
    print(f"  skipped (no base ja):  {len(skipped_no_ja)}")
    print(f"  skipped (ja clash):    {len(skipped_ja_clash)}")
    if skipped_no_ja:
        for s in skipped_no_ja:
            print(f"    - {s}")
    if skipped_ja_clash:
        for s in skipped_ja_clash:
            print(f"    - {s}")


if __name__ == "__main__":
    main()
