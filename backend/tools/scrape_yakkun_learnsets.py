"""ポケモン徹底攻略 (yakkun.com) からチャンピオンズの技リストを取得し、
data/champions_override/learnsets.json を生成するスクリプト。

使い方:
    1. ブラウザで https://yakkun.com/ch/zukan/offer/ を開き、
       Ctrl+S で HTML を data/yakkun_zukan_offer.html として保存
    2. cd backend
       python -m tools.scrape_yakkun_learnsets --html-file ../data/yakkun_zukan_offer.html
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import urllib.request
from datetime import date
from html.parser import HTMLParser
from pathlib import Path

logger = logging.getLogger(__name__)

# --- 定数 ---

MOVE_CSV_URL = "https://yakkun.com/dataset/ch/ch_move.csv"
POKEMON_MOVE_CSV_URL = "https://yakkun.com/dataset/ch/ch_pokemon_move.csv"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
)

# URL suffix → 形態キー
# 半角→全角変換テーブル（PokeAPI は全角英数字を使用、yakkun は半角）
_HALFWIDTH = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
_FULLWIDTH = "０１２３４５６７８９ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ"
_H2F_TABLE = str.maketrans(_HALFWIDTH, _FULLWIDTH)


def _normalize_ja_name(name: str) -> str:
    """半角英数字を全角に変換してPokeAPIの表記に揃える。"""
    return name.translate(_H2F_TABLE)


# URL suffix → 形態キー
FORM_SUFFIX_MAP: dict[str, str] = {
    "": "default",
    "m": "mega",
    "x": "mega-x",
    "y": "mega-y",
    "a": "alola",
    "g": "galar",
    "h": "hisui",
    "p": "paldea",
}


# --- CSV ダウンロード ---

def _fetch_csv(url: str) -> str:
    """yakkun.com の CSV データセットを取得する。"""
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Referer": "https://yakkun.com/ch/zukan/offer/",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8")


def load_move_names(csv_text: str) -> dict[int, str]:
    """ch_move.csv を解析して {csv_index: 日本語技名} を返す。"""
    lines = csv_text.split("\n")
    mapping: dict[int, str] = {}
    for i, line in enumerate(lines):
        name = line.strip()
        if name and name != "-":
            mapping[i] = name
    return mapping


def load_pokemon_moves(csv_text: str) -> list[list[int]]:
    """ch_pokemon_move.csv を解析して [[move_indices...], ...] を返す。

    返り値のインデックスは 0-based（line 0 = 空行を含む）。
    """
    lines = csv_text.split("\n")
    result: list[list[int]] = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            result.append([])
        else:
            result.append([int(x) for x in stripped.split(",")])
    return result


# --- HTML 解析 ---

class _PokemonListParser(HTMLParser):
    """<ul class="pokemon_list"> 内の <li> 要素を順番に抽出する。"""

    def __init__(self) -> None:
        super().__init__()
        self.entries: list[dict[str, str]] = []
        self._in_pokemon_list = False
        self._in_li = False
        self._in_name_link = False
        self._current_entry: dict[str, str] = {}
        self._current_name_parts: list[str] = []
        self._ul_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_dict = dict(attrs)

        if tag == "ul" and "pokemon_list" in (attr_dict.get("class") or ""):
            self._in_pokemon_list = True
            self._ul_depth = 1
            return

        if self._in_pokemon_list:
            if tag == "ul":
                self._ul_depth += 1
            elif tag == "li" and self._ul_depth == 1:
                self._in_li = True
                self._current_entry = {
                    "data_id": attr_dict.get("data-id", ""),
                    "data_no": attr_dict.get("data-no", ""),
                    "classes": attr_dict.get("class", ""),
                }
                self._current_name_parts = []
            elif tag == "a" and self._in_li:
                href = attr_dict.get("href", "")
                # ポケモン個別ページリンクのみ（/ch/zukan/n{数字}）
                # /ch/zukan/search/ (特性検索) は除外
                if re.match(r".*/ch/zukan/n\d+", href):
                    self._current_entry["href"] = href
                    self._in_name_link = True

    def handle_endtag(self, tag: str) -> None:
        if self._in_pokemon_list:
            if tag == "ul":
                self._ul_depth -= 1
                if self._ul_depth <= 0:
                    self._in_pokemon_list = False
            elif tag == "li" and self._in_li and self._ul_depth == 1:
                self._current_entry["name"] = "".join(self._current_name_parts).strip()
                self.entries.append(self._current_entry)
                self._in_li = False
                self._current_entry = {}
            elif tag == "a" and self._in_name_link:
                self._in_name_link = False

    def handle_data(self, data: str) -> None:
        if self._in_name_link:
            self._current_name_parts.append(data)


def parse_pokemon_list(html: str) -> list[dict[str, str]]:
    """HTML からポケモンリストを抽出する。"""
    parser = _PokemonListParser()
    parser.feed(html)
    return parser.entries


def _parse_form_from_href(href: str) -> str:
    """href (例: /ch/zukan/n3m) から形態キーを返す。"""
    # /ch/zukan/n{number}{suffix} のパターン（URLの末尾）
    m = re.search(r"/n(\d+)([a-z]*)(?:\?.*)?$", href)
    if not m:
        return "default"
    suffix = m.group(2)
    return FORM_SUFFIX_MAP.get(suffix, suffix or "default")


# --- メインロジック ---

def build_learnsets(
    html_path: Path,
    names_path: Path,
    out_dir: Path,
    *,
    move_csv_url: str = MOVE_CSV_URL,
    pokemon_move_csv_url: str = POKEMON_MOVE_CSV_URL,
) -> None:
    """技リストデータを生成する。"""
    today = str(date.today())

    # 1. CSVダウンロード
    print("[1/5] 技名CSV ダウンロード中...")
    move_csv = _fetch_csv(move_csv_url)
    csv_idx_to_name = load_move_names(move_csv)
    print(f"  → {len(csv_idx_to_name)} 技名を取得")

    print("[2/5] ポケモン技CSV ダウンロード中...")
    pm_csv = _fetch_csv(pokemon_move_csv_url)
    pokemon_move_lines = load_pokemon_moves(pm_csv)
    print(f"  → {len(pokemon_move_lines)} 行を取得")

    # 2. ja.json から日本語名 → move_id マッピング
    print("[3/5] 名前辞書読み込み中...")
    with open(names_path, encoding="utf-8") as f:
        names_data = json.load(f)
    ja_move_to_id: dict[str, int] = names_data.get("moves", {})
    print(f"  → {len(ja_move_to_id)} 件の技名マッピング")

    # CSV index → move_id の変換テーブル
    csv_idx_to_move_id: dict[int, int] = {}
    unresolved_moves: dict[str, int] = {}  # {ja_name: csv_index}
    for idx, ja_name in csv_idx_to_name.items():
        move_id = ja_move_to_id.get(ja_name)
        if move_id is None:
            # 半角→全角正規化で再試行
            move_id = ja_move_to_id.get(_normalize_ja_name(ja_name))
        if move_id is not None:
            csv_idx_to_move_id[idx] = move_id
        else:
            unresolved_moves[ja_name] = idx

    print(f"  → 解決済み: {len(csv_idx_to_move_id)}, 未解決: {len(unresolved_moves)}")
    if unresolved_moves:
        print("  未解決の技名:")
        for name, idx in sorted(unresolved_moves.items(), key=lambda x: x[1]):
            print(f"    [{idx}] {name}")

    # 3. HTML 解析
    print("[4/5] HTML 解析中...")
    # yakkun.com は EUC-JP エンコーディング
    try:
        html_text = html_path.read_text(encoding="euc-jp")
    except UnicodeDecodeError:
        html_text = html_path.read_text(encoding="utf-8", errors="replace")
    entries = parse_pokemon_list(html_text)
    print(f"  → {len(entries)} ポケモンエントリを抽出")

    # 4. マッピング＆出力構築
    print("[5/5] learnsets.json 構築中...")
    learnsets: dict[str, dict[str, list[int]]] = {}
    stats = {"total_entries": 0, "with_moves": 0, "nodata_entries": 0}

    for li_idx, entry in enumerate(entries):
        csv_line_idx = li_idx + 1  # CSV line 0 は空行
        species_id = entry.get("data_no", "")
        if not species_id:
            continue

        is_nodata = "nodata" in entry.get("classes", "")
        if is_nodata:
            stats["nodata_entries"] += 1

        form = _parse_form_from_href(entry.get("href", ""))
        stats["total_entries"] += 1

        # CSV から技インデックスを取得
        if csv_line_idx >= len(pokemon_move_lines):
            logger.warning(
                "CSV 行数超過: li_idx=%d, csv_line=%d, name=%s",
                li_idx, csv_line_idx, entry.get("name", "?"),
            )
            continue

        move_indices = pokemon_move_lines[csv_line_idx]
        if not move_indices:
            continue

        # CSV index → move_id に変換
        move_ids: list[int] = []
        for midx in move_indices:
            mid = csv_idx_to_move_id.get(midx)
            if mid is not None:
                move_ids.append(mid)

        if not move_ids:
            continue

        move_ids = sorted(set(move_ids))
        stats["with_moves"] += 1

        if species_id not in learnsets:
            learnsets[species_id] = {}
        learnsets[species_id][form] = move_ids

    # 5. 書き出し
    output: dict = {
        "_meta": {
            "source": "yakkun.com/ch/zukan/offer/",
            "last_updated": today,
            "description": "ポケモン毎の覚える技リスト（Champions）",
            "stats": {
                "total_species": len(learnsets),
                "total_entries": stats["total_entries"],
                "entries_with_moves": stats["with_moves"],
                "nodata_entries": stats["nodata_entries"],
                "resolved_moves": len(csv_idx_to_move_id),
                "unresolved_moves": len(unresolved_moves),
            },
        },
    }
    if unresolved_moves:
        output["_unresolved_moves"] = {
            name: idx for name, idx in sorted(unresolved_moves.items(), key=lambda x: x[1])
        }
    output.update(learnsets)

    out_path = out_dir / "learnsets.json"
    out_dir.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n完了! {out_path}")
    print(f"  種族数: {len(learnsets)}")
    print(f"  エントリ数: {stats['total_entries']} (技あり: {stats['with_moves']})")
    print(f"  未内定ポケモン: {stats['nodata_entries']}")
    print(f"  未解決技名: {len(unresolved_moves)}")


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(
        description="ポケモン徹底攻略 → learnsets.json 変換",
    )
    parser.add_argument(
        "--html-file",
        type=Path,
        required=True,
        help="yakkun.com/ch/zukan/offer/ の保存済みHTML",
    )
    parser.add_argument(
        "--names-file",
        type=Path,
        default=Path(__file__).resolve().parent.parent.parent / "data" / "names" / "ja.json",
        help="data/names/ja.json のパス",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path(__file__).resolve().parent.parent.parent / "data" / "champions_override",
        help="出力ディレクトリ",
    )
    args = parser.parse_args()

    if not args.html_file.exists():
        print(f"エラー: HTML ファイルが見つかりません: {args.html_file}")
        print("ブラウザで https://yakkun.com/ch/zukan/offer/ を開き、")
        print("Ctrl+S でページを保存してください。")
        raise SystemExit(1)

    build_learnsets(
        html_path=args.html_file,
        names_path=args.names_file,
        out_dir=args.out_dir,
    )


if __name__ == "__main__":
    main()
