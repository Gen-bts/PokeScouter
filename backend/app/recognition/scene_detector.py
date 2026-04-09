"""テンプレートマッチング / OCR によるシーン検出.

各シーンの detection 領域をクロップし、テンプレート画像との照合
または OCR テキストの一致判定で、現在のシーンを判定する。
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

import cv2
import numpy as np

from app.ocr.region import DetectionRegion, RegionConfig

if TYPE_CHECKING:
    from app.ocr.region import RegionRecognizer

logger = logging.getLogger(__name__)

_DEFAULT_TEMPLATE_DIR = Path(__file__).parent.parent.parent / "templates"
_DEFAULT_THRESHOLD = 0.80
_DEFAULT_OCR_THRESHOLD = 0.5


@dataclass(frozen=True, slots=True)
class DetectionResult:
    """個別のシーン検出結果."""

    scene: str
    matched: bool
    confidence: float
    region_name: str
    elapsed_ms: float


class SceneDetector:
    """テンプレートマッチングでシーンを検出する.

    RegionConfig の detection 定義に従い、フレームの指定領域を
    クロップしてテンプレート画像と照合する。

    使い方::

        detector = SceneDetector(region_config)
        detections = detector.detect(frame, ["team_select", "team_confirm"])
        # detections = {"team_select": 0.95}  # 閾値超えのもののみ
    """

    def __init__(
        self,
        region_config: RegionConfig,
        template_dir: str | Path = _DEFAULT_TEMPLATE_DIR,
        recognizer: RegionRecognizer | None = None,
    ) -> None:
        self._config = region_config
        self._template_dir = Path(template_dir)
        self._template_cache: dict[str, np.ndarray] = {}
        self._recognizer = recognizer

    def detect(
        self, frame: np.ndarray, candidates: list[str]
    ) -> dict[str, float]:
        """候補シーンのテンプレートマッチングを実行する.

        Args:
            frame: BGR フルフレーム画像。
            candidates: 検出を試みるシーン名のリスト。

        Returns:
            閾値を超えたシーンとその信頼度。{scene_key: confidence}
        """
        results: dict[str, float] = {}

        for scene in candidates:
            detection_regions = self._config.get_detection_regions(scene)
            if not detection_regions:
                continue

            for region in detection_regions:
                cropped = region.crop(frame)

                if region.method == "template":
                    confidence, threshold, elapsed = self._detect_template(
                        cropped, region, scene,
                    )
                elif region.method == "ocr":
                    confidence, threshold, elapsed = self._detect_ocr(
                        cropped, region,
                    )
                else:
                    logger.warning(
                        "未知の検出方法 '%s' (シーン '%s', 領域 '%s')",
                        region.method, scene, region.name,
                    )
                    continue

                logger.debug(
                    "検出: scene=%s region=%s method=%s confidence=%.3f threshold=%.2f (%.1fms)",
                    scene,
                    region.name,
                    region.method,
                    confidence,
                    threshold,
                    elapsed,
                )

                if confidence >= threshold:
                    # 同一シーンに複数の検出領域がある場合は最高値を採用
                    results[scene] = max(results.get(scene, 0.0), confidence)

        return results

    def detect_detailed(
        self, frame: np.ndarray, candidates: list[str]
    ) -> list[DetectionResult]:
        """候補シーンの検出結果を詳細に返す（デバッグ用）.

        Args:
            frame: BGR フルフレーム画像。
            candidates: 検出を試みるシーン名のリスト。

        Returns:
            全検出領域の結果リスト。
        """
        results: list[DetectionResult] = []

        for scene in candidates:
            detection_regions = self._config.get_detection_regions(scene)
            for region in detection_regions:
                cropped = region.crop(frame)

                if region.method == "template":
                    confidence, threshold, elapsed = self._detect_template(
                        cropped, region, scene,
                    )
                elif region.method == "ocr":
                    confidence, threshold, elapsed = self._detect_ocr(
                        cropped, region,
                    )
                else:
                    continue

                results.append(DetectionResult(
                    scene=scene,
                    matched=confidence >= threshold,
                    confidence=confidence,
                    region_name=region.name,
                    elapsed_ms=elapsed,
                ))

        return results

    def clear_cache(self) -> None:
        """テンプレート画像キャッシュをクリアする."""
        self._template_cache.clear()

    def _detect_template(
        self,
        cropped: np.ndarray,
        region: DetectionRegion,
        scene: str,
    ) -> tuple[float, float, float]:
        """テンプレートマッチングで検出し (confidence, threshold, elapsed_ms) を返す."""
        template_path = region.params.get("template")
        if not template_path:
            logger.warning(
                "検出領域 '%s' (シーン '%s') に template パスが未定義",
                region.name,
                scene,
            )
            return 0.0, _DEFAULT_THRESHOLD, 0.0

        template = self._load_template(template_path)
        if template is None:
            return 0.0, _DEFAULT_THRESHOLD, 0.0

        t0 = time.perf_counter()
        confidence = self._match_template(cropped, template)
        elapsed = (time.perf_counter() - t0) * 1000
        threshold = region.params.get("threshold", _DEFAULT_THRESHOLD)
        return confidence, threshold, elapsed

    def _detect_ocr(
        self,
        cropped: np.ndarray,
        region: DetectionRegion,
    ) -> tuple[float, float, float]:
        """OCRテキスト一致で検出し (confidence, threshold, elapsed_ms) を返す.

        expected_text に指定された文字列のいずれかが OCR 結果に含まれていれば
        confidence=1.0 を返す（OR 条件）。
        excluded_text に指定された文字列のいずれかが含まれていれば
        confidence=0.0 を返す（AND-NOT 条件）。
        expected_text 未指定で excluded_text のみの場合、除外テキストが
        含まれなければ confidence=1.0 を返す（純粋な否定条件）。
        """
        if self._recognizer is None:
            logger.warning(
                "OCR 検出が要求されましたが recognizer が未設定です (領域 '%s')",
                region.name,
            )
            return 0.0, _DEFAULT_OCR_THRESHOLD, 0.0

        raw_expected = region.params.get("expected_text", [])
        if isinstance(raw_expected, str):
            expected_texts = [raw_expected]
        else:
            expected_texts = list(raw_expected)

        raw_excluded = region.params.get("excluded_text", [])
        if isinstance(raw_excluded, str):
            excluded_texts = [raw_excluded]
        else:
            excluded_texts = list(raw_excluded)

        if not expected_texts and not excluded_texts:
            logger.warning(
                "検出領域 '%s' に expected_text/excluded_text が未定義",
                region.name,
            )
            return 0.0, _DEFAULT_OCR_THRESHOLD, 0.0

        engine_name = region.params.get("engine", "paddle")
        pipeline = self._recognizer._get_pipeline(engine_name)

        t0 = time.perf_counter()
        ocr_results = pipeline.run(cropped)
        elapsed = (time.perf_counter() - t0) * 1000

        ocr_text = "".join(r.text for r in ocr_results)
        has_expected = (
            any(exp in ocr_text for exp in expected_texts)
            if expected_texts
            else True
        )
        has_excluded = (
            any(exc in ocr_text for exc in excluded_texts)
            if excluded_texts
            else False
        )
        matched = has_expected and not has_excluded

        logger.debug(
            "OCR検出: region=%s ocr_text='%s' expected=%s excluded=%s matched=%s (%.1fms)",
            region.name, ocr_text, expected_texts, excluded_texts, matched, elapsed,
        )

        confidence = 1.0 if matched else 0.0
        threshold = region.params.get("threshold", _DEFAULT_OCR_THRESHOLD)
        return confidence, threshold, elapsed

    def _match_template(
        self, image: np.ndarray, template: np.ndarray
    ) -> float:
        """テンプレートマッチングの最大信頼度を返す.

        テンプレートが画像より大きい場合は 0.0 を返す。
        """
        ih, iw = image.shape[:2]
        th, tw = template.shape[:2]

        if th > ih or tw > iw:
            logger.debug(
                "テンプレートが画像より大きい: image=(%d,%d) template=(%d,%d)",
                iw, ih, tw, th,
            )
            return 0.0

        result = cv2.matchTemplate(image, template, cv2.TM_CCOEFF_NORMED)
        _, max_val, _, _ = cv2.minMaxLoc(result)
        return float(max_val)

    def _load_template(self, path: str) -> np.ndarray | None:
        """テンプレート画像をロードする（キャッシュ付き）."""
        if path in self._template_cache:
            return self._template_cache[path]

        full_path = self._template_dir / path
        if not full_path.exists():
            logger.warning("テンプレート画像が見つかりません: %s", full_path)
            return None

        img = cv2.imread(str(full_path))
        if img is None:
            logger.warning("テンプレート画像の読み込みに失敗: %s", full_path)
            return None

        self._template_cache[path] = img
        logger.info("テンプレート画像をロード: %s", full_path)
        return img
