"""画像クロップツール.

全体スクリーンショットからポケモン名・HP領域などを矩形選択して切り出す。

使い方:
    cd backend
    python -m tools.crop <画像パス> [--output-dir tests/fixtures/images/name_crop]

操作:
    マウスドラッグ: 矩形選択 → 自動保存
    r: リセット（選択やり直し）
    q: 終了
"""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

_WINDOW_NAME = "PokeScouter Crop"


class CropSession:
    """1枚の画像に対するクロップセッション."""

    def __init__(self, image: np.ndarray, source_name: str, output_dir: Path) -> None:
        self.original = image.copy()
        self.display = image.copy()
        self.source_name = source_name
        self.output_dir = output_dir
        self.drawing = False
        self.start_x = 0
        self.start_y = 0
        self.count = 0

    def mouse_callback(self, event: int, x: int, y: int, flags: int, param: object) -> None:
        if event == cv2.EVENT_LBUTTONDOWN:
            self.drawing = True
            self.start_x = x
            self.start_y = y
            self.display = self.original.copy()

        elif event == cv2.EVENT_MOUSEMOVE and self.drawing:
            self.display = self.original.copy()
            cv2.rectangle(self.display, (self.start_x, self.start_y), (x, y), (0, 255, 0), 2)

        elif event == cv2.EVENT_LBUTTONUP:
            self.drawing = False
            x1 = min(self.start_x, x)
            y1 = min(self.start_y, y)
            x2 = max(self.start_x, x)
            y2 = max(self.start_y, y)

            if x2 - x1 < 5 or y2 - y1 < 5:
                return

            cropped = self.original[y1:y2, x1:x2]
            path = self._save(cropped, x1, y1, x2 - x1, y2 - y1)
            print(f"  保存: {path}  ({x2 - x1}x{y2 - y1})")
            self.count += 1

            # 切り出し済み領域を緑枠で残す
            cv2.rectangle(self.original, (x1, y1), (x2, y2), (0, 255, 0), 2)
            cv2.putText(
                self.original, str(self.count), (x1 + 4, y1 + 20),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2,
            )
            self.display = self.original.copy()

    def _save(self, image: np.ndarray, x: int, y: int, w: int, h: int) -> Path:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        stem = Path(self.source_name).stem
        timestamp = datetime.now().strftime("%H%M%S")
        filename = f"{stem}_crop{self.count + 1}_{x}_{y}_{w}x{h}_{timestamp}.png"
        path = self.output_dir / filename
        cv2.imwrite(str(path), image)
        return path


def run_crop(image_path: Path, output_dir: Path) -> None:
    img = cv2.imread(str(image_path))
    if img is None:
        print(f"エラー: 画像を読み込めません: {image_path}")
        return

    session = CropSession(img, image_path.name, output_dir)

    cv2.namedWindow(_WINDOW_NAME, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(_WINDOW_NAME, min(img.shape[1], 1600), min(img.shape[0], 900))
    cv2.setMouseCallback(_WINDOW_NAME, session.mouse_callback)

    print(f"画像: {image_path.name} ({img.shape[1]}x{img.shape[0]})")
    print(f"保存先: {output_dir}")
    print("操作: ドラッグで矩形選択 → 自動保存 | r=リセット | q=終了")

    while True:
        cv2.imshow(_WINDOW_NAME, session.display)
        key = cv2.waitKey(30) & 0xFF

        if key == ord("q"):
            break
        elif key == ord("r"):
            session.original = cv2.imread(str(image_path))
            session.display = session.original.copy()
            session.count = 0
            print("リセットしました")

    cv2.destroyAllWindows()
    print(f"完了: {session.count} 枚保存")


def main() -> None:
    parser = argparse.ArgumentParser(description="画像からテスト領域をクロップ")
    parser.add_argument("image", help="元画像のパス")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="保存先ディレクトリ (default: 元画像と同じフォルダ)",
    )
    args = parser.parse_args()

    image_path = Path(args.image)
    output_dir = args.output_dir or image_path.parent
    run_crop(image_path, output_dir)


if __name__ == "__main__":
    main()
