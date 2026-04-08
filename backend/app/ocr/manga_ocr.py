"""manga-ocr エンジンラッパー."""

from __future__ import annotations

import numpy as np
from PIL import Image

from app.ocr.base import OCREngine, OCRResult


class MangaOCREngine(OCREngine):
    """manga-ocr による日本語テキスト認識.

    主な用途: ポケモン名認識（日本語特化, ~30ms/回）
    前提: 事前にクロップされた単一行テキスト領域を入力として受け取る。
    """

    def __init__(self) -> None:
        self._mocr: object | None = None

    @property
    def engine_name(self) -> str:
        return "manga"

    @property
    def is_loaded(self) -> bool:
        return self._mocr is not None

    def load(self) -> None:
        if self._mocr is not None:
            return
        from manga_ocr import MangaOcr

        self._mocr = MangaOcr()

    def unload(self) -> None:
        self._mocr = None

    def recognize(self, image: np.ndarray, lang: str = "ja") -> list[OCRResult]:
        if self._mocr is None:
            raise RuntimeError("エンジン未ロード。先に load() を呼んでください。")

        # BGR (OpenCV) → RGB (PIL)
        rgb = image[:, :, ::-1]
        pil_image = Image.fromarray(rgb)

        text: str = self._mocr(pil_image)

        return [
            OCRResult(
                text=text,
                confidence=1.0,  # manga-ocr は信頼度を公開していない
                bounding_box=None,
            )
        ]
