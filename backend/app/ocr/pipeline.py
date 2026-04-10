"""OCR パイプライン.

エンジンをラップして画像認識を実行する。
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from app.ocr.base import OCREngine, OCRResult


class OCRPipeline:
    """OCR エンジンをラップして認識を実行する.

    使い方:
        pipeline = OCRPipeline(engine)
        results = pipeline.run(image)
    """

    def __init__(self, engine: OCREngine) -> None:
        self._engine = engine

    @property
    def engine(self) -> OCREngine:
        return self._engine

    def run(
        self,
        image: np.ndarray,
        *,
        lang: str = "ja",
    ) -> list[OCRResult]:
        """画像を認識する.

        Args:
            image: BGR numpy 配列
            lang: 認識言語
        """
        return self._engine.recognize(image, lang=lang)

    def run_batch(
        self,
        images: list[np.ndarray],
        *,
        lang: str = "ja",
    ) -> list[list[OCRResult]]:
        """複数画像をバッチ認識する."""
        return self._engine.recognize_batch(images, lang=lang)

    def run_from_file(
        self,
        path: str | Path,
        *,
        lang: str = "ja",
    ) -> list[OCRResult]:
        """ファイルパスから認識を実行する."""
        import cv2

        img = cv2.imread(str(path))
        if img is None:
            raise FileNotFoundError(f"画像を読み込めません: {path}")
        return self.run(img, lang=lang)
