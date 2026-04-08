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
