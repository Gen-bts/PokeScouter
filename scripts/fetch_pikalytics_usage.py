"""Pikalytics 使用率データの取得スクリプト.

Pikalytics の AI 向けエンドポイントからポケモンの使用率統計を取得し、
Showdown key 形式に変換して JSON に出力する。

レスポンスは Markdown 形式で返される:
  - インデックス: 上位件数のポケモン使用率テーブル（全体使用率の参照用）
  - 詳細: 技・アイテム・とくせい・チームメイト等を含む構造化 Markdown

デフォルトでは ``data/showdown/champions-bss-reg-ma/format.json`` の
``legal_pokemon_keys`` に列挙された **フォーマット合法の全ポケモン** について
詳細 URL を取得する（個別ページはインデックス外でも存在する）。

使い方::

    # エンドポイントのフォーマット確認 (2-3体のみ取得)
    python scripts/fetch_pikalytics_usage.py --probe

    # フォーマット合法ポケモン全件の使用率データを取得（デフォルト）
    python scripts/fetch_pikalytics_usage.py

    # インデックス上位のみ取得（従来の軽量モード）
    python scripts/fetch_pikalytics_usage.py --source index

    # リクエスト間隔を変更 (デフォルト 0.5秒)
    python scripts/fetch_pikalytics_usage.py --delay 1.0

    # 出力先を変更
    python scripts/fetch_pikalytics_usage.py --output-dir data/pikalytics
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

_BASE_URL = "https://pikalytics.com/ai/pokedex/championspreview"
_USER_AGENT = "PokeScouter/0.1"
_DEFAULT_DELAY = 0.5
_DEFAULT_OUTPUT_DIR = Path(__file__).parent.parent / "data" / "pikalytics"
_SNAPSHOT_DIR = (
    Path(__file__).parent.parent
    / "data"
    / "showdown"
    / "champions-bss-reg-ma"
)
_REQUEST_TIMEOUT = 30


# ---------------------------------------------------------------------------
# Showdown key 変換
# ---------------------------------------------------------------------------

def _to_showdown_id(name: str) -> str:
    """Showdown の toID() 相当: 小文字化 + 英数字以外を除去."""
    return re.sub(r"[^a-z0-9]", "", name.lower())


def _build_name_to_key_map(snapshot_path: Path) -> dict[str, str]:
    """Showdown JSON の name → key マッピングを構築する."""
    if not snapshot_path.exists():
        return {}
    with open(snapshot_path, encoding="utf-8") as f:
        data = json.load(f)
    mapping: dict[str, str] = {}
    for key, entry in data.items():
        if key == "_meta":
            continue
        name = entry.get("name", "")
        if name:
            mapping[name.lower()] = key
            mapping[_to_showdown_id(name)] = key
        mapping[key] = key
    return mapping


def _resolve_key(name: str, name_to_key: dict[str, str]) -> str | None:
    """Pikalytics の名前を Showdown key に解決する."""
    lower = name.lower()
    if lower in name_to_key:
        return name_to_key[lower]
    normalized = _to_showdown_id(name)
    if normalized in name_to_key:
        return name_to_key[normalized]
    return None


def _load_legal_pokemon_keys(format_path: Path) -> list[str]:
    """format.json の legal_pokemon_keys をソートして返す."""
    if not format_path.exists():
        return []
    with open(format_path, encoding="utf-8") as f:
        data = json.load(f)
    keys = data.get("legal_pokemon_keys")
    if not isinstance(keys, list):
        return []
    return sorted({str(k) for k in keys})


def _build_index_usage_by_key(
    index_raw: str,
    pokemon_map: dict[str, str],
) -> dict[str, float]:
    """インデックスの全体使用率を Showdown key -> % に変換する."""
    out: dict[str, float] = {}
    for entry in _parse_index(index_raw):
        key = _resolve_key(str(entry["name"]), pokemon_map)
        if key:
            out[key] = float(entry["usage_percent"])
    return out


def _detail_url(display_name: str) -> str:
    """Pikalytics 詳細ページ URL（名前に空白等があればパスエンコード）."""
    # 英数字・ハイフン等は quote のデフォルトでそのまま
    segment = quote(display_name, safe="")
    return f"{_BASE_URL}/{segment}"


def _pikalytics_detail_name_candidates(
    display_name: str,
    base_species_name: str | None,
) -> list[str]:
    """詳細 URL 試行順。Showdown のフォーム名にページが無い場合は種名へフォールバック."""
    out: list[str] = []
    seen: set[str] = set()
    for cand in (display_name, base_species_name):
        if isinstance(cand, str):
            c = cand.strip()
            if c and c not in seen:
                out.append(c)
                seen.add(c)
    return out


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

def _fetch_text(url: str, *, quiet_http: bool = False) -> str | None:
    """URL からテキストを取得する.失敗時は None を返す."""
    request = Request(url, headers={"User-Agent": _USER_AGENT})
    try:
        with urlopen(request, timeout=_REQUEST_TIMEOUT) as response:
            return response.read().decode("utf-8")
    except HTTPError as e:
        if not (quiet_http and e.code == 404):
            print(f"  HTTP {e.code}: {url}", file=sys.stderr)
        return None
    except URLError as e:
        print(f"  URL error: {e.reason} ({url})", file=sys.stderr)
        return None


# ---------------------------------------------------------------------------
# Markdown パーサー
# ---------------------------------------------------------------------------

def _parse_index(md: str) -> list[dict[str, str | float]]:
    """インデックス Markdown からポケモン一覧を抽出する.

    テーブル行: | 1 | **Incineroar** | 48.27% | [View](...) | [AI](...) |
    """
    results: list[dict[str, str | float]] = []
    # Markdown テーブル行をパース
    row_re = re.compile(
        r"\|\s*\d+\s*\|\s*\*\*(.+?)\*\*\s*\|\s*([\d.]+)%",
    )
    for m in row_re.finditer(md):
        name = m.group(1).strip()
        usage = float(m.group(2))
        results.append({"name": name, "usage_percent": usage})
    return results


def _parse_bullet_section(md: str, section_header: str) -> list[tuple[str, float]]:
    """指定セクションの箇条書きを解析する.

    形式: - **Name**: XX.XXX%
    """
    # セクション開始位置を探す
    pattern = re.compile(
        rf"^##\s+{re.escape(section_header)}\s*$",
        re.MULTILINE,
    )
    match = pattern.search(md)
    if not match:
        return []

    # 次の ## までのブロックを取得
    start = match.end()
    next_section = re.search(r"^##\s", md[start:], re.MULTILINE)
    block = md[start:start + next_section.start()] if next_section else md[start:]

    # 箇条書きをパース: - **Name**: XX.XXX%
    item_re = re.compile(r"-\s+\*\*(.+?)\*\*:\s*([\d.]+)%")
    results: list[tuple[str, float]] = []
    for m in item_re.finditer(block):
        results.append((m.group(1).strip(), float(m.group(2))))
    return results


def _parse_detail(
    md: str,
    pokemon_name: str,
    pokemon_map: dict[str, str],
    move_map: dict[str, str],
    item_map: dict[str, str],
    ability_map: dict[str, str],
    unresolved: dict[str, list[str]],
) -> dict | None:
    """詳細 Markdown をパースしてポケモンデータを構築する."""
    pokemon_key = _resolve_key(pokemon_name, pokemon_map)
    if not pokemon_key:
        unresolved.setdefault("pokemon", []).append(pokemon_name)
        return None

    result: dict = {
        "moves": [],
        "items": [],
        "abilities": [],
        "teammates": [],
    }

    # --- 技 ---
    for name, usage in _parse_bullet_section(md, "Common Moves"):
        move_key = _resolve_key(name, move_map)
        if move_key:
            result["moves"].append({"move_key": move_key, "usage_percent": usage})
        else:
            unresolved.setdefault("moves", []).append(name)

    # --- アイテム ---
    for name, usage in _parse_bullet_section(md, "Common Items"):
        item_key = _resolve_key(name, item_map)
        if item_key:
            result["items"].append({"item_key": item_key, "usage_percent": usage})
        else:
            unresolved.setdefault("items", []).append(name)

    # --- とくせい ---
    for name, usage in _parse_bullet_section(md, "Common Abilities"):
        ability_key = _resolve_key(name, ability_map)
        if ability_key:
            result["abilities"].append(
                {"ability_key": ability_key, "usage_percent": usage},
            )
        else:
            unresolved.setdefault("abilities", []).append(name)

    # --- チームメイト ---
    for name, usage in _parse_bullet_section(md, "Common Teammates"):
        teammate_key = _resolve_key(name, pokemon_map)
        if teammate_key:
            result["teammates"].append(
                {"pokemon_key": teammate_key, "usage_percent": usage},
            )

    return result


# ---------------------------------------------------------------------------
# メインロジック
# ---------------------------------------------------------------------------

def run_probe(delay: float) -> int:
    """--probe モード: エンドポイントの疎通・フォーマット確認."""
    print("=== Probe mode ===", file=sys.stderr)
    print(f"Index URL: {_BASE_URL}", file=sys.stderr)

    # 1. インデックス取得
    print("\n--- Index ---", file=sys.stderr)
    index_raw = _fetch_text(_BASE_URL)
    if index_raw is None:
        print("ERROR: failed to fetch index", file=sys.stderr)
        return 1

    pokemon_list = _parse_index(index_raw)
    print(f"Parsed {len(pokemon_list)} pokemon from index", file=sys.stderr)
    for entry in pokemon_list[:5]:
        print(f"  {entry['name']}: {entry['usage_percent']}%", file=sys.stderr)

    # 2. 詳細取得 (先頭 2件のみ)
    snapshot_dir = _SNAPSHOT_DIR
    move_map = _build_name_to_key_map(snapshot_dir / "moves.json")
    item_map = _build_name_to_key_map(snapshot_dir / "items.json")
    ability_map = _build_name_to_key_map(snapshot_dir / "abilities.json")
    pokemon_map = _build_name_to_key_map(snapshot_dir / "pokemon.json")

    for entry in pokemon_list[:2]:
        name = entry["name"]
        time.sleep(delay)
        url = _detail_url(name)
        print(f"\n--- Detail: {name} ({url}) ---", file=sys.stderr)
        detail_raw = _fetch_text(url)
        if detail_raw is None:
            print("  Fetch failed", file=sys.stderr)
            continue

        unresolved: dict[str, list[str]] = {}
        parsed = _parse_detail(
            detail_raw, name,
            pokemon_map, move_map, item_map, ability_map,
            unresolved,
        )
        if parsed:
            print(f"  Moves: {len(parsed['moves'])}", file=sys.stderr)
            for m in parsed["moves"][:5]:
                print(f"    {m['move_key']}: {m['usage_percent']}%", file=sys.stderr)
            print(f"  Items: {len(parsed['items'])}", file=sys.stderr)
            print(f"  Abilities: {len(parsed['abilities'])}", file=sys.stderr)
            print(f"  Teammates: {len(parsed['teammates'])}", file=sys.stderr)
        if unresolved:
            print(f"  Unresolved: {unresolved}", file=sys.stderr)

    return 0


def run_fetch(
    output_dir: Path,
    snapshot_dir: Path,
    delay: float,
    dry_run: bool,
    source: str,
) -> int:
    """全データ取得モード."""
    print("=== Pikalytics usage data fetch ===", file=sys.stderr)

    # --- Showdown マッピング構築 ---
    print("Loading Showdown data...", file=sys.stderr)
    pokemon_json_path = snapshot_dir / "pokemon.json"
    with open(pokemon_json_path, encoding="utf-8") as f:
        pokemon_by_key: dict[str, dict] = json.load(f)
    if "_meta" in pokemon_by_key:
        pokemon_by_key.pop("_meta", None)

    pokemon_map = _build_name_to_key_map(pokemon_json_path)
    move_map = _build_name_to_key_map(snapshot_dir / "moves.json")
    item_map = _build_name_to_key_map(snapshot_dir / "items.json")
    ability_map = _build_name_to_key_map(snapshot_dir / "abilities.json")
    print(
        f"  Mappings: pokemon={len(pokemon_map)}, "
        f"moves={len(move_map)}, items={len(item_map)}, "
        f"abilities={len(ability_map)}",
        file=sys.stderr,
    )

    # --- インデックス（全体使用率のマージ用） ---
    index_usage: dict[str, float] = {}
    print(f"\nFetching index: {_BASE_URL}", file=sys.stderr)
    index_raw = _fetch_text(_BASE_URL)
    if index_raw is None:
        print("  WARNING: index fetch failed; usage_percent は 0 埋め", file=sys.stderr)
    else:
        index_usage = _build_index_usage_by_key(index_raw, pokemon_map)
        print(f"  Index rows with resolved keys: {len(index_usage)}", file=sys.stderr)

    # --- 取得対象ジョブを組み立て ---
    jobs: list[tuple[str, str]] = []
    if source == "index":
        if index_raw is None:
            print("ERROR: index required for --source index", file=sys.stderr)
            return 1
        pokemon_list = _parse_index(index_raw)
        if not pokemon_list:
            print("ERROR: no pokemon parsed from index", file=sys.stderr)
            return 1
        for entry in pokemon_list:
            name = str(entry["name"])
            key = _resolve_key(name, pokemon_map)
            if key:
                jobs.append((key, name))
        print(f"  Source=index: {len(jobs)} pokemon", file=sys.stderr)
    else:
        legal = _load_legal_pokemon_keys(snapshot_dir / "format.json")
        if not legal:
            print(
                f"ERROR: no legal_pokemon_keys in {snapshot_dir / 'format.json'}",
                file=sys.stderr,
            )
            return 1
        missing_name: list[str] = []
        for pk in legal:
            entry = pokemon_by_key.get(pk)
            display = (entry or {}).get("name")
            if not display:
                missing_name.append(pk)
                continue
            jobs.append((pk, str(display)))
        if missing_name:
            print(
                f"  WARNING: pokemon.json に name なし {len(missing_name)} 件（スキップ）",
                file=sys.stderr,
            )
        print(
            f"  Source=format (legal_pokemon_keys): {len(jobs)} pokemon",
            file=sys.stderr,
        )

    # --- 各ポケモン詳細取得 ---
    results: dict[str, dict] = {}
    unresolved: dict[str, list[str]] = {}
    failed_keys: list[str] = []
    success = 0
    failed = 0
    total = len(jobs)

    for i, (pokemon_key, display_name) in enumerate(jobs, 1):
        usage_percent = index_usage.get(pokemon_key, 0.0)

        if i > 1:
            time.sleep(delay)

        pdata = pokemon_by_key.get(pokemon_key) or {}
        base_sn = pdata.get("base_species_name")
        if isinstance(base_sn, str):
            base_sn = base_sn.strip() or None
        else:
            base_sn = None

        names_to_try = _pikalytics_detail_name_candidates(display_name, base_sn)
        print(
            f"  [{i:>3}/{total}] {pokemon_key} ({display_name}) ... ",
            end="", flush=True, file=sys.stderr,
        )

        detail_raw: str | None = None
        used_name: str | None = None
        for j, cand in enumerate(names_to_try):
            url = _detail_url(cand)
            detail_raw = _fetch_text(url, quiet_http=j > 0)
            if detail_raw is not None:
                used_name = cand
                break

        if detail_raw is None or used_name is None:
            print("FETCH FAILED", file=sys.stderr)
            failed_keys.append(pokemon_key)
            failed += 1
            continue

        via = ""
        if used_name != display_name:
            via = f" [via {used_name}]"

        parsed = _parse_detail(
            detail_raw, used_name,
            pokemon_map, move_map, item_map, ability_map,
            unresolved,
        )
        if parsed is None:
            print("PARSE FAILED", file=sys.stderr)
            failed_keys.append(pokemon_key)
            failed += 1
            continue

        parsed["usage_percent"] = usage_percent
        results[pokemon_key] = parsed
        move_count = len(parsed["moves"])
        print(f"OK (moves={move_count}){via}", file=sys.stderr)
        success += 1

    # --- 出力 ---
    meta_source = "format.legal_pokemon_keys" if source == "format" else "pikalytics.index"
    meta: dict[str, object] = {
        "source": "pikalytics",
        "format": "championspreview",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "pokemon_count": len(results),
        "fetch_source": meta_source,
        "index_usage_merged": bool(index_usage),
        "fetch_attempted": total,
        "fetch_failed_count": len(failed_keys),
    }
    if failed_keys:
        meta["fetch_failed_keys"] = sorted(failed_keys)
    output = {
        "_meta": meta,
        "pokemon": results,
    }

    if not dry_run:
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / "championspreview.json"
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
        print(f"\nOutput: {output_path}", file=sys.stderr)
    else:
        print("\n[dry-run] skipped write", file=sys.stderr)

    # --- サマリー ---
    print(f"\n=== Summary ===", file=sys.stderr)
    print(f"  Success: {success}", file=sys.stderr)
    print(f"  Failed:  {failed}", file=sys.stderr)
    print(f"  Total:   {total}", file=sys.stderr)

    if unresolved:
        print(f"\n=== Unresolved names ===", file=sys.stderr)
        for category, names_list in unresolved.items():
            unique = sorted(set(names_list))
            print(f"  {category}: {len(unique)} entries", file=sys.stderr)
            for n in unique[:20]:
                print(f"    - {n}", file=sys.stderr)
            if len(unique) > 20:
                print(f"    ... and {len(unique) - 20} more", file=sys.stderr)

    return 0


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Pikalytics usage data fetcher",
    )
    parser.add_argument(
        "--probe",
        action="store_true",
        help="Probe mode: fetch 2-3 pokemon and display format",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=_DEFAULT_OUTPUT_DIR,
        help=f"Output directory (default: {_DEFAULT_OUTPUT_DIR})",
    )
    parser.add_argument(
        "--snapshot-dir",
        type=Path,
        default=_SNAPSHOT_DIR,
        help=f"Showdown snapshot directory (default: {_SNAPSHOT_DIR})",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=_DEFAULT_DELAY,
        help=f"Request delay in seconds (default: {_DEFAULT_DELAY})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch but do not write output",
    )
    parser.add_argument(
        "--source",
        choices=("format", "index"),
        default="format",
        help=(
            "format: format.json の legal_pokemon_keys 全件（既定） / "
            "index: インデックス上位のみ"
        ),
    )
    args = parser.parse_args()

    if args.probe:
        sys.exit(run_probe(args.delay))
    else:
        sys.exit(
            run_fetch(
                args.output_dir,
                args.snapshot_dir,
                args.delay,
                args.dry_run,
                args.source,
            ),
        )


if __name__ == "__main__":
    main()
