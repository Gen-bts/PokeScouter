"""
NCP VGC Damage Calculator の JS ファイルからチャンピオンズ固有データを抽出し、
data/champions_override/ にパッチファイルを生成するスクリプト。

使い方:
    git clone https://github.com/nerd-of-now/NCP-VGC-Damage-Calculator.git <ncp-dir>
    cd backend
    python -m tools.extract_champions_diff --ncp-dir <ncp-dir>/script_res
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import date
from pathlib import Path

STAT_MAP = {"hp": "hp", "at": "atk", "df": "def", "sa": "spa", "sd": "spd", "sp": "spe"}


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def _write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def parse_new_megas(ncp_dir: Path) -> list[dict]:
    """pokedex.js の行 17628〜18310 付近から新メガシンカデータを抽出する。"""
    text = _read(ncp_dir / "pokedex.js")
    lines = text.splitlines()

    # POKEDEX_ZA_NATDEX の開始行を見つける
    start_idx = None
    for i, line in enumerate(lines):
        if "POKEDEX_ZA_NATDEX" in line and "$.extend" in line:
            start_idx = i
            break
    if start_idx is None:
        print("  警告: POKEDEX_ZA_NATDEX が見つかりません")
        return []

    megas: list[dict] = []
    i = start_idx
    while i < len(lines):
        line = lines[i].strip()

        # "Mega Xxx": { or "Floette-Eternal": { (isAlternateForme を持つエントリ)
        name_match = re.match(r'"([^"]+)"\s*:\s*\{', line)
        if name_match:
            name = name_match.group(1)
            # formes 定義（配列）はスキップ
            if '"formes"' in lines[i + 1] if i + 1 < len(lines) else False:
                i += 1
                continue
            # bs を含むか先に確認（数行先まで見る）
            block_lines = []
            j = i
            depth = 0
            while j < len(lines):
                for ch in lines[j]:
                    if ch == '{':
                        depth += 1
                    elif ch == '}':
                        depth -= 1
                block_lines.append(lines[j])
                if depth <= 0 and j > i:
                    break
                j += 1

            block = "\n".join(block_lines)
            if "isAlternateForme" in block or name.startswith("Mega ") or "Floette-Eternal" in name:
                entry = _parse_mega_block(name, block)
                if entry:
                    megas.append(entry)

            i = j + 1
            continue

        # POKEDEX_ZA_NATDEX の終了
        if line.startswith("});"):
            break
        i += 1

    return megas


def _parse_mega_block(name: str, block: str) -> dict | None:
    """1つのメガシンカエントリを解析する。"""
    if "bs" not in block:
        return None

    entry: dict = {"name": name}

    # types
    t1 = re.search(r'"t1"\s*:\s*"(\w+)"', block)
    t2 = re.search(r'"t2"\s*:\s*"(\w+)"', block)
    types = []
    if t1:
        types.append(t1.group(1).lower())
    if t2:
        types.append(t2.group(1).lower())
    entry["types"] = types

    # base stats
    stats: dict[str, int] = {}
    for m in re.finditer(r'"?(\w+)"?\s*:\s*(\d+)', block):
        key = m.group(1)
        if key in STAT_MAP:
            stats[STAT_MAP[key]] = int(m.group(2))
    entry["base_stats"] = stats

    # weight
    w = re.search(r'"w"\s*:\s*([\d.]+)', block)
    if w:
        entry["weight"] = float(w.group(1))

    # ability
    ab = re.search(r'"ab"\s*:\s*"([^"]+)"', block)
    if ab:
        entry["ability"] = ab.group(1)

    return entry


def parse_stat_changes(ncp_dir: Path) -> dict[str, dict[str, int]]:
    """POKEDEX_ZA['Meditite'].bs.at = 56; のようなパッチを抽出する。"""
    text = _read(ncp_dir / "pokedex.js")
    changes: dict[str, dict[str, int]] = {}

    for m in re.finditer(r"POKEDEX_ZA\['([^']+)'\]\.bs\.(\w+)\s*=\s*(\d+)", text):
        name = m.group(1)
        stat = STAT_MAP.get(m.group(2), m.group(2))
        val = int(m.group(3))
        if name not in changes:
            changes[name] = {}
        changes[name][stat] = val

    return changes


def parse_move_changes(ncp_dir: Path) -> dict[str, dict]:
    """move_data_za.js から技のBP変更・クールダウンを抽出する。"""
    text = _read(ncp_dir / "move_data_za.js")
    changes: dict[str, dict] = {}

    # "Move Name": { bp: 30, cooldown: 5, ... } or 'Move Name': { ... }
    for m in re.finditer(r"""['"]([^'"]+)['"]\s*:\s*\{([^}]+)\}""", text):
        name = m.group(1)
        body = m.group(2)
        entry: dict = {}

        bp = re.search(r'\bbp\s*:\s*(\d+)', body)
        if bp:
            entry["power"] = int(bp.group(1))

        cd = re.search(r'\bcooldown\s*:\s*(\d+)', body)
        if cd:
            entry["cooldown"] = int(cd.group(1))

        cat = re.search(r'\bcategory\s*:\s*["\'](\w+)["\']', body)
        if cat:
            entry["damage_class"] = cat.group(1).lower()

        ohko = re.search(r'\bisOHKO\s*:\s*false', body)
        if ohko:
            entry["is_ohko"] = False

        hits_range = re.search(r'\bhitRange\s*:\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]', body)
        if hits_range:
            entry["min_hits"] = int(hits_range.group(1))
            entry["max_hits"] = int(hits_range.group(2))

        hits_fixed = re.search(r'\bhitRange\s*:\s*(\d+)', body)
        if hits_fixed and not hits_range:
            entry["fixed_hits"] = int(hits_fixed.group(1))

        drain = re.search(r'\bdrainHP\s*:\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]', body)
        if drain:
            entry["drain_numerator"] = int(drain.group(1))
            entry["drain_denominator"] = int(drain.group(2))

        type_m = re.search(r'\btype\s*:\s*["\'](\w+)["\']', body)
        if type_m:
            entry["type"] = type_m.group(1).lower()

        if entry:
            changes[name] = entry

    return changes


def parse_new_moves(ncp_dir: Path) -> dict[str, dict]:
    """move_data.js の MOVES_ZA_NATDEX から新技を抽出する。"""
    text = _read(ncp_dir / "move_data.js")

    # MOVES_ZA_NATDEX を見つける
    match = re.search(r'MOVES_ZA_NATDEX\s*=\s*\$\.extend', text)
    if not match:
        return {}

    new_moves: dict[str, dict] = {}
    search_start = match.start()
    for m in re.finditer(r'"([^"]+)"\s*:\s*\{([^}]+)\}', text[search_start:search_start + 2000]):
        name = m.group(1)
        body = m.group(2)

        entry: dict = {}
        bp = re.search(r'\bbp\s*:\s*(\d+)', body)
        if bp:
            entry["power"] = int(bp.group(1))

        type_m = re.search(r'\btype\s*:\s*["\'](\w+)["\']', body)
        if type_m:
            entry["type"] = type_m.group(1).lower()

        cat = re.search(r'\bcategory\s*:\s*["\'](\w+)["\']', body)
        if cat:
            entry["damage_class"] = cat.group(1).lower()

        if entry:
            new_moves[name] = entry

    return new_moves


NEW_ABILITIES = {
    "piercing-drill": {
        "name": "Piercing Drill",
        "effect": "Moves hit through Protect with 1/4 damage",
    },
    "dragonize": {
        "name": "Dragonize",
        "effect": "Normal-type moves become Dragon-type with 1.2x power boost",
    },
    "mega-sol": {
        "name": "Mega Sol",
        "effect": "User's attacks act as if Sun is always active",
    },
    "spicy-spray": {
        "name": "Spicy Spray",
        "effect": "Burns the attacker on contact",
    },
}


def build_patches(ncp_dir: Path, out_dir: Path) -> None:
    """全パッチファイルを生成する。"""
    today = str(date.today())
    meta_base = {
        "game": "Pokemon Champions",
        "game_version": "1.0.0",
        "source": "NCP VGC Damage Calculator",
        "last_updated": today,
    }

    # 1. 新メガシンカ
    print("[1/4] 新メガシンカ抽出中...")
    megas = parse_new_megas(ncp_dir)
    mega_dict: dict[str, dict] = {}
    for mega in megas:
        name = mega.pop("name")
        mega_dict[name] = mega
    print(f"  → {len(mega_dict)} 種の新メガシンカ")

    # 2. 既存ポケモンの種族値変更
    print("[2/4] 種族値変更抽出中...")
    stat_changes = parse_stat_changes(ncp_dir)
    pokemon_patch: dict = {
        "_meta": {**meta_base, "description": "チャンピオンズで変更された既存ポケモンの種族値パッチ"},
    }
    for name, changes in stat_changes.items():
        pokemon_patch[name] = {"base_stats": changes}
    _write_json(out_dir / "pokemon_patch.json", pokemon_patch)
    print(f"  → {len(stat_changes)} 件の種族値変更")

    # 3. 技変更
    print("[3/4] 技データ抽出中...")
    move_changes = parse_move_changes(ncp_dir)
    new_moves = parse_new_moves(ncp_dir)

    moves_patch: dict = {
        "_meta": {**meta_base, "description": "チャンピオンズで変更された技データのパッチ（威力変更・クールダウン）"},
    }
    moves_patch.update(move_changes)
    _write_json(out_dir / "moves_patch.json", moves_patch)
    print(f"  → {len(move_changes)} 件の技変更, {len(new_moves)} 新技")

    # 4. new_entries.json
    print("[4/4] new_entries.json 生成中...")
    new_entries: dict = {
        "_meta": {**meta_base, "description": "チャンピオンズで追加された新メガシンカ・新技・新とくせい"},
        "mega_evolutions": mega_dict,
        "new_moves": new_moves,
        "new_abilities": NEW_ABILITIES,
    }
    _write_json(out_dir / "new_entries.json", new_entries)
    print(f"  → {len(mega_dict)} メガシンカ, {len(new_moves)} 新技, {len(NEW_ABILITIES)} 新とくせい")

    # changelog
    changelog_path = out_dir / "changelog.md"
    changelog_path.write_text(f"""# Champions Override Changelog

## {today} - NCP VGC Calc データ抽出
- 新メガシンカ: {len(mega_dict)} 種
- 種族値変更: {len(stat_changes)} 件（{', '.join(stat_changes.keys())}）
- 技変更: {len(move_changes)} 件（威力/クールダウン）
- 新技: {len(new_moves)} 件
- 新とくせい: {len(NEW_ABILITIES)} 件
- ソース: NCP VGC Damage Calculator (github.com/nerd-of-now/NCP-VGC-Damage-Calculator)
""", encoding="utf-8")

    print("\n完了!")


def main() -> None:
    parser = argparse.ArgumentParser(description="NCP VGC Calc → champions_override 変換")
    parser.add_argument("--ncp-dir", type=Path, required=True, help="NCP VGC Calc の script_res/")
    parser.add_argument(
        "--out-dir", type=Path,
        default=Path(__file__).resolve().parent.parent.parent / "data" / "champions_override",
    )
    args = parser.parse_args()
    build_patches(args.ncp_dir, args.out_dir)


if __name__ == "__main__":
    main()
