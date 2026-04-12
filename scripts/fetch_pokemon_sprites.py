"""ポケモンスプライト画像の一括ダウンロードスクリプト.

PokeAPI/sprites リポジトリから世代別スプライトを取得する。
優先順位: Gen 9 SV → Gen 8 SW/SH → Gen 7 USUM → HOME (フォールバック)

使い方::

    # 全ポケモン (ID 1〜1025) をダウンロード
    python scripts/fetch_pokemon_sprites.py

    # 色違いスプライトも一緒にダウンロード
    python scripts/fetch_pokemon_sprites.py --shiny

    # 色違いスプライトのみダウンロード
    python scripts/fetch_pokemon_sprites.py --shiny-only

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

# 色違い用 URL テンプレート
_SHINY_URL_CHAIN: list[tuple[str, str]] = [
    ("Gen9 SV Shiny", f"{_REPO}/versions/generation-ix/scarlet-violet/shiny/{{pokemon_id}}.png"),
    ("Gen8 SW/SH Shiny", f"{_REPO}/versions/generation-viii/sword-shield/shiny/{{pokemon_id}}.png"),
    ("Gen7 USUM Shiny", f"{_REPO}/versions/generation-vii/ultra-sun-ultra-moon/shiny/{{pokemon_id}}.png"),
    ("HOME Shiny", f"{_REPO}/other/home/shiny/{{pokemon_id}}.png"),
]

_DEFAULT_OUTPUT_DIR = Path(__file__).parent.parent / "templates" / "pokemon"
_DEFAULT_SIZE = 128
_MAX_POKEMON_ID = 1025  # Gen IX まで
_REQUEST_DELAY = 0.1  # サーバー負荷軽減用 (秒)
_DATA_DIR = Path(__file__).parent.parent / "data"

# チーム選出画面に出ないフォーム
# identifier からベース名を除いたサフィックスに対して部分文字列マッチで判定
_SKIP_FORM_SUFFIXES = frozenset({
    # メガシンカ・G-Max (バトル中のみ)
    "mega", "mega-x", "mega-y", "mega-z", "gmax",
    # バトル中のみの変形
    "totem", "zen", "blade", "busted", "school", "noice",
    "gulping", "gorging", "hangry", "pirouette", "eternamax",
    "ultra", "complete", "10-power-construct", "50-power-construct",
    "hero",
    # ピカチュウ衣装・イベント限定
    "cosplay", "rock-star", "belle", "pop-star", "phd", "libre",
    "original-cap", "hoenn-cap", "sinnoh-cap", "unova-cap",
    "kalos-cap", "alola-cap", "partner-cap", "world-cap",
    "starter", "battle-bond", "ash",
    # 移動形態 (Koraidon/Miraidon)
    "limited-build", "sprinting-build", "swimming-build", "gliding-build",
    "low-power-mode", "drive-mode", "aquatic-mode", "glide-mode",
    # メテノのカラバリ (コア露出前は全て同じ外見、コア露出後もデフォルト=red で十分)
    "orange-meteor", "yellow-meteor", "green-meteor",
    "blue-meteor", "indigo-meteor", "violet-meteor",
    "red", "orange", "yellow", "green", "blue", "indigo", "violet",
    # フロレッテ: AZ の永遠の花
    "eternal",
    # ザルード: パパ / ロックルフ: マイペース
    "dada", "own-tempo",
    # テラパゴス: テラスタル・ステラ (バトル中のみ)
    "terastal", "stellar",
})


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


def _download_sprite_with_chain(
    pokemon_id: int,
    output_path: Path,
    size: int,
    url_chain: list[tuple[str, str]],
    home_source_name: str = "HOME",
) -> bool:
    """フォールバックチェーンでスプライトを取得する共通処理.

    Args:
        pokemon_id: National Dex 番号。
        output_path: 保存先パス。
        size: リサイズ後の辺の長さ (正方形)。
        url_chain: (ソース名, URLテンプレート) のリスト。
        home_source_name: HOME フォールバック時に警告表示するソース名。

    Returns:
        成功なら True。
    """
    if output_path.exists():
        return True

    for source_name, url_template in url_chain:
        url = url_template.format(pokemon_id=pokemon_id)
        data = _fetch(url)
        if data is not None:
            img = Image.open(BytesIO(data))
            img = img.convert("RGBA")
            img = img.resize((size, size), Image.LANCZOS)
            img.save(output_path, "PNG")
            if home_source_name in source_name:
                name = _fetch_pokemon_name_ja(pokemon_id)
                print(f"  [{pokemon_id:>4}] {name} [WARN] {source_name}にフォールバック")
            return True

    return False


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
    if _download_sprite_with_chain(pokemon_id, output_path, size, _URL_CHAIN):
        return True

    name = _fetch_pokemon_name_ja(pokemon_id)
    print(f"  [{pokemon_id:>4}] {name} 全ソースで画像なし")
    return False


def download_shiny_sprite(pokemon_id: int, output_dir: Path, size: int) -> bool:
    """単一ポケモンの色違いスプライトをフォールバックチェーンで取得する.

    Args:
        pokemon_id: National Dex 番号。
        output_dir: 保存先ディレクトリ (shiny/ サブディレクトリに保存)。
        size: リサイズ後の辺の長さ (正方形)。

    Returns:
        成功なら True。
    """
    shiny_dir = output_dir / "shiny"
    shiny_dir.mkdir(parents=True, exist_ok=True)
    output_path = shiny_dir / f"{pokemon_id}.png"

    if _download_sprite_with_chain(
        pokemon_id, output_path, size, _SHINY_URL_CHAIN, home_source_name="HOME",
    ):
        return True

    name = _fetch_pokemon_name_ja(pokemon_id)
    print(f"  [{pokemon_id:>4}] {name} 色違い: 全ソースで画像なし")
    return False


def load_form_ids(data_dir: Path) -> list[int]:
    """pokemon.json からチーム選出画面に表示されるフォーム違いの pokemon_id を取得する."""
    pokemon_path = data_dir / "base" / "pokemon.json"
    with open(pokemon_path, encoding="utf-8") as f:
        pokemon_data = json.load(f)

    form_ids: list[int] = []
    for pid, pdata in pokemon_data.items():
        if pid == "_meta":
            continue
        if pdata.get("is_default", True):
            continue
        identifier: str = pdata.get("identifier", "")
        # ベース名を除いたサフィックスで判定 ("rotom-heat" → "heat")
        base_name = identifier.split("-")[0]
        suffix = identifier[len(base_name) + 1:] if "-" in identifier else ""
        # サフィックスの完全一致、またはサフィックスの各パートにスキップキーワードが含まれるか
        suffix_parts = set(suffix.split("-"))
        if suffix in _SKIP_FORM_SUFFIXES or suffix_parts & _SKIP_FORM_SUFFIXES:
            continue
        form_ids.append(int(pid))

    form_ids.sort()
    return form_ids


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
    parser.add_argument(
        "--include-forms",
        action="store_true",
        help="フォーム違い (リージョン/ロトム等) のスプライトも追加ダウンロード",
    )
    parser.add_argument(
        "--shiny",
        action="store_true",
        help="通常色に加えて色違いスプライトもダウンロード",
    )
    parser.add_argument(
        "--shiny-only",
        action="store_true",
        help="色違いスプライトのみダウンロード",
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

    # フォーム違いを追加
    if args.include_forms:
        form_ids = load_form_ids(_DATA_DIR)
        existing = set(pokemon_ids)
        added = [fid for fid in form_ids if fid not in existing]
        pokemon_ids.extend(added)
        print(f"[フォーム] {len(added)}件のフォーム違いを追加 (合計 {len(pokemon_ids)}件)")

    # 出力ディレクトリ作成
    args.output_dir.mkdir(parents=True, exist_ok=True)

    download_normal = not args.shiny_only
    download_shiny = args.shiny or args.shiny_only

    # --- 通常色ダウンロード ---
    if download_normal:
        print(f"[通常色] ダウンロード開始: {len(pokemon_ids)}件 → {args.output_dir}")
        print(f"リサイズ: {args.size}x{args.size}px")
        print(f"優先順位: {' → '.join(name for name, _ in _URL_CHAIN)}")

        success = 0
        skipped = 0
        failed = 0

        for pid in pokemon_ids:
            output_path = args.output_dir / f"{pid}.png"
            if output_path.exists():
                skipped += 1
                continue

            if download_sprite(pid, args.output_dir, args.size):
                success += 1
            else:
                failed += 1

            time.sleep(_REQUEST_DELAY)

        print(f"\n[通常色] 完了: 新規DL={success}, スキップ(既存)={skipped}, 失敗={failed}")

    # --- 色違いダウンロード ---
    if download_shiny:
        shiny_dir = args.output_dir / "shiny"
        print(f"\n[色違い] ダウンロード開始: {len(pokemon_ids)}件 → {shiny_dir}")
        print(f"優先順位: {' → '.join(name for name, _ in _SHINY_URL_CHAIN)}")

        success = 0
        skipped = 0
        failed = 0

        for pid in pokemon_ids:
            shiny_path = shiny_dir / f"{pid}.png"
            if shiny_path.exists():
                skipped += 1
                continue

            if download_shiny_sprite(pid, args.output_dir, args.size):
                success += 1
            else:
                failed += 1

            time.sleep(_REQUEST_DELAY)

        print(f"\n[色違い] 完了: 新規DL={success}, スキップ(既存)={skipped}, 失敗={failed}")


if __name__ == "__main__":
    main()
