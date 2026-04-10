"""PaddleOCR PP-OCRv5 エンジンラッパー."""

from __future__ import annotations

import numpy as np

from app.ocr.base import BoundingBox, OCREngine, OCRResult


class PaddleOCREngine(OCREngine):
    """PaddleOCR PP-OCRv5 による数値・テキスト認識.

    主な用途: HP 数値読取り（リアルタイム, ~50ms/回）
    """

    def __init__(
        self,
        *,
        det_model: str = "PP-OCRv5_mobile_det",
        rec_model: str = "PP-OCRv5_mobile_rec",
        device: str = "gpu:0",
    ) -> None:
        self._det_model = det_model
        self._rec_model = rec_model
        self._device = device
        self._ocr: object | None = None

    @property
    def engine_name(self) -> str:
        return "paddle"

    @property
    def is_loaded(self) -> bool:
        return self._ocr is not None

    def load(self) -> None:
        if self._ocr is not None:
            return
        from paddleocr import PaddleOCR

        self._ocr = PaddleOCR(
            text_detection_model_name=self._det_model,
            text_recognition_model_name=self._rec_model,
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            device=self._device,
        )

    def unload(self) -> None:
        self._ocr = None

    def recognize(self, image: np.ndarray, lang: str = "ja") -> list[OCRResult]:
        if self._ocr is None:
            raise RuntimeError("エンジン未ロード。先に load() を呼んでください。")

        results: list[OCRResult] = []
        for page_result in self._ocr.predict(image):
            results.extend(self._parse_page_result(page_result))
        return results

    def recognize_batch(
        self, images: list[np.ndarray], lang: str = "ja",
    ) -> list[list[OCRResult]]:
        """複数画像をバッチ推論する.

        PaddleOCR の predict() にリストを渡すことで、
        GPU カーネル起動・メモリ転送のオーバーヘッドを削減する。
        """
        if self._ocr is None:
            raise RuntimeError("エンジン未ロード。先に load() を呼んでください。")
        if not images:
            return []

        batch_results: list[list[OCRResult]] = []
        for page_result in self._ocr.predict(images):
            batch_results.append(self._parse_page_result(page_result))
        return batch_results

    @staticmethod
    def _parse_page_result(page_result: dict) -> list[OCRResult]:
        """predict() の1ページ分の結果を OCRResult リストに変換する."""
        results: list[OCRResult] = []
        texts: list[str] = page_result["rec_texts"]
        scores: list[float] = page_result["rec_scores"]
        polys: list[np.ndarray] = page_result["dt_polys"]
        boxes: np.ndarray = page_result["rec_boxes"]

        for i, text in enumerate(texts):
            bbox = BoundingBox(
                x_min=int(boxes[i][0]),
                y_min=int(boxes[i][1]),
                x_max=int(boxes[i][2]),
                y_max=int(boxes[i][3]),
            )
            results.append(
                OCRResult(
                    text=text,
                    confidence=float(scores[i]),
                    bounding_box=bbox,
                    raw={"polygon": polys[i].tolist()},
                )
            )
        return results
