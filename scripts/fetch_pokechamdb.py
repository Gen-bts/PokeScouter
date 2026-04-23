"""pokechamdb.com 使用率データの取得スクリプト.

ファンサイト https://pokechamdb.com/ からポケモンの詳細データ
(種族値・実数値・技/持ち物/特性/性格/努力値配分/チームメイト) を取得し、
Showdown key 形式に変換して JSON に出力する。

サイトは Next.js (App Router + RSC) で構築されており、
`self.__next_f.push(...)` に埋め込まれた RSC ペイロードを復号・解析する。

使い方::

    # HTML 構造確認 (2体のみ取得)
    python scripts/fetch_pokechamdb.py --probe

    # シングルフォーマット全件取得
    python scripts/fetch_pokechamdb.py

    # リクエスト間隔変更 (デフォルト 1.5秒)
    python scripts/fetch_pokechamdb.py --delay 2.0

    # シーズン指定 (デフォルトはランキングページから自動検出)
    python scripts/fetch_pokechamdb.py --season M-1
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

_BASE_URL = "https://pokechamdb.com"
_USER_AGENT = "PokeScouter/0.1"
_DEFAULT_DELAY = 1.5
_DEFAULT_OUTPUT_DIR = Path(__file__).parent.parent / "data" / "pokechamdb"
_DATA_DIR = Path(__file__).parent.parent / "data"
_NAMES_PATH = _DATA_DIR / "names" / "ja.json"
_OVERRIDE_DIR = _DATA_DIR / "champions_override"
_REQUEST_TIMEOUT = 30

# pokechamdb.com 固有のフォーム名エイリアス。
# ja.json の pokemon 辞書はベース名のみ保持するため、フォーム括弧つき表記は
# ここで個別にマップする (partner panel 等で出現する)。
_POKEMON_FORM_ALIASES_JA: dict[str, str] = {
    "イダイトウ(メス)": "basculegionf",
    "フラエッテ(えいえん)": "floetteeternal",
}

# 性格: 日本語 → Showdown key (25件、固定セット)
_JA_NATURE_TO_KEY: dict[str, str] = {
    "さみしがり": "lonely",
    "いじっぱり": "adamant",
    "やんちゃ": "naughty",
    "ゆうかん": "brave",
    "ずぶとい": "bold",
    "わんぱく": "impish",
    "のうてんき": "lax",
    "のんき": "relaxed",
    "ひかえめ": "modest",
    "おっとり": "mild",
    "うっかりや": "rash",
    "れいせい": "quiet",
    "おだやか": "calm",
    "おとなしい": "gentle",
    "しんちょう": "careful",
    "なまいき": "sassy",
    "おくびょう": "timid",
    "せっかち": "hasty",
    "ようき": "jolly",
    "むじゃき": "naive",
    "てれや": "bashful",
    "すなお": "docile",
    "がんばりや": "hardy",
    "まじめ": "serious",
    "きまぐれ": "quirky",
}

_FULLWIDTH_TO_HALF = str.maketrans(
    "ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ０１２３４５６７８９",
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
)


# ---------------------------------------------------------------------------
# HTTP / 名前辞書
# ---------------------------------------------------------------------------

def _fetch_html(url: str, *, quiet: bool = False) -> str | None:
    request = Request(url, headers={"User-Agent": _USER_AGENT})
    try:
        with urlopen(request, timeout=_REQUEST_TIMEOUT) as response:
            return response.read().decode("utf-8", errors="replace")
    except HTTPError as e:
        if not quiet:
            print(f"  HTTP {e.code}: {url}", file=sys.stderr)
        if e.code == 429:
            print("  Rate limited. Consider increasing --delay", file=sys.stderr)
        return None
    except URLError as e:
        if not quiet:
            print(f"  URL error: {e.reason} ({url})", file=sys.stderr)
        return None


def _normalize_ja(name: str) -> str:
    return name.strip().translate(_FULLWIDTH_TO_HALF)


def _resolve_ja(name: str, mapping: dict[str, str]) -> str | None:
    stripped = name.strip()
    result = mapping.get(stripped)
    if result is not None:
        return result
    normalized = _normalize_ja(stripped)
    if normalized != stripped:
        result = mapping.get(normalized)
        if result is not None:
            return result
    for dict_key, dict_val in mapping.items():
        if _normalize_ja(dict_key) == normalized:
            return dict_val
    return None


def _merge_override(
    maps: dict[str, dict[str, str]],
    category: str,
    path: Path,
    json_key: str,
) -> None:
    if not path.exists():
        return
    with open(path, encoding="utf-8") as f:
        patch = json.load(f)
    entries = patch.get(json_key, {})
    maps[category].update({str(k): str(v) for k, v in entries.items()})


def _build_ja_to_key_maps(
    names_path: Path = _NAMES_PATH,
    override_dir: Path = _OVERRIDE_DIR,
) -> dict[str, dict[str, str]]:
    if not names_path.exists():
        print(f"WARNING: {names_path} が見つかりません", file=sys.stderr)
        return {"pokemon": {}, "moves": {}, "items": {}, "abilities": {}}
    with open(names_path, encoding="utf-8") as f:
        data = json.load(f)
    maps: dict[str, dict[str, str]] = {}
    for category in ("pokemon", "moves", "items", "abilities"):
        raw = data.get(category, {})
        maps[category] = {str(k): str(v) for k, v in raw.items()}
    _merge_override(maps, "moves", override_dir / "move_names_ja.json", "moves")
    _merge_override(
        maps, "abilities", override_dir / "ability_names_ja.json", "abilities"
    )
    _merge_override(maps, "items", override_dir / "item_names_ja.json", "items")
    return maps


def _to_showdown_id(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


# ---------------------------------------------------------------------------
# RSC ペイロード解析
# ---------------------------------------------------------------------------

def _match_closer(text: str, open_idx: int, open_ch: str, close_ch: str) -> int:
    """文字列リテラルを認識してマッチするブラケット/ブレースの終端を返す."""
    depth = 0
    i = open_idx
    in_str = False
    esc = False
    while i < len(text):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        else:
            if ch == '"':
                in_str = True
            elif ch == open_ch:
                depth += 1
            elif ch == close_ch:
                depth -= 1
                if depth == 0:
                    return i
        i += 1
    return -1


def _extract_rsc_payload(html: str) -> str:
    """self.__next_f.push([n,"..."]) のペイロードを連結して復号する."""
    pushes = re.findall(
        r'self\.__next_f\.push\(\[(\d+),"(.*?)"\]\)', html, re.DOTALL
    )
    parts: list[str] = []
    for _code, payload in pushes:
        try:
            decoded = json.loads('"' + payload + '"')
        except (json.JSONDecodeError, ValueError):
            decoded = payload
        parts.append(decoded)
    return "".join(parts)


def _parse_main_block(rsc: str) -> dict[str, Any] | None:
    """baseStats + seasonLabel を持つメインブロックを抽出する."""
    for m in re.finditer(r'"pokemonJa"', rsc):
        bs = rsc.rfind("{", 0, m.start())
        if bs < 0:
            continue
        be = _match_closer(rsc, bs, "{", "}")
        if be < 0:
            continue
        try:
            obj = json.loads(rsc[bs : be + 1])
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict) and "baseStats" in obj and "seasonLabel" in obj:
            return obj
    return None


def _parse_panels(rsc: str) -> dict[str, list[dict[str, Any]]]:
    """iconLabel でキー付けされた UsagePanel の entries を返す.

    対応ラベル: MOVES, ITEMS, ABILITY, NATURE, PARTNER
    """
    panels: dict[str, list[dict[str, Any]]] = {}
    for m in re.finditer(r'"iconLabel":"([A-Z]+)"', rsc):
        label = m.group(1)
        if label in panels:
            continue  # 先勝ち: 最初の一致のみ採用
        bs = rsc.rfind("{", 0, m.start())
        if bs < 0:
            continue
        be = _match_closer(rsc, bs, "{", "}")
        if be < 0:
            continue
        try:
            obj = json.loads(rsc[bs : be + 1])
        except json.JSONDecodeError:
            continue
        entries = obj.get("entries")
        if isinstance(entries, list):
            panels[label] = entries
    return panels


def _parse_ev_spreads(rsc: str) -> list[tuple[int, dict[str, int], float]]:
    """努力値 (ポイント) 配分ランキングのテーブル行を抽出する.

    サイトは 0-32 ポイントスケールで表示する (1 pt = 8 EV 相当, 32 pt で 252 EV cap)。
    既存の champions_stats と同じスケールでそのまま保存する。
    """
    spreads: list[tuple[int, dict[str, int], float]] = []
    for m in re.finditer(r'\["\$","tr","(\d+)",', rsc):
        rank = int(m.group(1))
        ae = _match_closer(rsc, m.start(), "[", "]")
        if ae < 0:
            continue
        try:
            row = json.loads(rsc[m.start() : ae + 1])
        except json.JSONDecodeError:
            continue
        if not (
            isinstance(row, list)
            and len(row) >= 4
            and isinstance(row[3], dict)
        ):
            continue
        cells = row[3].get("children") or []
        if len(cells) < 8:
            continue

        def cell_children(cell: Any) -> Any:
            if (
                isinstance(cell, list)
                and len(cell) >= 4
                and isinstance(cell[3], dict)
            ):
                return cell[3].get("children")
            return None

        try:
            hp = int(cell_children(cells[1]))
            atk = int(cell_children(cells[2]))
            df = int(cell_children(cells[3]))
            spa = int(cell_children(cells[4]))
            spd = int(cell_children(cells[5]))
            spe = int(cell_children(cells[6]))
            pct_raw = cell_children(cells[7])
        except (TypeError, ValueError):
            continue
        if isinstance(pct_raw, list) and pct_raw:
            try:
                pct = float(pct_raw[0])
            except (TypeError, ValueError):
                continue
        else:
            continue
        spreads.append(
            (
                rank,
                {"hp": hp, "atk": atk, "def": df, "spa": spa, "spd": spd, "spe": spe},
                pct,
            )
        )
    return spreads


# ---------------------------------------------------------------------------
# 実数値 (Lv.50) 計算
# ---------------------------------------------------------------------------
# 1 ポイント = 8 EV (最大 32 pt → 252 EV cap)

def _ev_from_points(points: int) -> int:
    return min(points * 8, 252)


def _actual_hp(base: int, *, iv: int, ev_points: int, level: int = 50) -> int:
    ev = _ev_from_points(ev_points)
    return math.floor((2 * base + iv + ev // 4) * level / 100) + level + 10


def _actual_other(
    base: int, *, iv: int, ev_points: int, nature: float, level: int = 50
) -> int:
    ev = _ev_from_points(ev_points)
    pre_nature = math.floor((2 * base + iv + ev // 4) * level / 100) + 5
    return math.floor(pre_nature * nature)


def _build_actual_stats(base_stats: dict[str, int]) -> dict[str, dict[str, int]]:
    """Lv.50 の 最大値 / 準最大値 / 無振値 / 最低値 を計算する.

    - HP:
        max = IV 31, EV 252
        min = IV 0,  EV 0
    - その他:
        max       = IV 31, EV 252, 性格補正 x1.1
        semi_max  = IV 31, EV 252, 性格補正 x1.0
        no_invest = IV 31, EV 0,   性格補正 x1.0
        min       = IV 0,  EV 0,   性格補正 x0.9
    """
    out: dict[str, dict[str, int]] = {}
    out["hp"] = {
        "max": _actual_hp(base_stats["hp"], iv=31, ev_points=32),
        "min": _actual_hp(base_stats["hp"], iv=0, ev_points=0),
    }
    for key in ("atk", "def", "spa", "spd", "spe"):
        b = base_stats[key]
        out[key] = {
            "max": _actual_other(b, iv=31, ev_points=32, nature=1.1),
            "semi_max": _actual_other(b, iv=31, ev_points=32, nature=1.0),
            "no_invest": _actual_other(b, iv=31, ev_points=0, nature=1.0),
            "min": _actual_other(b, iv=0, ev_points=0, nature=0.9),
        }
    return out


# ---------------------------------------------------------------------------
# ランキングページ / 詳細ページ解析
# ---------------------------------------------------------------------------

def _parse_ranking_page(html: str) -> list[dict[str, Any]]:
    """トップページから /pokemon/<slug> へのリンクを抽出する."""
    results: list[dict[str, Any]] = []
    seen: set[str] = set()
    # 単純な正規表現で <a href="/pokemon/SLUG?..."> を拾う
    for m in re.finditer(
        r'<a[^>]+href="/pokemon/([^"?]+)\?[^"]*"[^>]*>(.*?)</a>',
        html,
        flags=re.DOTALL,
    ):
        slug = m.group(1)
        if slug in seen:
            continue
        seen.add(slug)
        # テキスト抽出: HTML タグを除去
        inner = re.sub(r"<[^>]+>", "", m.group(2))
        ja_name = re.sub(r"\s+", " ", inner).strip()
        ja_name = re.sub(r"^\d+\s*", "", ja_name)
        results.append(
            {"slug": slug, "ja_name": ja_name, "rank": len(results) + 1}
        )
    return results


def _detect_season(html: str) -> str | None:
    match = re.search(r'season=([A-Za-z0-9_-]+)', html)
    return match.group(1) if match else None


def _parse_detail_page(
    html: str, maps: dict[str, dict[str, str]], unresolved: dict[str, list[str]]
) -> dict[str, Any] | None:
    """個別ポケモンページから canonical エントリを構築する."""
    rsc = _extract_rsc_payload(html)
    main = _parse_main_block(rsc)
    if main is None:
        return None

    bs_raw = main.get("baseStats") or {}
    base_stats = {
        "hp": bs_raw.get("hp"),
        "atk": bs_raw.get("atk"),
        "def": bs_raw.get("def"),
        "spa": bs_raw.get("spAtk"),
        "spd": bs_raw.get("spDef"),
        "spe": bs_raw.get("speed"),
    }
    if None in base_stats.values():
        return None

    panels = _parse_panels(rsc)
    entry: dict[str, Any] = {
        "ja_name": main.get("pokemonJa"),
        "dex_no": main.get("dexNo"),
        "types": main.get("types"),
        "rank": main.get("rank"),
        "base_stats": base_stats,
        "actual_stats": _build_actual_stats(base_stats),
    }

    # 技
    moves: list[dict[str, Any]] = []
    for e in panels.get("MOVES", []):
        name = e.get("name")
        pct = e.get("percentage")
        if not name:
            continue
        key = _resolve_ja(name, maps["moves"])
        if key:
            moves.append({"move_key": key, "usage_percent": float(pct)})
        else:
            unresolved.setdefault("moves", []).append(name)
    entry["moves"] = moves

    # 持ち物
    items: list[dict[str, Any]] = []
    for e in panels.get("ITEMS", []):
        name = e.get("name")
        pct = e.get("percentage")
        if not name:
            continue
        key = _resolve_ja(name, maps["items"])
        if key:
            items.append({"item_key": key, "usage_percent": float(pct)})
        else:
            unresolved.setdefault("items", []).append(name)
    entry["items"] = items

    # 特性
    abilities: list[dict[str, Any]] = []
    for e in panels.get("ABILITY", []):
        name = e.get("name")
        pct = e.get("percentage")
        if not name:
            continue
        key = _resolve_ja(name, maps["abilities"])
        if key:
            abilities.append({"ability_key": key, "usage_percent": float(pct)})
        else:
            unresolved.setdefault("abilities", []).append(name)
    entry["abilities"] = abilities

    # 性格
    natures: list[dict[str, Any]] = []
    for e in panels.get("NATURE", []):
        name = e.get("name")
        pct = e.get("percentage")
        if not name:
            continue
        key = _JA_NATURE_TO_KEY.get(name.strip())
        if key:
            natures.append({"nature_key": key, "usage_percent": float(pct)})
        else:
            unresolved.setdefault("natures", []).append(name)
    entry["natures"] = natures

    # チームメイト (サイトは percentage=0 を返す → rank のみ保存)
    teammates: list[dict[str, Any]] = []
    for e in panels.get("PARTNER", []):
        name = e.get("name")
        rank = e.get("rank")
        if not name:
            continue
        key = _resolve_ja(name, maps["pokemon"]) or _POKEMON_FORM_ALIASES_JA.get(
            name.strip()
        )
        if key:
            teammates.append({"pokemon_key": key, "rank": rank})
        else:
            unresolved.setdefault("teammates", []).append(name)
    entry["teammates"] = teammates

    # 努力値配分
    ev_spreads: list[dict[str, Any]] = []
    for _rank, spread, pct in _parse_ev_spreads(rsc):
        ev_spreads.append({"spread": spread, "usage_percent": pct})
    entry["ev_spreads"] = ev_spreads

    return entry


# ---------------------------------------------------------------------------
# メインロジック
# ---------------------------------------------------------------------------

def _resolve_pokemon_key(
    slug: str, ja_name: str, maps: dict[str, dict[str, str]]
) -> str:
    """slug/日本語名から Showdown key を決定する."""
    ja_resolved = _resolve_ja(ja_name, maps["pokemon"]) or _POKEMON_FORM_ALIASES_JA.get(
        ja_name.strip()
    )
    if ja_resolved:
        return ja_resolved
    return _to_showdown_id(slug)


def run_probe(delay: float, season: str | None) -> int:
    print("=== Probe mode ===", file=sys.stderr)
    ranking_url = f"{_BASE_URL}/?format=single"
    if season:
        ranking_url = f"{_BASE_URL}/?season={season}&format=single"
    print(f"\n--- Ranking: {ranking_url} ---", file=sys.stderr)

    html = _fetch_html(ranking_url)
    if html is None:
        print("ERROR: ランキングページ取得失敗", file=sys.stderr)
        return 1

    ranking = _parse_ranking_page(html)
    detected = _detect_season(html)
    print(
        f"  HTML length: {len(html)} chars, "
        f"links: {len(ranking)}, detected season: {detected}",
        file=sys.stderr,
    )
    for entry in ranking[:5]:
        print(
            f"  #{entry['rank']} {entry['ja_name']} (slug={entry['slug']})",
            file=sys.stderr,
        )

    season_param = season or detected or "M-1"
    maps = _build_ja_to_key_maps()

    for entry in ranking[:2]:
        slug = entry["slug"]
        time.sleep(delay)
        detail_url = (
            f"{_BASE_URL}/pokemon/{slug}?season={season_param}&format=single"
        )
        print(f"\n--- Detail: {entry['ja_name']} ({detail_url}) ---", file=sys.stderr)
        detail_html = _fetch_html(detail_url)
        if detail_html is None:
            continue
        unresolved: dict[str, list[str]] = {}
        parsed = _parse_detail_page(detail_html, maps, unresolved)
        if parsed is None:
            print("  ERROR: メインブロックを抽出できませんでした", file=sys.stderr)
            continue
        print(f"  HTML length: {len(detail_html)} chars", file=sys.stderr)
        print(f"  base_stats: {parsed['base_stats']}", file=sys.stderr)
        print(f"  actual_stats[atk]: {parsed['actual_stats']['atk']}", file=sys.stderr)
        for field in (
            "moves",
            "items",
            "abilities",
            "natures",
            "ev_spreads",
            "teammates",
        ):
            print(f"  {field}: {len(parsed.get(field, []))} entries", file=sys.stderr)
            for item in (parsed.get(field) or [])[:2]:
                print(f"    {item}", file=sys.stderr)
        if unresolved:
            print(f"  Unresolved: {unresolved}", file=sys.stderr)
    return 0


def run_fetch(
    output_dir: Path,
    delay: float,
    dry_run: bool,
    season: str | None,
    limit: int | None,
) -> int:
    print("=== pokechamdb.com usage data fetch ===", file=sys.stderr)

    maps = _build_ja_to_key_maps()
    print(
        f"Name maps: pokemon={len(maps['pokemon'])}, "
        f"moves={len(maps['moves'])}, items={len(maps['items'])}, "
        f"abilities={len(maps['abilities'])}",
        file=sys.stderr,
    )

    ranking_url = f"{_BASE_URL}/?format=single"
    if season:
        ranking_url = f"{_BASE_URL}/?season={season}&format=single"
    print(f"\nFetching ranking: {ranking_url}", file=sys.stderr)

    html = _fetch_html(ranking_url)
    if html is None:
        print("ERROR: ランキングページ取得失敗", file=sys.stderr)
        return 1

    ranking = _parse_ranking_page(html)
    if not ranking:
        print("ERROR: ランキングからポケモンが抽出できませんでした", file=sys.stderr)
        return 1
    detected_season = _detect_season(html)
    season_param = season or detected_season or "M-1"
    print(f"  Season: {season_param}", file=sys.stderr)
    print(f"  Pokemon count: {len(ranking)}", file=sys.stderr)

    if limit is not None:
        ranking = ranking[:limit]

    results: dict[str, dict[str, Any]] = {}
    unresolved: dict[str, list[str]] = {}
    failed_slugs: list[str] = []
    total = len(ranking)

    for i, entry in enumerate(ranking, 1):
        slug = str(entry["slug"])
        ja_name = str(entry["ja_name"])
        if i > 1:
            time.sleep(delay)
        detail_url = f"{_BASE_URL}/pokemon/{slug}?season={season_param}&format=single"
        print(f"  [{i:>3}/{total}] {slug} ({ja_name}) ... ", end="", flush=True, file=sys.stderr)

        detail_html = _fetch_html(detail_url, quiet=True)
        if detail_html is None:
            print("FETCH FAILED", file=sys.stderr)
            failed_slugs.append(slug)
            continue

        parsed = _parse_detail_page(detail_html, maps, unresolved)
        if parsed is None:
            print("PARSE FAILED (no main block)", file=sys.stderr)
            failed_slugs.append(slug)
            continue

        pokemon_key = _resolve_pokemon_key(slug, ja_name, maps)
        moves_count = len(parsed.get("moves") or [])
        ev_count = len(parsed.get("ev_spreads") or [])
        print(f"OK (key={pokemon_key}, moves={moves_count}, ev={ev_count})", file=sys.stderr)
        # 内部用の ja_name / rank は残すが、canonical 下流には不要なので slug 情報を __source に退避
        parsed["__source_slug"] = slug
        results[pokemon_key] = parsed

    meta: dict[str, Any] = {
        "source": "pokechamdb",
        "format": "single",
        "season": season_param,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "pokemon_count": len(results),
        "fetch_attempted": total,
        "fetch_failed_count": len(failed_slugs),
    }
    if failed_slugs:
        meta["fetch_failed_slugs"] = sorted(failed_slugs)
    output = {"_meta": meta, "pokemon": results}

    if not dry_run:
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / "single.json"
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
        print(f"\nOutput: {output_path}", file=sys.stderr)
    else:
        print("\n[dry-run] skipped write", file=sys.stderr)

    print("\n=== Summary ===", file=sys.stderr)
    print(f"  Success: {len(results)}", file=sys.stderr)
    print(f"  Failed:  {len(failed_slugs)}", file=sys.stderr)
    print(f"  Total:   {total}", file=sys.stderr)
    if unresolved:
        print("\n=== Unresolved names ===", file=sys.stderr)
        for cat, names in unresolved.items():
            uniq = sorted(set(names))
            print(f"  {cat}: {len(uniq)} entries", file=sys.stderr)
            for n in uniq[:20]:
                print(f"    - {n}", file=sys.stderr)
            if len(uniq) > 20:
                print(f"    ... and {len(uniq) - 20} more", file=sys.stderr)

    return 0


def main() -> None:
    parser = argparse.ArgumentParser(
        description="pokechamdb.com usage data fetcher",
    )
    parser.add_argument(
        "--probe",
        action="store_true",
        help="Probe モード: ランキング + 2体を取得して構造を表示",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=_DEFAULT_OUTPUT_DIR,
        help=f"出力ディレクトリ (default: {_DEFAULT_OUTPUT_DIR})",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=_DEFAULT_DELAY,
        help=f"リクエスト間隔 (秒, default: {_DEFAULT_DELAY})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="取得のみ、ファイル書き出しはスキップ",
    )
    parser.add_argument(
        "--season",
        type=str,
        default=None,
        help="シーズンパラメータ (default: ランキングから自動検出)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="取得件数を制限 (テスト用)",
    )
    args = parser.parse_args()
    if args.probe:
        sys.exit(run_probe(args.delay, args.season))
    else:
        sys.exit(
            run_fetch(
                args.output_dir,
                args.delay,
                args.dry_run,
                args.season,
                args.limit,
            )
        )


if __name__ == "__main__":
    main()
