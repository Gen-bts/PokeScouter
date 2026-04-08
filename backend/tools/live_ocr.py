"""キャプチャボード映像に対するリアルタイム OCR ツール.

使い方:
    cd backend
    python -m tools.live_ocr [--device 0] [--scene battle] [--interval 0.5]

キー操作:
    q: 終了
    s: 現在のフレームを保存
    c: ROI 選択モード（矩形をドラッグ → クロップ保存）
    1: battle シーン切替
    2: team_select シーン切替
    r: OCR 即時再実行
    p: OCR 一時停止/再開
    d: オーバーレイ表示切替
"""

from __future__ import annotations

import argparse
import threading
import time
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

from app.ocr.region import RegionConfig, RegionRecognizer, RegionResult

_WINDOW_NAME = "PokeScouter Live OCR"

# --- 日本語フォント (Pillow) ---

_PIL_AVAILABLE = False
_FONT = None
_FONT_SMALL = None

try:
    from PIL import Image, ImageDraw, ImageFont

    _PIL_AVAILABLE = True
    _FONT_PATHS = [
        "C:/Windows/Fonts/msgothic.ttc",
        "C:/Windows/Fonts/meiryo.ttc",
        "C:/Windows/Fonts/YuGothM.ttc",
    ]
    for fp in _FONT_PATHS:
        if Path(fp).exists():
            _FONT = ImageFont.truetype(fp, 20)
            _FONT_SMALL = ImageFont.truetype(fp, 14)
            break
    if _FONT is None:
        _FONT = ImageFont.load_default()
        _FONT_SMALL = _FONT
except ImportError:
    pass


# --- 共有状態 ---


class LiveOCRState:
    """メインスレッドと OCR ワーカー間の共有状態."""

    def __init__(self, scene: str, interval: float) -> None:
        self.lock = threading.Lock()
        self.latest_frame: np.ndarray | None = None
        self.last_results: list[RegionResult] = []
        self.last_ocr_time_ms: float = 0.0
        self.scene: str = scene
        self.interval: float = interval
        self.running: bool = True
        self.engine_loading: bool = False
        self.paused: bool = False
        self.show_overlay: bool = True
        self.force_run: bool = False


# --- OCR ワーカースレッド ---


def ocr_worker(state: LiveOCRState, recognizer: RegionRecognizer) -> None:
    """バックグラウンドで定期的に OCR を実行するワーカー."""
    while state.running:
        # 一時停止中はスリープ
        if state.paused and not state.force_run:
            time.sleep(0.05)
            continue

        # フレームとシーンを取得
        with state.lock:
            frame = state.latest_frame
            scene = state.scene
            state.force_run = False

        if frame is None:
            time.sleep(0.05)
            continue

        # OCR 実行
        try:
            with state.lock:
                state.engine_loading = True

            t0 = time.perf_counter()
            results = recognizer.recognize(frame, scene)
            elapsed = (time.perf_counter() - t0) * 1000

            with state.lock:
                state.last_results = results
                state.last_ocr_time_ms = elapsed
                state.engine_loading = False
        except Exception as e:
            print(f"OCR エラー: {e}")
            with state.lock:
                state.last_results = []
                state.engine_loading = False

        # インターバル待機（OCR 処理時間を差し引き）
        wait = max(0.0, state.interval - (elapsed / 1000))
        # 細かく刻んで running チェック
        end_time = time.perf_counter() + wait
        while time.perf_counter() < end_time and state.running:
            if state.force_run:
                break
            time.sleep(0.05)


# --- 描画 ---


