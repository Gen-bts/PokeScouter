"""PokeAPI の CSV（GitHub raw）から特性の日本語名を生成し ability_names_ja.json を書き出す.

names/ja.json に既にあるキーは除外し、不足分のみ champions_override に載せる。
実行: python tools/build_ability_names_ja_from_pokeapi_csv.py

依存: urllib / csv（標準ライブラリのみ）
"""

from __future__ import annotations

import csv
import io
import json
import ssl
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ABILITIES_JSON = ROOT / "data" / "showdown" / "champions-bss-reg-ma" / "abilities.json"
JA_JSON = ROOT / "data" / "names" / "ja.json"
OUT_JSON = ROOT / "data" / "champions_override" / "ability_names_ja.json"

ABILITIES_CSV = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/abilities.csv"
ABILITY_NAMES_CSV = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/ability_names.csv"
# PokeAPI: language id 11 = Japanese (ja)
JA_LANG_ID = "11"


def _fetch(url: str) -> str:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "PokeScouter/1.0 (offline ability name build)"},
    )
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, context=ctx, timeout=120) as r:
        return r.read().decode("utf-8")


def _slug_to_showdown_key(slug: str) -> str:
    return slug.replace("-", "")


def main() -> None:
    abilities_blob = json.loads(ABILITIES_JSON.read_text(encoding="utf-8"))
    valid_keys = {k for k in abilities_blob if not str(k).startswith("_")}

    ja_blob = json.loads(JA_JSON.read_text(encoding="utf-8"))
    existing = set(ja_blob.get("abilities", {}).values())

    id_to_identifier: dict[str, str] = {}
    for row in csv.DictReader(io.StringIO(_fetch(ABILITIES_CSV))):
        aid = row["id"]
        id_to_identifier[aid] = row["identifier"]

    ja_by_ability_id: dict[str, str] = {}
    for row in csv.DictReader(io.StringIO(_fetch(ABILITY_NAMES_CSV))):
        if row["local_language_id"] != JA_LANG_ID:
            continue
        ja_by_ability_id[row["ability_id"]] = row["name"]

    out_abilities: dict[str, str] = {}
    for aid, ja_name in ja_by_ability_id.items():
        slug = id_to_identifier.get(aid)
        if not slug:
            continue
        key = _slug_to_showdown_key(slug)
        if key not in valid_keys:
            continue
        if key in existing:
            continue
        out_abilities[ja_name] = key

    payload = {
        "_meta": {
            "source": "PokeAPI CSV (ability_names.csv + abilities.csv)",
            "language_id": JA_LANG_ID,
            "description": "names/ja.json の abilities に無い Showdown キーを補完（GameData.load でマージ）",
        },
        "abilities": out_abilities,
    }
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(out_abilities)} entries to {OUT_JSON}")


if __name__ == "__main__":
    main()
