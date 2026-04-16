"""PokeAPI の CSV（GitHub raw）から技の日本語名を生成し move_names_ja.json を書き出す.

names/ja.json に既にあるキーは除外し、不足分のみ champions_override に載せる。
実行: python tools/build_move_names_ja_from_pokeapi_csv.py

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
MOVES_JSON = ROOT / "data" / "showdown" / "champions-bss-reg-ma" / "moves.json"
JA_JSON = ROOT / "data" / "names" / "ja.json"
OUT_JSON = ROOT / "data" / "champions_override" / "move_names_ja.json"

MOVES_CSV = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/moves.csv"
MOVE_NAMES_CSV = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/move_names.csv"
# PokeAPI: language id 11 = Japanese (ja)
JA_LANG_ID = "11"


def _fetch(url: str) -> str:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "PokeScouter/1.0 (offline move name build)"},
    )
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, context=ctx, timeout=120) as r:
        return r.read().decode("utf-8")


def _slug_to_showdown_key(slug: str) -> str:
    return slug.replace("-", "")


def main() -> None:
    moves_blob = json.loads(MOVES_JSON.read_text(encoding="utf-8"))
    valid_keys = {k for k in moves_blob if not str(k).startswith("_")}

    ja_blob = json.loads(JA_JSON.read_text(encoding="utf-8"))
    existing = set(ja_blob.get("moves", {}).values())

    id_to_identifier: dict[str, str] = {}
    for row in csv.DictReader(io.StringIO(_fetch(MOVES_CSV))):
        mid = row["id"]
        id_to_identifier[mid] = row["identifier"]

    ja_by_move_id: dict[str, str] = {}
    for row in csv.DictReader(io.StringIO(_fetch(MOVE_NAMES_CSV))):
        if row["local_language_id"] != JA_LANG_ID:
            continue
        ja_by_move_id[row["move_id"]] = row["name"]

    out_moves: dict[str, str] = {}
    for mid, ja_name in ja_by_move_id.items():
        slug = id_to_identifier.get(mid)
        if not slug:
            continue
        key = _slug_to_showdown_key(slug)
        if key not in valid_keys:
            continue
        if key in existing:
            continue
        out_moves[ja_name] = key

    payload = {
        "_meta": {
            "source": "PokeAPI CSV (move_names.csv + moves.csv)",
            "language_id": JA_LANG_ID,
            "description": "names/ja.json の moves に無い Showdown キーを補完（GameData.load でマージ）",
        },
        "moves": out_moves,
    }
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(out_moves)} entries to {OUT_JSON}")


if __name__ == "__main__":
    main()