def _put_japanese_text(
    image: np.ndarray,
    text: str,
    pos: tuple[int, int],
    color: tuple[int, int, int] = (0, 255, 0),
    font: ImageFont.FreeTypeFont | None = None,
) -> np.ndarray:
    """PIL を使って日本語テキストを描画する."""
    if not _PIL_AVAILABLE or _FONT is None:
        # フォールバック: cv2.putText (日本語は文字化け)
        cv2.putText(image, text, pos, cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
        return image

    pil_img = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(pil_img)
    use_font = font or _FONT

    # 背景矩形（視認性向上）
    x, y = pos
    bbox = draw.textbbox((x, y), text, font=use_font)
    draw.rectangle(
        [bbox[0] - 2, bbox[1] - 1, bbox[2] + 2, bbox[3] + 1],
        fill=(0, 0, 0, 200),
    )
    draw.text((x, y), text, font=use_font, fill=color)

    return cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)


def draw_overlay(
    frame: np.ndarray,
    state: LiveOCRState,
    config: RegionConfig,
) -> np.ndarray:
    """フレームに OCR 結果と HUD を描画する."""
    display = frame.copy()

    with state.lock:
        results = list(state.last_results)
        scene = state.scene
        ocr_time = state.last_ocr_time_ms
        loading = state.engine_loading
        paused = state.paused
        show = state.show_overlay

    if not show:
        # HUD のみ表示
        _draw_hud(display, scene, ocr_time, loading, paused, state.interval)
        return display

    # 結果をリージョン名でインデックス化
    result_map: dict[str, RegionResult] = {r.region.name: r for r in results}

    # リージョン矩形 + テキスト描画
    regions = config.get_regions(scene)
    for region in regions:
        r = result_map.get(region.name)
        if r and r.text:
            color = (0, 255, 0)  # 緑: 結果あり
            label = f"{region.name}: {r.text}"
        else:
            color = (0, 255, 255)  # 黄: 結果待ち
            label = f"{region.name}: ---"

        # 矩形描画
        cv2.rectangle(
            display,
            (region.x, region.y),
            (region.x + region.w, region.y + region.h),
            color,
            2,
        )

        # テキストラベル（矩形の上に表示）
        text_y = max(region.y - 25, 5)
        display = _put_japanese_text(display, label, (region.x, text_y), color)

    _draw_hud(display, scene, ocr_time, loading, paused, state.interval)
    return display


