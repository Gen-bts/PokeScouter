"""OCR エンジンのスモークテスト."""

from __future__ import annotations

import numpy as np
import pytest

from app.ocr.base import OCRResult


@pytest.mark.gpu
class TestPaddleOCREngine:
    def test_loads(self, paddle_engine) -> None:
        assert paddle_engine.is_loaded
        assert paddle_engine.engine_name == "paddle"

    def test_recognize_returns_results(self, paddle_engine, dummy_text_image) -> None:
        results = paddle_engine.recognize(dummy_text_image)
        assert isinstance(results, list)
        assert len(results) > 0
        assert all(isinstance(r, OCRResult) for r in results)

    def test_recognize_detects_digits(self, paddle_engine, dummy_text_image) -> None:
        results = paddle_engine.recognize(dummy_text_image)
        all_text = " ".join(r.text for r in results)
        assert "12345" in all_text

    def test_confidence_in_range(self, paddle_engine, dummy_text_image) -> None:
        results = paddle_engine.recognize(dummy_text_image)
        for r in results:
            assert 0.0 <= r.confidence <= 1.0

    def test_bounding_box_present(self, paddle_engine, dummy_text_image) -> None:
        results = paddle_engine.recognize(dummy_text_image)
        for r in results:
            assert r.bounding_box is not None
            assert r.bounding_box.width > 0
            assert r.bounding_box.height > 0


@pytest.mark.gpu
class TestMangaOCREngine:
    def test_loads(self, manga_engine) -> None:
        assert manga_engine.is_loaded
        assert manga_engine.engine_name == "manga"

    def test_recognize_returns_results(self, manga_engine, dummy_text_image) -> None:
        results = manga_engine.recognize(dummy_text_image)
        assert isinstance(results, list)
        assert len(results) == 1
        assert isinstance(results[0], OCRResult)

    def test_recognize_returns_text(self, manga_engine, dummy_text_image) -> None:
        results = manga_engine.recognize(dummy_text_image)
        assert len(results[0].text) > 0


@pytest.mark.gpu
class TestGLMOCREngine:
    def test_loads(self, glm_engine) -> None:
        assert glm_engine.is_loaded
        assert glm_engine.engine_name == "glm"

    def test_recognize_returns_results(self, glm_engine, dummy_text_image) -> None:
        results = glm_engine.recognize(dummy_text_image)
        assert isinstance(results, list)
        assert all(isinstance(r, OCRResult) for r in results)

    def test_recognize_returns_text(self, glm_engine, dummy_text_image) -> None:
        results = glm_engine.recognize(dummy_text_image)
        all_text = " ".join(r.text for r in results)
        assert len(all_text) > 0
