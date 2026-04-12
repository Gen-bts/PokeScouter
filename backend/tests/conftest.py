"""pytest 共通フィクスチャ."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest


def _skip_missing_dependency(exc: ModuleNotFoundError) -> None:
    missing = exc.name or "optional dependency"
    pytest.skip(f"{missing} is not installed in this environment", allow_module_level=False)


@pytest.fixture(scope="session")
def fixtures_dir() -> Path:
    return Path(__file__).parent / "fixtures"


@pytest.fixture(scope="session")
def sample_images_dir(fixtures_dir: Path) -> Path:
    return fixtures_dir / "images"


@pytest.fixture(scope="session")
def dummy_text_image() -> np.ndarray:
    """テスト用のダミーテキスト画像（BGR, 数字 "12345"）."""
    import cv2

    img = np.ones((100, 300, 3), dtype=np.uint8) * 255
    cv2.putText(img, "12345", (50, 70), cv2.FONT_HERSHEY_SIMPLEX, 2.0, (0, 0, 0), 3)
    return img


@pytest.fixture(scope="session")
def paddle_engine():
    """PaddleOCR エンジン（セッション全体で1回だけロード）."""
    try:
        from app.ocr.paddle_ocr import PaddleOCREngine
    except ModuleNotFoundError as exc:
        _skip_missing_dependency(exc)

    engine = PaddleOCREngine()
    try:
        engine.load()
    except ModuleNotFoundError as exc:
        _skip_missing_dependency(exc)
    yield engine
    engine.unload()


@pytest.fixture(scope="session")
def manga_engine():
    """manga-ocr エンジン（セッション全体で1回だけロード）."""
    try:
        from app.ocr.manga_ocr import MangaOCREngine
    except ModuleNotFoundError as exc:
        _skip_missing_dependency(exc)

    engine = MangaOCREngine()
    try:
        engine.load()
    except ModuleNotFoundError as exc:
        _skip_missing_dependency(exc)
    yield engine
    engine.unload()


@pytest.fixture(scope="session")
def glm_engine():
    """GLM-OCR エンジン（セッション全体で1回だけロード）."""
    try:
        from app.ocr.glm_ocr import GLMOCREngine
    except ModuleNotFoundError as exc:
        _skip_missing_dependency(exc)

    engine = GLMOCREngine()
    try:
        engine.load()
    except ModuleNotFoundError as exc:
        _skip_missing_dependency(exc)
    yield engine
    engine.unload()
