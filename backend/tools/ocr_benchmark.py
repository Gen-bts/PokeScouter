"""OCR エンジン横並び比較ベンチマーク.

各クロップリージョンに対して複数のOCRエンジンを走らせ、
結果を横並びで比較する。エンジン選定の判断材料を得るためのツール。

使い方:
    cd backend

    # バトル画面のスクリーンショットで全エンジン比較
    python -m tools.ocr_benchmark screenshots/ --scene battle

    # 特定リージョンだけに絞る
    python -m tools.ocr_benchmark screenshots/ --scene battle --regions 自分HP,相手HP

    # エンジンを絞る
    python -m tools.ocr_benchmark screenshots/ --scene battle --engines paddle,manga

    # クロップ画像を保存して目視確認
    python -m tools.ocr_benchmark screenshots/ --scene battle --save-crops

    # 結果を JSON にも出力
    python -m tools.ocr_benchmark screenshots/ --scene battle --json

    # 全エンジンを同時ロード（VRAM に余裕がある場合）
    python -m tools.ocr_benchmark screenshots/ --scene battle --keep-loaded
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Sequence

import cv2
import numpy as np

from app.ocr.base import OCREngine, OCRResult
from app.ocr.pipeline import OCRPipeline
from app.ocr.region import Region, RegionConfig

ALL_ENGINES = ["paddle", "manga", "glm"]

_ENGINE_FACTORIES: dict[str, type[OCREngine]] = {}


def _get_engine_class(name: str) -> type[OCREngine]:
    """エンジンクラスを遅延インポートで取得."""
    if not _ENGINE_FACTORIES:
        from app.ocr.glm_ocr import GLMOCREngine
        from app.ocr.manga_ocr import MangaOCREngine
        from app.ocr.paddle_ocr import PaddleOCREngine

        _ENGINE_FACTORIES["paddle"] = PaddleOCREngine
        _ENGINE_FACTORIES["manga"] = MangaOCREngine
        _ENGINE_FACTORIES["glm"] = GLMOCREngine

    if name not in _ENGINE_FACTORIES:
        print(f"エラー: 不明なエンジン '{name}'。選択肢: {list(_ENGINE_FACTORIES.keys())}")
        sys.exit(1)
    return _ENGINE_FACTORIES[name]


@dataclass
class BenchmarkEntry:
    """ベンチマーク1件の結果."""

    screenshot: str
    region_name: str
    engine: str
    text: str
    confidence: float
    time_ms: float


def _load_images(input_path: Path) -> list[tuple[str, np.ndarray]]:
    """画像ファイルを読み込む。ディレクトリならPNG/JPGを全て読む."""
    paths: list[Path] = []
    if input_path.is_dir():
        for ext in ("*.png", "*.jpg", "*.jpeg", "*.bmp"):
            paths.extend(sorted(input_path.glob(ext)))
        if not paths:
            print(f"エラー: ディレクトリに画像が見つかりません: {input_path}")
            sys.exit(1)
    elif input_path.is_file():
        paths = [input_path]
    else:
        print(f"エラー: パスが見つかりません: {input_path}")
        sys.exit(1)

    images: list[tuple[str, np.ndarray]] = []
    for p in paths:
        img = cv2.imread(str(p))
        if img is None:
            print(f"警告: 画像を読み込めません（スキップ）: {p}")
            continue
        images.append((p.name, img))

    if not images:
        print("エラー: 読み込める画像がありません")
        sys.exit(1)

    return images


def run_benchmark(
    images: list[tuple[str, np.ndarray]],
    regions: list[Region],
    engine_names: list[str],
    keep_loaded: bool = False,
) -> list[BenchmarkEntry]:
    """全画像 × 全リージョン × 全エンジンでOCRを実行."""
    entries: list[BenchmarkEntry] = []

    if keep_loaded:
        # 全エンジンを先にロード
        engines: dict[str, OCREngine] = {}
        for name in engine_names:
            cls = _get_engine_class(name)
            engine = cls()
            print(f"[{name}] モデルをロード中...")
            t0 = time.perf_counter()
            engine.load()
            elapsed = (time.perf_counter() - t0) * 1000
            print(f"[{name}] ロード完了 ({elapsed:.0f}ms)")
            engines[name] = engine

        for filename, image in images:
            for region in regions:
                cropped = region.crop(image)
                for name in engine_names:
                    pipeline = OCRPipeline(engines[name])
                    t0 = time.perf_counter()
                    results = pipeline.run(cropped)
                    elapsed = (time.perf_counter() - t0) * 1000
                    text = "".join(r.text for r in results)
                    conf = results[0].confidence if results else 0.0
                    entries.append(BenchmarkEntry(
                        screenshot=filename,
                        region_name=region.name,
                        engine=name,
                        text=text,
                        confidence=conf,
                        time_ms=elapsed,
                    ))

        for engine in engines.values():
            engine.unload()
    else:
        # エンジンを逐次ロード・アンロード（VRAM節約）
        for name in engine_names:
            cls = _get_engine_class(name)
            engine = cls()
            print(f"[{name}] モデルをロード中...")
            t0 = time.perf_counter()
            engine.load()
            elapsed = (time.perf_counter() - t0) * 1000
            print(f"[{name}] ロード完了 ({elapsed:.0f}ms)")

            pipeline = OCRPipeline(engine)

            for filename, image in images:
                for region in regions:
                    cropped = region.crop(image)
                    t0 = time.perf_counter()
                    results = pipeline.run(cropped)
                    elapsed = (time.perf_counter() - t0) * 1000
                    text = "".join(r.text for r in results)
                    conf = results[0].confidence if results else 0.0
                    entries.append(BenchmarkEntry(
                        screenshot=filename,
                        region_name=region.name,
                        engine=name,
                        text=text,
                        confidence=conf,
                        time_ms=elapsed,
                    ))

            print(f"[{name}] アンロード中...")
            engine.unload()

    return entries


def print_table(entries: list[BenchmarkEntry]) -> None:
    """結果をテーブル形式で表示."""
    if not entries:
        print("結果がありません")
        return

    # スクリーンショットごとにグルーピング
    screenshots: dict[str, list[BenchmarkEntry]] = {}
    for e in entries:
        screenshots.setdefault(e.screenshot, []).append(e)

    for filename, file_entries in screenshots.items():
        print(f"\nScreenshot: {filename}")

        # カラム幅を計算
        max_region = max(len(e.region_name) for e in file_entries)
        max_engine = max(len(e.engine) for e in file_entries)
        max_text = max(max(len(e.text) for e in file_entries), 4)

        col_region = max(max_region, 6)  # "Region" の長さ
        col_engine = max(max_engine, 6)  # "Engine" の長さ
        col_text = min(max(max_text, 4), 30)  # 最大30文字に制限

        header = (
            f"{'Region':<{col_region}} | "
            f"{'Engine':<{col_engine}} | "
            f"{'Text':<{col_text}} | "
            f"{'Conf':>6} | "
            f"{'Time':>7}"
        )
        separator = (
            f"{'-' * col_region}-+-"
            f"{'-' * col_engine}-+-"
            f"{'-' * col_text}-+-"
            f"{'-' * 6}-+-"
            f"{'-' * 7}"
        )

        print(header)
        print(separator)

        # リージョンごとにまとめて表示
        current_region = None
        for e in sorted(file_entries, key=lambda x: (x.region_name, x.engine)):
            if current_region is not None and e.region_name != current_region:
                print(separator)
            current_region = e.region_name

            text_display = e.text if len(e.text) <= col_text else e.text[:col_text - 3] + "..."
            if not text_display:
                text_display = "(empty)"

            print(
                f"{e.region_name:<{col_region}} | "
                f"{e.engine:<{col_engine}} | "
                f"{text_display:<{col_text}} | "
                f"{e.confidence:>6.4f} | "
                f"{e.time_ms:>5.0f}ms"
            )

        print()


def save_crops(
    images: list[tuple[str, np.ndarray]],
    regions: list[Region],
    output_dir: Path,
) -> None:
    """クロップ画像を保存."""
    output_dir.mkdir(parents=True, exist_ok=True)
    for filename, image in images:
        stem = Path(filename).stem
        for region in regions:
            cropped = region.crop(image)
            crop_name = f"{stem}_{region.name}.png"
            crop_path = output_dir / crop_name
            cv2.imwrite(str(crop_path), cropped)
    print(f"クロップ画像を保存: {output_dir}")


def save_json(entries: list[BenchmarkEntry], output_path: Path) -> None:
    """結果をJSONで保存."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    data = [asdict(e) for e in entries]
    output_path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"JSON 結果を保存: {output_path}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="OCR エンジン横並び比較ベンチマーク",
        prog="python -m tools.ocr_benchmark",
    )
    parser.add_argument(
        "input",
        help="画像ファイルまたはディレクトリのパス",
    )
    parser.add_argument(
        "--scene",
        required=True,
        help="シーン名（例: battle, team_select）",
    )
    parser.add_argument(
        "--engines",
        default=None,
        help="比較するエンジン（カンマ区切り、デフォルト: paddle,manga,glm）",
    )
    parser.add_argument(
        "--regions",
        default=None,
        help="リージョン名フィルタ（カンマ区切り、デフォルト: 全リージョン）",
    )
    parser.add_argument(
        "--save-crops",
        action="store_true",
        help="クロップ画像を保存",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        dest="save_json",
        help="結果を JSON でも出力",
    )
    parser.add_argument(
        "--output-dir",
        default="tests/fixtures/benchmark",
        help="出力ディレクトリ（デフォルト: tests/fixtures/benchmark/）",
    )
    parser.add_argument(
        "--keep-loaded",
        action="store_true",
        help="全エンジンを同時ロード（VRAMに余裕がある場合）",
    )
    parser.add_argument(
        "--config",
        default=None,
        help="regions.json のパス（省略時はデフォルト）",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)

    input_path = Path(args.input)
    output_dir = Path(args.output_dir)

    # リージョン設定を読み込み
    config = RegionConfig(args.config) if args.config else RegionConfig()

    if args.scene not in config.scenes:
        print(f"エラー: 不明なシーン '{args.scene}'。選択肢: {config.scenes}")
        sys.exit(1)

    regions = config.get_regions(args.scene)
    if not regions:
        print(f"エラー: シーン '{args.scene}' にリージョンが定義されていません")
        sys.exit(1)

    # リージョンフィルタ
    if args.regions:
        region_filter = set(args.regions.split(","))
        regions = [r for r in regions if r.name in region_filter]
        if not regions:
            print(f"エラー: 指定されたリージョンが見つかりません: {args.regions}")
            sys.exit(1)

    # エンジン一覧
    engine_names = args.engines.split(",") if args.engines else ALL_ENGINES

    # 画像を読み込み
    images = _load_images(input_path)

    print(f"シーン: {args.scene}")
    print(f"リージョン: {[r.name for r in regions]}")
    print(f"エンジン: {engine_names}")
    print(f"画像数: {len(images)}")
    print()

    # クロップ画像を保存
    if args.save_crops:
        save_crops(images, regions, output_dir / "crops")

    # ベンチマーク実行
    entries = run_benchmark(images, regions, engine_names, keep_loaded=args.keep_loaded)

    # 結果表示
    print("\n" + "=" * 70)
    print("比較結果")
    print("=" * 70)
    print_table(entries)

    # JSON 出力
    if args.save_json:
        save_json(entries, output_dir / "benchmark_results.json")


if __name__ == "__main__":
    main()
