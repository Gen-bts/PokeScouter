from app.ocr.base import BoundingBox, OCREngine, OCRResult
from app.ocr.pipeline import OCRPipeline

__all__ = [
    "BoundingBox",
    "OCREngine",
    "OCRResult",
    "OCRPipeline",
    "PaddleOCREngine",
    "MangaOCREngine",
    "GLMOCREngine",
]


def __getattr__(name: str):
    """エンジンクラスは遅延 import する（GPU 依存パッケージの即時ロードを避ける）."""
    if name == "PaddleOCREngine":
        from app.ocr.paddle_ocr import PaddleOCREngine
        return PaddleOCREngine
    if name == "MangaOCREngine":
        from app.ocr.manga_ocr import MangaOCREngine
        return MangaOCREngine
    if name == "GLMOCREngine":
        from app.ocr.glm_ocr import GLMOCREngine
        return GLMOCREngine
    raise AttributeError(f"module 'app.ocr' has no attribute {name!r}")
