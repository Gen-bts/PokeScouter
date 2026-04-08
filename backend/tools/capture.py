"""キャプチャボードからのフレーム取り込みユーティリティ.

使い方:
    cd backend
    python -m tools.capture [--device 0] [--output-dir tests/fixtures/images]

キー操作:
    s: 現在のフレームを保存
    c: ROI 選択モード（矩形をドラッグ → クロップ保存）
    q: 終了
"""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

_WINDOW_NAME = "PokeScouter Capture"


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


def capture_loop(device: int, output_dir: Path) -> None:
    """キャプチャボードからライブプレビューを表示し、キー操作でフレームを保存."""
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
    print("操作: [s] 保存  [c] クロップ保存  [q] 終了")

    while True:
        ret, frame = cap.read()
        if not ret:
            print("フレームの取得に失敗しました。")
            break

        cv2.imshow(_WINDOW_NAME, frame)
        key = cv2.waitKey(1) & 0xFF

        if key == ord("q"):
            break
        elif key == ord("s"):
            path = _save_frame(frame, output_dir)
            print(f"フレーム保存: {path}")
        elif key == ord("c"):
            _select_and_crop(frame, output_dir)

    cap.release()
    cv2.destroyAllWindows()


def main() -> None:
    parser = argparse.ArgumentParser(description="キャプチャボードからテスト画像を取り込む")
    parser.add_argument(
        "--device", type=int, default=0, help="VideoCapture デバイス番号 (default: 0)"
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("tests/fixtures/images"),
        help="保存先ディレクトリ (default: tests/fixtures/images)",
    )
    args = parser.parse_args()
    capture_loop(args.device, args.output_dir)


if __name__ == "__main__":
    main()
