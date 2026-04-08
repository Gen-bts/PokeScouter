"""OCR エンジン CLI テストツール.

使い方:
    cd backend

    # 単一エンジンで画像をテスト
    python -m tools.ocr_test run test.png --engine paddle

    # 全エンジン比較
    python -m tools.ocr_test compare test.png

    # ベンチマーク
    python -m tools.ocr_test benchmark test.png --engine paddle --iterations 10

    # 期待値を保存（回帰テスト用）
    python -m tools.ocr_test save-expect test.png --engine paddle --expected "152"
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from pathlib import Path
from typing import Sequence

from app.ocr.base import OCREngine, OCRResult
from app.ocr.pipeline import OCRPipeline

# エンジン名 → クラスのマッピング（遅延インポート）
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


def _load_pipeline(name: str) -> OCRPipeline:
    """エンジンをロードしてパイプラインを構成."""
    cls = _get_engine_class(name)
    engine = cls()
    print(f"[{name}] モデルをロード中...")
    t0 = time.perf_counter()
    engine.load()
    elapsed = (time.perf_counter() - t0) * 1000
    print(f"[{name}] ロード完了 ({elapsed:.0f}ms)")

    return OCRPipeline(engine)


def _format_results(results: list[OCRResult]) -> str:
    """認識結果を整形して文字列で返す."""
    if not results:
        return "  (結果なし)"
    lines: list[str] = []
    for i, r in enumerate(results):
        bbox_str = ""
        if r.bounding_box is not None:
            b = r.bounding_box
            bbox_str = f" [{b.x_min},{b.y_min} -> {b.x_max},{b.y_max}]"

        lines.append(f'  [{i}] "{r.text}"  conf={r.confidence:.4f}{bbox_str}')
    return "\n".join(lines)


def _run_pipeline(pipeline: OCRPipeline, image_path: Path) -> tuple[list[OCRResult], float]:
    """パイプラインで認識を実行し、結果と処理時間(ms)を返す."""
    t0 = time.perf_counter()
    results = pipeline.run_from_file(image_path)
    elapsed = (time.perf_counter() - t0) * 1000
    return results, elapsed


# --- サブコマンド実装 ---


def cmd_run(args: argparse.Namespace) -> None:
    """単一エンジンで画像を認識."""
    image_path = Path(args.image)
    if not image_path.exists():
        print(f"エラー: 画像が見つかりません: {image_path}")
        sys.exit(1)

    pipeline = _load_pipeline(args.engine)
    results, elapsed = _run_pipeline(pipeline, image_path)

    print(f"\n=== {pipeline.engine.engine_name} | {image_path.name} | {elapsed:.1f}ms ===")
    print(_format_results(results))


def cmd_compare(args: argparse.Namespace) -> None:
    """全エンジンで画像を認識して比較."""
    image_path = Path(args.image)
    if not image_path.exists():
        print(f"エラー: 画像が見つかりません: {image_path}")
        sys.exit(1)

    engine_names = args.engines.split(",") if args.engines else ["paddle", "manga", "glm"]

    print(f"\n画像: {image_path.name}")
    print("=" * 60)

    for name in engine_names:
        pipeline = _load_pipeline(name)
        results, elapsed = _run_pipeline(pipeline, image_path)
        print(f"\n--- {pipeline.engine.engine_name} ({elapsed:.1f}ms) ---")
        print(_format_results(results))
        pipeline.engine.unload()

    print("\n" + "=" * 60)


def cmd_benchmark(args: argparse.Namespace) -> None:
    """エンジンの処理速度を計測."""
    image_path = Path(args.image)
    if not image_path.exists():
        print(f"エラー: 画像が見つかりません: {image_path}")
        sys.exit(1)

    pipeline = _load_pipeline(args.engine)
    iterations = args.iterations

    # ウォームアップ（1回）
    pipeline.run_from_file(image_path)

    timings: list[float] = []
    for i in range(iterations):
        _, elapsed = _run_pipeline(pipeline, image_path)
        timings.append(elapsed)
        print(f"  [{i + 1}/{iterations}] {elapsed:.1f}ms")

    print(f"\n=== ベンチマーク結果: {pipeline.engine.engine_name} ({iterations} 回) ===")
    print(f"  平均:  {statistics.mean(timings):.1f}ms")
    print(f"  中央:  {statistics.median(timings):.1f}ms")
    print(f"  最小:  {min(timings):.1f}ms")
    print(f"  最大:  {max(timings):.1f}ms")
    if len(timings) >= 2:
        print(f"  標準偏差: {statistics.stdev(timings):.1f}ms")


def cmd_save_expect(args: argparse.Namespace) -> None:
    """期待値を JSON ファイルに保存."""
    image_path = Path(args.image)
    if not image_path.exists():
        print(f"エラー: 画像が見つかりません: {image_path}")
        sys.exit(1)

    expectations_dir = Path("tests/fixtures/expectations")
    expectations_dir.mkdir(parents=True, exist_ok=True)

    json_path = expectations_dir / f"{image_path.stem}.json"

    # 既存ファイルがあれば読み込み
    data: dict = {}
    if json_path.exists():
        data = json.loads(json_path.read_text(encoding="utf-8"))

    if "image_file" not in data:
        data["image_file"] = image_path.name
        data["expectations"] = []

    data["expectations"].append(
        {
            "engine": args.engine,
            "expected_text": args.expected,
            "notes": args.notes or "",
        }
    )

    json_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"期待値を保存: {json_path}")


def cmd_scan(args: argparse.Namespace) -> None:
    """config の座標定義に基づいて全体画像から一括認識."""
    image_path = Path(args.image)
    if not image_path.exists():
        print(f"エラー: 画像が見つかりません: {image_path}")
        sys.exit(1)

    from app.ocr.region import RegionConfig, RegionRecognizer

    config = RegionConfig(args.config) if args.config else RegionConfig()
    recognizer = RegionRecognizer(config)

    print(f"\n画像: {image_path.name}")
    print(f"シーン: {args.scene}")
    print("=" * 60)

    results = recognizer.recognize_from_file(image_path, args.scene)

    for r in results:
        region = r.region
        print(f"  {region.name:20s}: \"{r.text}\"  ({r.elapsed_ms:.0f}ms)")

    print("=" * 60)
    recognizer.unload_all()


# --- CLI 定義 ---


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="PokeScouter OCR テストツール",
        prog="python -m tools.ocr_test",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # run
    p_run = sub.add_parser("run", help="単一エンジンで画像を認識")
    p_run.add_argument("image", help="画像ファイルパス")
    p_run.add_argument(
        "--engine", required=True, choices=["paddle", "manga", "glm"], help="使用エンジン"
    )
    p_run.set_defaults(func=cmd_run)

    # compare
    p_compare = sub.add_parser("compare", help="全エンジンで比較")
    p_compare.add_argument("image", help="画像ファイルパス")
    p_compare.add_argument(
        "--engines", default=None, help="比較するエンジン（カンマ区切り、例: paddle,manga）"
    )
    p_compare.set_defaults(func=cmd_compare)

    # benchmark
    p_bench = sub.add_parser("benchmark", help="処理速度の計測")
    p_bench.add_argument("image", help="画像ファイルパス")
    p_bench.add_argument(
        "--engine", required=True, choices=["paddle", "manga", "glm"], help="使用エンジン"
    )
    p_bench.add_argument("--iterations", type=int, default=10, help="繰り返し回数 (default: 10)")
    p_bench.set_defaults(func=cmd_benchmark)

    # save-expect
    p_save = sub.add_parser("save-expect", help="期待値を保存")
    p_save.add_argument("image", help="画像ファイルパス")
    p_save.add_argument(
        "--engine", required=True, choices=["paddle", "manga", "glm"], help="対象エンジン"
    )
    p_save.add_argument("--expected", required=True, help="期待する認識テキスト")
    p_save.add_argument("--notes", default=None, help="メモ（例: HP表示, 自分のポケモン）")
    p_save.set_defaults(func=cmd_save_expect)

    # scan
    p_scan = sub.add_parser("scan", help="config 座標で全体画像から一括認識")
    p_scan.add_argument("image", help="全体画像ファイルパス")
    p_scan.add_argument(
        "--scene", required=True, help="シーン種別 (例: battle, team_select)"
    )
    p_scan.add_argument("--config", default=None, help="regions.json のパス（省略時はデフォルト）")
    p_scan.set_defaults(func=cmd_scan)

    return parser


def main(argv: Sequence[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
