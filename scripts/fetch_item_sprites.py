"""アイテムスプライト画像の一括ダウンロードスクリプト.

PokeAPI/sprites リポジトリからアイテムアイコンを取得する。

使い方::

    # 全アイテムをダウンロード (data/base/items.json から)
    python scripts/fetch_item_sprites.py

    # 特定の identifier のみ
    python scripts/fetch_item_sprites.py --identifiers leftovers choice-band life-orb

    # 出力先変更
    python scripts/fetch_item_sprites.py --output-dir templates/items
"""

from __future__ import annotations

import argparse
import json
import socket
import sys
import time
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import HTTPError, URLError

# グローバルソケットタイムアウト (DNS解決・TCP接続含む)
socket.setdefaulttimeout(5)

_REPO = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items"
_URL_TEMPLATE = f"{_REPO}/{{identifier}}.png"

_DEFAULT_OUTPUT_DIR = Path(__file__).parent.parent / "templates" / "items"
_ITEMS_JSON = Path(__file__).parent.parent / "data" / "base" / "items.json"
_REQUEST_DELAY = 0.1  # サーバー負荷軽減用 (秒)


def _fetch(url: str) -> bytes | None:
    """URL から画像データを取得する。404 なら None を返す。"""
    request = Request(url, headers={"User-Agent": "PokeScouter/0.1"})
    try:
        with urlopen(request, timeout=5) as response:
            return response.read()
    except HTTPError as e:
        if e.code == 404:
            return None
        raise
    except URLError:
        return None


def download_item_sprite(identifier: str, output_dir: Path) -> bool:
    """単一アイテムのスプライトを取得する.

    Args:
        identifier: アイテム識別子 (例: "leftovers", "choice-band")。
        output_dir: 保存先ディレクトリ。

    Returns:
        成功なら True。
    """
    output_path = output_dir / f"{identifier}.png"
    if output_path.exists():
        return True

    url = _URL_TEMPLATE.format(identifier=identifier)
    data = _fetch(url)
    if data is not None:
        output_path.write_bytes(data)
        return True

    return False


def load_identifiers_from_items_json(path: Path) -> list[str]:
    """items.json から全アイテムの identifier を読み込む。"""
    with open(path, encoding="utf-8") as f:
        items_data = json.load(f)
    identifiers: list[str] = []
    for key, item in items_data.items():
        if key.startswith("_"):
            continue
        identifiers.append(item["identifier"])
    return identifiers


def main() -> None:
    parser = argparse.ArgumentParser(
        description="アイテムスプライト画像を一括ダウンロード (PokeAPI/sprites)",
    )
    parser.add_argument(
        "--identifiers",
        nargs="+",
        help="ダウンロードするアイテム identifier のリスト",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=_DEFAULT_OUTPUT_DIR,
        help=f"出力ディレクトリ (デフォルト: {_DEFAULT_OUTPUT_DIR})",
    )
    parser.add_argument(
        "--items-json",
        type=Path,
        default=_ITEMS_JSON,
        help=f"items.json のパス (デフォルト: {_ITEMS_JSON})",
    )
    args = parser.parse_args()

    # identifier リスト決定
    if args.identifiers:
        identifiers = args.identifiers
    else:
        if not args.items_json.exists():
            print(f"エラー: {args.items_json} が見つかりません")
            sys.exit(1)
        identifiers = load_identifiers_from_items_json(args.items_json)

    # 出力ディレクトリ作成
    args.output_dir.mkdir(parents=True, exist_ok=True)

    print(f"ダウンロード開始: {len(identifiers)}件 → {args.output_dir}")

    success = 0
    skipped = 0
    failed = 0

    for i, identifier in enumerate(identifiers, 1):
        output_path = args.output_dir / f"{identifier}.png"
        if output_path.exists():
            skipped += 1
            continue

        if download_item_sprite(identifier, args.output_dir):
            success += 1
        else:
            failed += 1

        if i % 100 == 0:
            print(f"  進捗: {i}/{len(identifiers)}")

        time.sleep(_REQUEST_DELAY)

    print(f"\n完了: 新規DL={success}, スキップ(既存)={skipped}, 失敗={failed}")


if __name__ == "__main__":
    main()
