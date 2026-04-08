"""ポケモンスプライト画像の一括ダウンロードスクリプト.

PokeAPI/sprites リポジトリから世代別スプライトを取得する。
優先順位: Gen 9 SV → Gen 8 SW/SH → Gen 7 USUM → HOME (フォールバック)

使い方::

    # 全ポケモン (ID 1〜1025) をダウンロード
    python scripts/fetch_pokemon_sprites.py

    # 特定のIDリストのみ
    python scripts/fetch_pokemon_sprites.py --ids 25 150 151

    # IDリストをファイルから読み込み (1行1ID)
    python scripts/fetch_pokemon_sprites.py --id-file data/champions_pokemon_ids.txt

    # 出力先・サイズ変更
    python scripts/fetch_pokemon_sprites.py --output-dir templates/pokemon --size 64
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import HTTPError, URLError

from PIL import Image
from io import BytesIO

_REPO = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon"

# 優先順位順の URL テンプレート (Gen 9 → Gen 8 → Gen 7 → HOME)
_URL_CHAIN: list[tuple[str, str]] = [
    ("Gen9 SV", f"{_REPO}/versions/generation-ix/scarlet-violet/{{pokemon_id}}.png"),
    ("Gen8 SW/SH", f"{_REPO}/versions/generation-viii/sword-shield/{{pokemon_id}}.png"),
    ("Gen7 USUM", f"{_REPO}/versions/generation-vii/ultra-sun-ultra-moon/{{pokemon_id}}.png"),
    ("HOME", f"{_REPO}/other/home/{{pokemon_id}}.png"),
]

_DEFAULT_OUTPUT_DIR = Path(__file__).parent.parent / "templates" / "pokemon"
_DEFAULT_SIZE = 128
_MAX_POKEMON_ID = 1025  # Gen IX まで
_REQUEST_DELAY = 0.1  # サーバー負荷軽減用 (秒)


def _fetch_pokemon_name_ja(pokemon_id: int) -> str:
    """PokeAPI から単一ポケモンの日本語名を取得する."""
    url = f"https://pokeapi.co/api/v2/pokemon-species/{pokemon_id}"
    request = Request(url, headers={"User-Agent": "PokeScouter/0.1"})
    try:
        with urlopen(request, timeout=30) as response:
            data = json.loads(response.read())
        for name_entry in data.get("names", []):
            if name_entry["language"]["name"] == "ja":
                return name_entry["name"]
    except (HTTPError, URLError):
        pass
    return f"No.{pokemon_id}"


def _fetch(url: str) -> bytes | None:
    """URL から画像データを取得する。404 なら None を返す。"""
    request = Request(url, headers={"User-Agent": "PokeScouter/0.1"})
    try:
        with urlopen(request, timeout=30) as response:
            return response.read()
    except HTTPError as e:
        if e.code == 404:
            return None
        raise
    except URLError:
        return None


def download_sprite(pokemon_id: int, output_dir: Path, size: int) -> bool:
    """単一ポケモンのスプライトをフォールバックチェーンで取得する.

    Args:
        pokemon_id: National Dex 番号。
        output_dir: 保存先ディレクトリ。
        size: リサイズ後の辺の長さ (正方形)。

    Returns:
        成功なら True。
    """
    output_path = output_dir / f"{pokemon_id}.png"
    if output_path.exists():
        return True

    for source_name, url_template in _URL_CHAIN:
        url = url_template.format(pokemon_id=pokemon_id)
        data = _fetch(url)
        if data is not None:
            img = Image.open(BytesIO(data))
            img = img.convert("RGBA")
            img = img.resize((size, size), Image.LANCZOS)
            img.save(output_path, "PNG")
            if source_name == "HOME":
                name = _fetch_pokemon_name_ja(pokemon_id)
                print(f"  [{pokemon_id:>4}] {name} ⚠ HOMEにフォールバック (Gen7-9に画像なし)")
            return True

    name = _fetch_pokemon_name_ja(pokemon_id)
    print(f"  [{pokemon_id:>4}] {name} 全ソースで画像なし")
    return False


def load_id_list(path: Path) -> list[int]:
    """ファイルから ID リストを読み込む (1行1ID、空行・#コメント無視)."""
    ids: list[int] = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            try:
                ids.append(int(line))
            except ValueError:
                print(f"  警告: 無効なID '{line}' をスキップ")
    return ids


def main() -> None:
    parser = argparse.ArgumentParser(
        description="ポケモンスプライト画像を一括ダウンロード (Gen9→Gen8→Gen7→HOME フォールバック)",
    )
    parser.add_argument(
        "--ids",
        type=int,
        nargs="+",
        help="ダウンロードするポケモンIDのリスト",
    )
    parser.add_argument(
        "--id-file",
        type=Path,
        help="ポケモンIDリストファイル (1行1ID)",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=_DEFAULT_OUTPUT_DIR,
        help=f"出力ディレクトリ (デフォルト: {_DEFAULT_OUTPUT_DIR})",
    )
    parser.add_argument(
        "--size",
        type=int,
        default=_DEFAULT_SIZE,
        help=f"リサイズ後のサイズ (デフォルト: {_DEFAULT_SIZE}px)",
    )
    parser.add_argument(
        "--max-id",
        type=int,
        default=_MAX_POKEMON_ID,
        help=f"全件DL時の最大ID (デフォルト: {_MAX_POKEMON_ID})",
    )
    args = parser.parse_args()

    # IDリスト決定
    if args.ids:
        pokemon_ids = args.ids
    elif args.id_file:
        pokemon_ids = load_id_list(args.id_file)
        if not pokemon_ids:
            print("エラー: IDリストファイルが空です")
            sys.exit(1)
    else:
        pokemon_ids = list(range(1, args.max_id + 1))

    # 出力ディレクトリ作成
    args.output_dir.mkdir(parents=True, exist_ok=True)

    print(f"ダウンロード開始: {len(pokemon_ids)}件 → {args.output_dir}")
    print(f"リサイズ: {args.size}x{args.size}px")
    print(f"優先順位: {' → '.join(name for name, _ in _URL_CHAIN)}")

    success = 0
    skipped = 0
    failed = 0

    for i, pid in enumerate(pokemon_ids, 1):
        output_path = args.output_dir / f"{pid}.png"
        if output_path.exists():
            skipped += 1
            continue

        if download_sprite(pid, args.output_dir, args.size):
            success += 1
        else:
            failed += 1

        time.sleep(_REQUEST_DELAY)

    print(f"\n完了: 新規DL={success}, スキップ(既存)={skipped}, 失敗={failed}")


if __name__ == "__main__":
    main()
