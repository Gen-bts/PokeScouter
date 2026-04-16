"""pokemon-champions-stats.vercel.app 使用率データの取得スクリプト.

ファンサイト https://pokemon-champions-stats.vercel.app/ から
ポケモンの使用率統計（技・持ち物・特性・性格・努力値・チームメイト）を取得し、
Showdown key 形式に変換して JSON に出力する。

サイトは Next.js RSC で構築されており、HTML をスクレイピングして解析する。
日本語名は data/names/ja.json を使って Showdown key に変換する。

使い方::

    # HTML 構造確認 (2体のみ取得)
    python scripts/fetch_champions_stats.py --probe

    # シングルフォーマットの使用率データを全件取得 (デフォルト)
    python scripts/fetch_champions_stats.py

    # リクエスト間隔を変更 (デフォルト 1.5秒)
    python scripts/fetch_champions_stats.py --delay 2.0

    # 出力先を変更
    python scripts/fetch_champions_stats.py --output-dir data/champions_stats

依存: beautifulsoup4 (pip install beautifulsoup4)
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
from urllib.request import Request, urlopen

try:
    from bs4 import BeautifulSoup, Tag
except ImportError:
    print(
        "beautifulsoup4 が必要です: pip install beautifulsoup4",
        file=sys.stderr,
    )
    sys.exit(1)

_BASE_URL = "https://pokemon-champions-stats.vercel.app"
_USER_AGENT = "PokeScouter/0.1"
_DEFAULT_DELAY = 1.5
_DEFAULT_OUTPUT_DIR = Path(__file__).parent.parent / "data" / "champions_stats"
_DATA_DIR = Path(__file__).parent.parent / "data"
_NAMES_PATH = _DATA_DIR / "names" / "ja.json"
_OVERRIDE_DIR = _DATA_DIR / "champions_override"
_REQUEST_TIMEOUT = 30

# ---------------------------------------------------------------------------
# 性格: 日本語 → Showdown key (25件、固定セット)
# ---------------------------------------------------------------------------

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
    "がんばりや": "hardy",
    "すなお": "docile",
    "きまぐれ": "quirky",
    "まじめ": "serious",
}

# 努力値ステータス名: 日本語 → Showdown key
_JA_STAT_TO_KEY: dict[str, str] = {
    "HP": "hp",
    "こうげき": "atk",
    "ぼうぎょ": "def",
    "とくこう": "spa",
    "とくぼう": "spd",
    "すばやさ": "spe",
    # 短縮形
    "攻": "atk",
    "防": "def",
    "特攻": "spa",
    "特防": "spd",
    "素早": "spe",
}


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

def _fetch_html(url: str, *, quiet: bool = False) -> str | None:
    """URL から HTML を取得する。失敗時は None を返す。"""
    request = Request(url, headers={"User-Agent": _USER_AGENT})
    try:
        with urlopen(request, timeout=_REQUEST_TIMEOUT) as response:
            return response.read().decode("utf-8")
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


# ---------------------------------------------------------------------------
# 名前辞書
# ---------------------------------------------------------------------------

def _build_ja_to_key_maps(
    names_path: Path,
    override_dir: Path | None = None,
) -> dict[str, dict[str, str]]:
    """ja.json + champions_override から日本語名 → Showdown key の辞書を構築する.

    ja.json だけでは技・特性の収録が不十分なため、
    champions_override/move_names_ja.json と ability_names_ja.json をマージする。

    Returns:
        {"pokemon": {ja_name: key}, "moves": {...}, "items": {...}, "abilities": {...}}
    """
    if not names_path.exists():
        print(f"WARNING: {names_path} が見つかりません", file=sys.stderr)
        return {"pokemon": {}, "moves": {}, "items": {}, "abilities": {}}

    with open(names_path, encoding="utf-8") as f:
        data = json.load(f)

    maps: dict[str, dict[str, str]] = {}
    for category in ("pokemon", "moves", "items", "abilities"):
        raw = data.get(category, {})
        maps[category] = {str(k): str(v) for k, v in raw.items()}

    # champions_override のパッチをマージ (技・特性の不足分を補完)
    if override_dir is None:
        override_dir = _OVERRIDE_DIR
    _merge_override(maps, "moves", override_dir / "move_names_ja.json", "moves")
    _merge_override(maps, "abilities", override_dir / "ability_names_ja.json", "abilities")

    return maps


def _merge_override(
    maps: dict[str, dict[str, str]],
    category: str,
    path: Path,
    json_key: str,
) -> None:
    """champions_override の JSON パッチを辞書にマージする."""
    if not path.exists():
        return
    with open(path, encoding="utf-8") as f:
        patch = json.load(f)
    entries = patch.get(json_key, {})
    maps[category].update({str(k): str(v) for k, v in entries.items()})


# 全角英数 → 半角英数 の変換テーブル
_FULLWIDTH_TO_HALF = str.maketrans(
    "ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ０１２３４５６７８９",
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
)


def _normalize_ja(name: str) -> str:
    """日本語名を正規化する（全角→半角変換）."""
    return name.strip().translate(_FULLWIDTH_TO_HALF)


def _resolve_ja(
    name: str,
    mapping: dict[str, str],
) -> str | None:
    """日本語名を Showdown key に解決する.

    完全一致を試し、見つからなければ全角/半角を正規化して再検索する。
    """
    stripped = name.strip()
    result = mapping.get(stripped)
    if result is not None:
        return result
    # 全角→半角正規化で再試行
    normalized = _normalize_ja(stripped)
    if normalized != stripped:
        result = mapping.get(normalized)
        if result is not None:
            return result
    # 逆方向 (辞書側が全角の場合): 辞書キーを正規化してマッチ
    for dict_key, dict_val in mapping.items():
        if _normalize_ja(dict_key) == normalized:
            return dict_val
    return None


# ---------------------------------------------------------------------------
# HTML パーサー
# ---------------------------------------------------------------------------

def _parse_ranking_page(html: str) -> list[dict[str, str | int]]:
    """ランキングページからポケモン一覧を抽出する.

    Returns:
        [{"ja_name": "ガブリアス", "slug": "garchomp", "rank": 1}, ...]
    """
    soup = BeautifulSoup(html, "html.parser")
    results: list[dict[str, str | int]] = []

    # ポケモンへのリンクを探す: /pokemon/<slug>?...
    pokemon_links = soup.find_all("a", href=re.compile(r"/pokemon/[^?]+"))
    seen_slugs: set[str] = set()
    rank = 0

    for link in pokemon_links:
        href = str(link.get("href", ""))
        match = re.search(r"/pokemon/([^?/]+)", href)
        if not match:
            continue
        slug = match.group(1)
        if slug in seen_slugs:
            continue
        seen_slugs.add(slug)
        rank += 1

        # リンク内のテキストからポケモン名を取得
        ja_name = link.get_text(strip=True)
        # 名前の前に番号がついている場合があるので除去
        ja_name = re.sub(r"^\d+\s*", "", ja_name).strip()

        results.append({
            "ja_name": ja_name,
            "slug": slug,
            "rank": rank,
        })

    return results


def _find_card_by_label(
    soup: BeautifulSoup,
    en_label: str,
) -> Tag | None:
    """英語ラベル (MOVES, ITEMS 等) でセクションカードを特定する."""
    en_span = soup.find(
        "span",
        string=en_label,
        class_=re.compile(r"uppercase"),
    )
    if en_span is None:
        return None
    # span → header div → card (div.rounded-2xl)
    node = en_span
    for _ in range(10):
        node = node.parent
        if node is None:
            return None
        classes = node.get("class") or []
        if "rounded-2xl" in classes:
            return node
    return None


def _extract_card_list(card: Tag) -> list[tuple[str, float]]:
    """カード内の ul > li から (名前, 使用率%) ペアを抽出する.

    li 内の構造:
      - 名前: span.flex-1 (class に 'flex-1' を含む)
      - 使用率: 末尾の span (テキストが "XX.X%" 形式)
    """
    items: list[tuple[str, float]] = []
    ul = card.find("ul")
    if ul is None:
        return items

    for li in ul.find_all("li"):
        # 名前 span: class に flex-1 を含む
        name_span = li.find("span", class_=re.compile(r"\bflex-1\b"))
        if name_span is None:
            continue
        name = name_span.get_text(strip=True)
        if not name:
            continue

        # 使用率 span: 全 span の中で XX.X% にマッチするもの
        percent = 0.0
        for span in li.find_all("span"):
            text = span.get_text(strip=True)
            m = re.match(r"^([\d.]+)%$", text)
            if m:
                percent = float(m.group(1))
                break

        if percent > 0:
            items.append((name, percent))

    return items


def _extract_card_list_ranked(card: Tag) -> list[tuple[str, int]]:
    """PARTNER カード: (名前, 順位) ペアを抽出する (% ではなく N位 形式)."""
    items: list[tuple[str, int]] = []
    ul = card.find("ul")
    if ul is None:
        return items

    for li in ul.find_all("li"):
        name_span = li.find("span", class_=re.compile(r"\bflex-1\b"))
        if name_span is None:
            continue
        name = name_span.get_text(strip=True)
        if not name:
            continue

        for span in li.find_all("span"):
            text = span.get_text(strip=True)
            m = re.match(r"^(\d+)位$", text)
            if m:
                items.append((name, int(m.group(1))))
                break

    return items


def _parse_pokemon_page(html: str) -> dict[str, list]:
    """個別ポケモンページから全データを抽出する.

    サイトの HTML 構造:
      - 各セクションは div.rounded-2xl カード
      - ヘッダーに span.uppercase (EN: MOVES/ITEMS/ABILITY/NATURE/PARTNER)
      - データは ul > li 内の span.flex-1(名前) + span(XX.X%)
      - 努力値のみ table 形式

    Returns:
        {
            "moves": [(ja_name, usage_percent), ...],
            "items": [(ja_name, usage_percent), ...],
            "abilities": [(ja_name, usage_percent), ...],
            "natures": [(ja_name, usage_percent), ...],
            "ev_spreads": [({"hp": N, "atk": N, ...}, usage_percent), ...],
            "teammates": [(ja_name, rank), ...],
        }
    """
    soup = BeautifulSoup(html, "html.parser")
    result: dict[str, list] = {
        "moves": [],
        "items": [],
        "abilities": [],
        "natures": [],
        "ev_spreads": [],
        "teammates": [],
    }

    # --- ul > li ベースのセクション ---
    section_map = {
        "MOVES": "moves",
        "ITEMS": "items",
        "ABILITY": "abilities",
        "NATURE": "natures",
    }
    for en_label, category in section_map.items():
        card = _find_card_by_label(soup, en_label)
        if card:
            result[category] = _extract_card_list(card)

    # --- PARTNER (順位ベース) ---
    partner_card = _find_card_by_label(soup, "PARTNER")
    if partner_card:
        result["teammates"] = _extract_card_list_ranked(partner_card)

    # --- 努力値 (table) ---
    result["ev_spreads"] = _parse_ev_spreads(soup)

    return result


def _parse_ev_spreads(soup: BeautifulSoup) -> list[tuple[dict[str, int], float]]:
    """努力値配分テーブルを解析する."""
    spreads: list[tuple[dict[str, int], float]] = []

    # 努力値関連のテーブルを探す
    for table in soup.find_all("table"):
        # ヘッダー行をチェック
        headers = table.find_all("th")
        header_texts = [h.get_text(strip=True) for h in headers]

        # 努力値テーブルかどうかの判定
        stat_headers = {"HP", "攻", "防", "特攻", "特防", "素早"}
        if not stat_headers.issubset(set(header_texts)):
            continue

        # ヘッダーからステータスのインデックスを特定
        stat_indices: dict[str, int] = {}
        for idx, text in enumerate(header_texts):
            key = _JA_STAT_TO_KEY.get(text)
            if key:
                stat_indices[key] = idx

        if len(stat_indices) < 6:
            continue

        # データ行を解析
        for row in table.find_all("tr"):
            cells = row.find_all("td")
            if not cells:
                continue

            cell_texts = [c.get_text(strip=True) for c in cells]

            # 使用率%を探す
            usage_percent = 0.0
            for text in cell_texts:
                percent_match = re.search(r"([\d.]+)\s*%", text)
                if percent_match:
                    usage_percent = float(percent_match.group(1))
                    break

            # 各ステータス値を抽出
            spread: dict[str, int] = {
                "hp": 0, "atk": 0, "def": 0,
                "spa": 0, "spd": 0, "spe": 0,
            }
            for stat_key, col_idx in stat_indices.items():
                if col_idx < len(cell_texts):
                    try:
                        spread[stat_key] = int(cell_texts[col_idx])
                    except ValueError:
                        pass

            if usage_percent > 0:
                spreads.append((spread, usage_percent))

    return spreads


def _to_showdown_id(name: str) -> str:
    """Showdown の toID() 相当: 小文字化 + 英数字以外を除去."""
    return re.sub(r"[^a-z0-9]", "", name.lower())


# ---------------------------------------------------------------------------
# 変換: 日本語名 → Showdown key
# ---------------------------------------------------------------------------

def _convert_to_showdown(
    raw: dict[str, list],
    maps: dict[str, dict[str, str]],
    unresolved: dict[str, list[str]],
) -> dict[str, Any]:
    """日本語の解析結果を Showdown key に変換する."""
    result: dict[str, Any] = {}

    # 技
    moves: list[dict[str, Any]] = []
    for name, usage in raw.get("moves", []):
        key = _resolve_ja(name, maps["moves"])
        if key:
            moves.append({"move_key": key, "usage_percent": usage})
        else:
            unresolved.setdefault("moves", []).append(name)
    result["moves"] = moves

    # 持ち物
    items: list[dict[str, Any]] = []
    for name, usage in raw.get("items", []):
        key = _resolve_ja(name, maps["items"])
        if key:
            items.append({"item_key": key, "usage_percent": usage})
        else:
            unresolved.setdefault("items", []).append(name)
    result["items"] = items

    # 特性
    abilities: list[dict[str, Any]] = []
    for name, usage in raw.get("abilities", []):
        key = _resolve_ja(name, maps["abilities"])
        if key:
            abilities.append({"ability_key": key, "usage_percent": usage})
        else:
            unresolved.setdefault("abilities", []).append(name)
    result["abilities"] = abilities

    # 性格
    natures: list[dict[str, Any]] = []
    for name, usage in raw.get("natures", []):
        key = _JA_NATURE_TO_KEY.get(name.strip())
        if key:
            natures.append({"nature_key": key, "usage_percent": usage})
        else:
            unresolved.setdefault("natures", []).append(name)
    result["natures"] = natures

    # 努力値
    ev_spreads: list[dict[str, Any]] = []
    for spread, usage in raw.get("ev_spreads", []):
        ev_spreads.append({"spread": spread, "usage_percent": usage})
    result["ev_spreads"] = ev_spreads

    # チームメイト (順位ベース: % ではなく rank)
    teammates: list[dict[str, Any]] = []
    for name, rank_or_usage in raw.get("teammates", []):
        key = _resolve_ja(name, maps["pokemon"])
        if key:
            teammates.append({"pokemon_key": key, "rank": rank_or_usage})
        else:
            unresolved.setdefault("teammates", []).append(name)
    result["teammates"] = teammates

    return result


# ---------------------------------------------------------------------------
# typing import (deferred to avoid circular issues at module level)
# ---------------------------------------------------------------------------

from typing import Any  # noqa: E402


# ---------------------------------------------------------------------------
# メインロジック
# ---------------------------------------------------------------------------

def run_probe(delay: float, season: str | None) -> int:
    """--probe モード: ランキング + 2体の詳細ページを取得し構造を表示."""
    print("=== Probe mode ===", file=sys.stderr)

    # 1. ランキングページ取得
    ranking_url = f"{_BASE_URL}/?format=single"
    if season:
        ranking_url = f"{_BASE_URL}/?season={season}&format=single"
    print(f"\n--- Ranking page: {ranking_url} ---", file=sys.stderr)

    html = _fetch_html(ranking_url)
    if html is None:
        print("ERROR: ランキングページの取得に失敗", file=sys.stderr)
        return 1

    # HTML構造をダンプ (最初の 2000 文字)
    print(f"\n[HTML length: {len(html)} chars]", file=sys.stderr)
    soup = BeautifulSoup(html, "html.parser")

    # リンク一覧
    pokemon_links = soup.find_all("a", href=re.compile(r"/pokemon/"))
    print(f"\n[Pokemon links found: {len(pokemon_links)}]", file=sys.stderr)
    for link in pokemon_links[:10]:
        href = link.get("href", "")
        text = link.get_text(strip=True)[:50]
        print(f"  {href} → {text}", file=sys.stderr)

    # パーサーテスト
    ranking = _parse_ranking_page(html)
    print(f"\n[Parsed ranking: {len(ranking)} pokemon]", file=sys.stderr)
    for entry in ranking[:10]:
        print(
            f"  #{entry['rank']} {entry['ja_name']} (slug={entry['slug']})",
            file=sys.stderr,
        )

    # season パラメータ抽出
    detected_season = _detect_season(html)
    print(f"\n[Detected season: {detected_season}]", file=sys.stderr)

    # 2. 詳細ページ取得 (先頭 2件)
    maps = _build_ja_to_key_maps(_NAMES_PATH)
    season_param = season or detected_season or "M-1"

    for entry in ranking[:2]:
        slug = entry["slug"]
        time.sleep(delay)
        detail_url = f"{_BASE_URL}/pokemon/{slug}?season={season_param}&format=single"
        print(f"\n--- Detail: {entry['ja_name']} ({detail_url}) ---", file=sys.stderr)

        detail_html = _fetch_html(detail_url)
        if detail_html is None:
            print("  Fetch failed", file=sys.stderr)
            continue

        print(f"  [HTML length: {len(detail_html)} chars]", file=sys.stderr)

        # テーブル構造をダンプ
        detail_soup = BeautifulSoup(detail_html, "html.parser")
        tables = detail_soup.find_all("table")
        print(f"  [Tables found: {len(tables)}]", file=sys.stderr)
        for i, table in enumerate(tables):
            headers = [th.get_text(strip=True) for th in table.find_all("th")]
            rows = table.find_all("tr")
            print(f"  Table {i}: headers={headers}, rows={len(rows)}", file=sys.stderr)
            # 最初の 3 行をダンプ
            for row in rows[:3]:
                cells = [td.get_text(strip=True) for td in row.find_all(["td", "th"])]
                print(f"    {cells}", file=sys.stderr)

        # パーサーテスト
        parsed = _parse_pokemon_page(detail_html)
        unresolved: dict[str, list[str]] = {}
        converted = _convert_to_showdown(parsed, maps, unresolved)

        for category, data_list in converted.items():
            print(f"  {category}: {len(data_list)} items", file=sys.stderr)
            for item in data_list[:3]:
                print(f"    {item}", file=sys.stderr)
        if unresolved:
            print(f"  Unresolved: {unresolved}", file=sys.stderr)

    return 0


def _detect_season(html: str) -> str | None:
    """ランキングページから現在のシーズンパラメータを検出する."""
    # URL パラメータから season= を探す
    match = re.search(r"season=([A-Za-z0-9_-]+)", html)
    if match:
        return match.group(1)
    return None


def run_fetch(
    output_dir: Path,
    delay: float,
    dry_run: bool,
    season: str | None,
) -> int:
    """全データ取得モード."""
    print("=== Champions Stats usage data fetch ===", file=sys.stderr)

    # --- 名前辞書構築 ---
    print("Loading name dictionaries...", file=sys.stderr)
    maps = _build_ja_to_key_maps(_NAMES_PATH)
    print(
        f"  Mappings: pokemon={len(maps['pokemon'])}, "
        f"moves={len(maps['moves'])}, items={len(maps['items'])}, "
        f"abilities={len(maps['abilities'])}",
        file=sys.stderr,
    )

    # --- ランキングページ取得 ---
    ranking_url = f"{_BASE_URL}/?format=single"
    if season:
        ranking_url = f"{_BASE_URL}/?season={season}&format=single"
    print(f"\nFetching ranking: {ranking_url}", file=sys.stderr)

    html = _fetch_html(ranking_url)
    if html is None:
        print("ERROR: ランキングページの取得に失敗", file=sys.stderr)
        return 1

    ranking = _parse_ranking_page(html)
    if not ranking:
        print("ERROR: ランキングからポケモンが抽出できませんでした", file=sys.stderr)
        return 1

    detected_season = _detect_season(html)
    season_param = season or detected_season or "M-1"
    print(f"  Season: {season_param}", file=sys.stderr)
    print(f"  Pokemon count: {len(ranking)}", file=sys.stderr)

    # --- 各ポケモン詳細取得 ---
    results: dict[str, dict] = {}
    unresolved: dict[str, list[str]] = {}
    failed_slugs: list[str] = []
    total = len(ranking)

    for i, entry in enumerate(ranking, 1):
        slug = str(entry["slug"])
        ja_name = str(entry["ja_name"])

        if i > 1:
            time.sleep(delay)

        detail_url = (
            f"{_BASE_URL}/pokemon/{slug}?season={season_param}&format=single"
        )
        print(
            f"  [{i:>3}/{total}] {slug} ({ja_name}) ... ",
            end="", flush=True, file=sys.stderr,
        )

        detail_html = _fetch_html(detail_url, quiet=True)
        if detail_html is None:
            print("FETCH FAILED", file=sys.stderr)
            failed_slugs.append(slug)
            continue

        raw = _parse_pokemon_page(detail_html)
        converted = _convert_to_showdown(raw, maps, unresolved)

        # slug → Showdown key に変換
        pokemon_key = _to_showdown_id(slug)
        # ja.json でも解決を試みる
        ja_resolved = _resolve_ja(ja_name, maps["pokemon"])
        if ja_resolved:
            pokemon_key = ja_resolved

        move_count = len(converted.get("moves", []))
        nature_count = len(converted.get("natures", []))
        print(f"OK (moves={move_count}, natures={nature_count})", file=sys.stderr)

        results[pokemon_key] = converted

    # --- 出力 ---
    meta: dict[str, Any] = {
        "source": "pokemon-champions-stats",
        "format": "single",
        "season": season_param,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "pokemon_count": len(results),
        "fetch_attempted": total,
        "fetch_failed_count": len(failed_slugs),
    }
    if failed_slugs:
        meta["fetch_failed_slugs"] = sorted(failed_slugs)
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

    # --- サマリー ---
    print(f"\n=== Summary ===", file=sys.stderr)
    print(f"  Success: {len(results)}", file=sys.stderr)
    print(f"  Failed:  {len(failed_slugs)}", file=sys.stderr)
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


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="pokemon-champions-stats.vercel.app usage data fetcher",
    )
    parser.add_argument(
        "--probe",
        action="store_true",
        help="Probe mode: ランキング + 2体を取得し HTML 構造を表示",
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
        help="シーズンパラメータ (default: ランキングページから自動検出)",
    )
    args = parser.parse_args()

    if args.probe:
        sys.exit(run_probe(args.delay, args.season))
    else:
        sys.exit(
            run_fetch(args.output_dir, args.delay, args.dry_run, args.season),
        )


if __name__ == "__main__":
    main()
