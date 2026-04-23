"""ポケモン徹底攻略 (yakkun.com) 「よく使うわざ」データの取得スクリプト.

https://yakkun.com/ch/zukan/n{dex_num} のチャンピオンズ個別ページから
「よく使うわざ」欄を抽出し、Showdown key 形式に変換して JSON に出力する。

pikalytics / champions_stats の使用率データが無いポケモンのフォールバックとして使う。
既存の `_merge_usage_data` が priority 順に最初の非空ソースを採る動作により、
このソースを priority の末尾に置くと自動的に fallback として機能する。

使い方::

    # HTML 構造確認 (2体のみ取得)
    python scripts/fetch_yakkun_usage.py --probe

    # 全件取得 (legal_base_species_keys 全件, 185体)
    python scripts/fetch_yakkun_usage.py

    # リクエスト間隔変更 (デフォルト 1.5秒)
    python scripts/fetch_yakkun_usage.py --delay 2.0

依存: beautifulsoup4 (pip install beautifulsoup4)
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

try:
    from bs4 import BeautifulSoup
except ImportError:
    print(
        "beautifulsoup4 が必要です: pip install beautifulsoup4",
        file=sys.stderr,
    )
    sys.exit(1)

_BASE_URL = "https://yakkun.com/ch/zukan"
_USER_AGENT = "PokeScouter/0.1"
_DEFAULT_DELAY = 1.5
_DEFAULT_OUTPUT_DIR = Path(__file__).parent.parent / "data" / "yakkun"
_DATA_DIR = Path(__file__).parent.parent / "data"
_NAMES_PATH = _DATA_DIR / "names" / "ja.json"
_OVERRIDE_DIR = _DATA_DIR / "champions_override"
_SNAPSHOT_DIR = _DATA_DIR / "showdown" / "champions-bss-reg-ma"
_REQUEST_TIMEOUT = 30


# ---------------------------------------------------------------------------
# HTTP (EUC-JP デコード)
# ---------------------------------------------------------------------------

def _fetch_html(url: str, *, quiet: bool = False) -> str | None:
    """yakkun.com から HTML を取得する (EUC-JP デコード). 失敗時は None."""
    request = Request(url, headers={"User-Agent": _USER_AGENT})
    try:
        with urlopen(request, timeout=_REQUEST_TIMEOUT) as response:
            raw_bytes = response.read()
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

    # yakkun.com は EUC-JP。meta charset を確認しつつ EUC-JP をデフォルトに。
    try:
        return raw_bytes.decode("euc_jp", errors="replace")
    except Exception:
        return raw_bytes.decode("utf-8", errors="replace")


# ---------------------------------------------------------------------------
# 名前辞書 (champions_stats と同じ仕組み)
# ---------------------------------------------------------------------------

_FULLWIDTH_TO_HALF = str.maketrans(
    "ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ０１２３４５６７８９",
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
)


def _normalize_ja(name: str) -> str:
    return name.strip().translate(_FULLWIDTH_TO_HALF)


def _build_moves_map() -> dict[str, str]:
    """日本語技名 → Showdown key の辞書を構築."""
    mapping: dict[str, str] = {}
    if _NAMES_PATH.exists():
        with open(_NAMES_PATH, encoding="utf-8") as f:
            data = json.load(f)
        for k, v in data.get("moves", {}).items():
            mapping[str(k)] = str(v)
    # champions_override のパッチ
    override_path = _OVERRIDE_DIR / "move_names_ja.json"
    if override_path.exists():
        with open(override_path, encoding="utf-8") as f:
            patch = json.load(f)
        for k, v in patch.get("moves", {}).items():
            mapping[str(k)] = str(v)
    return mapping


def _resolve_ja(name: str, mapping: dict[str, str]) -> str | None:
    """日本語技名を Showdown key に解決."""
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


# ---------------------------------------------------------------------------
# 対象ポケモンリスト
# ---------------------------------------------------------------------------

def _load_targets() -> list[tuple[str, int, str]]:
    """format.json + pokemon.json から (base_species_key, dex_num, ja_name) 一覧を返す.

    ja_name はログ表示・デバッグ用 (解決は dex_num と base_species_key で完結)。
    """
    format_path = _SNAPSHOT_DIR / "format.json"
    pokemon_path = _SNAPSHOT_DIR / "pokemon.json"
    if not format_path.exists() or not pokemon_path.exists():
        print(
            f"ERROR: Showdown snapshot が見つかりません: {_SNAPSHOT_DIR}",
            file=sys.stderr,
        )
        return []

    with open(format_path, encoding="utf-8") as f:
        fmt = json.load(f)
    with open(pokemon_path, encoding="utf-8") as f:
        pok = json.load(f)

    # ja.json からポケモン名の逆引き (key → ja_name)
    ja_names: dict[str, str] = {}
    if _NAMES_PATH.exists():
        with open(_NAMES_PATH, encoding="utf-8") as f:
            names_data = json.load(f)
        for ja, key in names_data.get("pokemon", {}).items():
            ja_names.setdefault(str(key), str(ja))

    targets: list[tuple[str, int, str]] = []
    seen_nums: set[int] = set()
    for base_key in fmt.get("legal_base_species_keys", []):
        entry = pok.get(base_key)
        if not isinstance(entry, dict):
            continue
        num = entry.get("num")
        if not isinstance(num, int) or num in seen_nums:
            continue
        seen_nums.add(num)
        ja = ja_names.get(base_key) or entry.get("name", base_key)
        targets.append((base_key, num, ja))
    return targets


# ---------------------------------------------------------------------------
# HTML パーサー
# ---------------------------------------------------------------------------
# yakkun のチャンピオンズ個別ページ (/ch/zukan/n{num}) は技一覧を以下の構造で持つ。
#
#   <table id="move_list">
#     <tr class="move_main_row t11 c1 a0 pop_move">  ← pop_move が「人気」タグ
#       <td class="move_name_cell">
#         <div class="move_name_container">
#           <div class="move_name">
#             <a href="./search/?move=452">ウッドハンマー</a>
#             <div class="pop_move">人気</div>
#           </div>
#         </div>
#       </td>
#     </tr>
#   </table>
#
# 採用率 (%) は yakkun の本ページには存在せず、「人気」タグで二値的に表現される。
# よって usage_percent は None で格納する (UI 側で % 表記なしで描画される)。


def _parse_yakkun_page(html: str) -> list[tuple[str, float | None]]:
    """yakkun ページから「人気」タグ付きの技一覧を抽出する.

    Returns:
        [(技名_日本語, None), ...]  — yakkun は採用率を出さないので常に None
    """
    soup = BeautifulSoup(html, "html.parser")
    popular_rows = [
        row for row in soup.find_all("tr", class_="move_main_row")
        if "pop_move" in (row.get("class") or [])
    ]

    moves: list[tuple[str, float | None]] = []
    for row in popular_rows:
        move_div = row.find("div", class_="move_name")
        if move_div is None:
            continue
        link = move_div.find("a")
        name = (link.get_text(strip=True) if link else "").strip()
        if not name:
            continue
        moves.append((name, None))
    return moves


# ---------------------------------------------------------------------------
# 変換
# ---------------------------------------------------------------------------

def _convert_moves(
    raw: list[tuple[str, float | None]],
    moves_map: dict[str, str],
    unresolved: list[str],
) -> list[dict[str, Any]]:
    """(ja_name, usage) リストを Showdown key 形式に変換."""
    seen: set[str] = set()
    result: list[dict[str, Any]] = []
    for ja_name, usage in raw:
        key = _resolve_ja(ja_name, moves_map)
        if not key:
            unresolved.append(ja_name)
            continue
        if key in seen:
            continue
        seen.add(key)
        result.append({"move_key": key, "usage_percent": usage})
    return result


# ---------------------------------------------------------------------------
# 実行ロジック
# ---------------------------------------------------------------------------

def run_probe(delay: float) -> int:
    """--probe モード: 先頭 2 体のページを取得して「人気」技を抽出・表示."""
    print("=== Probe mode ===", file=sys.stderr)

    targets = _load_targets()
    if not targets:
        return 1
    print(f"  Total targets: {len(targets)}", file=sys.stderr)

    moves_map = _build_moves_map()
    print(f"  moves_map entries: {len(moves_map)}", file=sys.stderr)

    for i, (base_key, num, ja_name) in enumerate(targets[:2]):
        if i > 0:
            time.sleep(delay)
        url = f"{_BASE_URL}/n{num}"
        print(f"\n--- {base_key} (dex={num}, ja={ja_name}) ---", file=sys.stderr)
        print(f"  URL: {url}", file=sys.stderr)

        html = _fetch_html(url)
        if html is None:
            print("  Fetch failed", file=sys.stderr)
            continue
        print(f"  HTML length: {len(html)} chars", file=sys.stderr)

        soup = BeautifulSoup(html, "html.parser")
        all_rows = soup.find_all("tr", class_="move_main_row")
        pop_rows = [r for r in all_rows if "pop_move" in (r.get("class") or [])]
        print(
            f"  move rows: {len(all_rows)} total, {len(pop_rows)} popular",
            file=sys.stderr,
        )

        moves = _parse_yakkun_page(html)
        print(f"  Extracted {len(moves)} popular moves:", file=sys.stderr)
        for name, _ in moves:
            print(f"    - {name}", file=sys.stderr)

        unresolved: list[str] = []
        converted = _convert_moves(moves, moves_map, unresolved)
        print(
            f"  Converted {len(converted)} moves (unresolved={len(unresolved)})",
            file=sys.stderr,
        )
        for item in converted:
            print(f"    {item}", file=sys.stderr)
        if unresolved:
            print(f"  Unresolved names: {unresolved}", file=sys.stderr)

    return 0


def run_fetch(output_dir: Path, delay: float, dry_run: bool) -> int:
    """全件取得."""
    print("=== Yakkun usage data fetch ===", file=sys.stderr)

    moves_map = _build_moves_map()
    print(f"  moves_map entries: {len(moves_map)}", file=sys.stderr)

    targets = _load_targets()
    if not targets:
        return 1
    total = len(targets)
    print(f"  Targets: {total}", file=sys.stderr)

    results: dict[str, dict[str, Any]] = {}
    unresolved: list[str] = []
    failed_keys: list[str] = []
    empty_keys: list[str] = []

    for i, (base_key, num, ja_name) in enumerate(targets, 1):
        if i > 1:
            time.sleep(delay)
        url = f"{_BASE_URL}/n{num}"
        print(
            f"  [{i:>3}/{total}] {base_key} (n{num}, {ja_name}) ... ",
            end="", flush=True, file=sys.stderr,
        )

        html = _fetch_html(url, quiet=True)
        if html is None:
            print("FETCH FAILED", file=sys.stderr)
            failed_keys.append(base_key)
            continue

        raw_moves = _parse_yakkun_page(html)
        converted = _convert_moves(raw_moves, moves_map, unresolved)
        if not converted:
            print("empty", file=sys.stderr)
            empty_keys.append(base_key)
            continue

        print(f"OK (moves={len(converted)})", file=sys.stderr)
        results[base_key] = {
            "moves": converted,
            "items": [],
            "abilities": [],
        }

    meta: dict[str, Any] = {
        "source": "yakkun",
        "format": "single",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "pokemon_count": len(results),
        "fetch_attempted": total,
        "fetch_failed_count": len(failed_keys),
        "empty_count": len(empty_keys),
    }
    if failed_keys:
        meta["fetch_failed_keys"] = sorted(failed_keys)
    if empty_keys:
        meta["empty_keys"] = sorted(empty_keys)

    output = {
        "_meta": meta,
        "pokemon": results,
    }

    if not dry_run:
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / "single.json"
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
        print(f"\nOutput: {output_path}", file=sys.stderr)
    else:
        print("\n[dry-run] skipped write", file=sys.stderr)

    print(f"\n=== Summary ===", file=sys.stderr)
    print(f"  Success: {len(results)}", file=sys.stderr)
    print(f"  Empty:   {len(empty_keys)}", file=sys.stderr)
    print(f"  Failed:  {len(failed_keys)}", file=sys.stderr)
    print(f"  Total:   {total}", file=sys.stderr)

    if unresolved:
        unique = sorted(set(unresolved))
        print(f"\n=== Unresolved move names: {len(unique)} unique ===", file=sys.stderr)
        for n in unique[:30]:
            print(f"    - {n}", file=sys.stderr)
        if len(unique) > 30:
            print(f"    ... and {len(unique) - 30} more", file=sys.stderr)

    return 0


def main() -> None:
    parser = argparse.ArgumentParser(
        description="yakkun.com 「よく使うわざ」フォールバックデータの取得スクリプト",
    )
    parser.add_argument("--probe", action="store_true", help="2 体取得して構造確認")
    parser.add_argument(
        "--output-dir", type=Path, default=_DEFAULT_OUTPUT_DIR,
        help=f"出力ディレクトリ (default: {_DEFAULT_OUTPUT_DIR})",
    )
    parser.add_argument(
        "--delay", type=float, default=_DEFAULT_DELAY,
        help=f"リクエスト間隔 (秒, default: {_DEFAULT_DELAY})",
    )
    parser.add_argument("--dry-run", action="store_true", help="書き出しスキップ")
    args = parser.parse_args()

    if args.probe:
        sys.exit(run_probe(args.delay))
    else:
        sys.exit(run_fetch(args.output_dir, args.delay, args.dry_run))


if __name__ == "__main__":
    main()