def _draw_hud(
    display: np.ndarray,
    scene: str,
    ocr_time: float,
    loading: bool,
    paused: bool,
    interval: float,
) -> None:
    """左上に HUD 情報を描画する (ASCII のみなので cv2.putText)."""
    y = 30
    line_h = 28

    def put(text: str, color: tuple[int, int, int] = (255, 255, 255)) -> None:
        nonlocal y
        # 背景矩形
        (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.7, 2)
        cv2.rectangle(display, (8, y - th - 4), (16 + tw, y + 6), (0, 0, 0), -1)
        cv2.putText(display, text, (10, y), cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
        y += line_h

    put(f"Scene: {scene}")
    put(f"Interval: {interval:.1f}s")

    if loading:
        put("OCR: Loading...", (0, 165, 255))
    elif paused:
        put("OCR: PAUSED", (0, 0, 255))
    elif ocr_time > 0:
        put(f"OCR: {ocr_time:.0f}ms", (0, 255, 0))

    # キー操作ヘルプ
    put("[q]uit [s]ave [c]rop [1/2]scene [r]un [p]ause [d]isplay", (180, 180, 180))


# --- フレーム保存 (capture.py と同等) ---


def _save_frame(image: np.ndarray, output_dir: Path, suffix: str = "") -> Path:
    """タイムスタンプ付きファイル名でフレームを保存."""
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{timestamp}{suffix}.png"
    path = output_dir / filename
    cv2.imwrite(str(path), image)
    return path


def _select_and_crop(image: np.ndarray, output_dir: Path) -> None:
    """矩形 ROI を選択してクロップ画像を保存."""
    roi = cv2.selectROI(_WINDOW_NAME, image, showCrosshair=True, fromCenter=False)
    x, y, w, h = roi
    if w == 0 or h == 0:
        print("ROI 選択がキャンセルされました。")
        return
    cropped = image[y : y + h, x : x + w]
    path = _save_frame(cropped, output_dir, suffix=f"_crop_{x}_{y}_{w}x{h}")
    print(f"クロップ保存: {path}")


# --- メインループ ---


def live_ocr_loop(
    device: int,
    output_dir: Path,
    scene: str,
    interval: float,
) -> None:
    """キャプチャボードからライブ映像を表示し、リアルタイム OCR を実行する."""
    cap = cv2.VideoCapture(device)
    if not cap.isOpened():
        print(f"エラー: デバイス {device} を開けません。")
        print("ヒント: --device オプションで別のデバイス番号を試してください。")
        return

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)

    actual_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    actual_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"キャプチャ開始: {actual_w}x{actual_h}")

    if actual_w != 1920 or actual_h != 1080:
        print(f"警告: 解像度が 1920x1080 ではありません。リージョン座標がずれる可能性があります。")

    config = RegionConfig()
    recognizer = RegionRecognizer(config)
    state = LiveOCRState(scene=scene, interval=interval)

    if not _PIL_AVAILABLE:
        print("警告: Pillow がインストールされていないため、日本語テキストが正しく表示されません。")
    elif _FONT is None:
        print("警告: 日本語フォントが見つかりません。テキスト表示が制限されます。")

    print(f"シーン: {scene} | OCR 間隔: {interval}s")
    print("操作: [q]終了 [s]保存 [c]クロップ [1]battle [2]team_select [r]即時OCR [p]停止 [d]表示切替")

    # OCR ワーカースレッド開始
    worker = threading.Thread(target=ocr_worker, args=(state, recognizer), daemon=True)
    worker.start()

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                print("フレームの取得に失敗しました。")
                break

            # フレームをワーカーに渡す
            with state.lock:
                state.latest_frame = frame

            # オーバーレイ描画
            display = draw_overlay(frame, state, config)
            cv2.imshow(_WINDOW_NAME, display)

            key = cv2.waitKey(1) & 0xFF

            if key == ord("q"):
                break
            elif key == ord("s"):
                path = _save_frame(frame, output_dir)
                print(f"フレーム保存: {path}")
            elif key == ord("c"):
                _select_and_crop(frame, output_dir)
            elif key == ord("1"):
                with state.lock:
                    state.scene = "battle"
                    state.last_results = []
                print("シーン切替: battle")
            elif key == ord("2"):
                with state.lock:
                    state.scene = "team_select"
                    state.last_results = []
                print("シーン切替: team_select")
            elif key == ord("r"):
                state.force_run = True
                print("OCR 即時実行")
            elif key == ord("p"):
                state.paused = not state.paused
                print(f"OCR {'一時停止' if state.paused else '再開'}")
            elif key == ord("d"):
                state.show_overlay = not state.show_overlay
                print(f"オーバーレイ {'非表示' if not state.show_overlay else '表示'}")
    finally:
        state.running = False
        worker.join(timeout=5)
        recognizer.unload_all()
        cap.release()
        cv2.destroyAllWindows()


# --- CLI ---


def main() -> None:
    parser = argparse.ArgumentParser(
        description="キャプチャボード映像に対するリアルタイム OCR",
        prog="python -m tools.live_ocr",
    )
    parser.add_argument(
        "--device", type=int, default=0, help="VideoCapture デバイス番号 (default: 0)"
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("tests/fixtures/images"),
        help="保存先ディレクトリ (default: tests/fixtures/images)",
    )
    parser.add_argument(
        "--scene",
        default="battle",
        choices=["battle", "team_select"],
        help="初期シーン (default: battle)",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=0.5,
        help="OCR 実行間隔（秒） (default: 0.5)",
    )
    args = parser.parse_args()
    live_ocr_loop(args.device, args.output_dir, args.scene, args.interval)


if __name__ == "__main__":
    main()
