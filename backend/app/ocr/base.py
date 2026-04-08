"""OCR エンジン抽象基底クラスと共通データ型."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np


@dataclass(frozen=True, slots=True)
class BoundingBox:
    """軸平行バウンディングボックス（ピクセル座標）."""

    x_min: int
    y_min: int
    x_max: int
    y_max: int

    @property
    def width(self) -> int:
        return self.x_max - self.x_min

    @property
    def height(self) -> int:
        return self.y_max - self.y_min


@dataclass(frozen=True, slots=True)
class OCRResult:
    """単一テキスト領域の認識結果."""

    text: str
    confidence: float  # 0.0–1.0
    bounding_box: BoundingBox | None = None
    raw: dict[str, Any] = field(default_factory=dict)


class OCREngine(ABC):
    """全 OCR エンジンの抽象基底クラス.

    設計方針:
    - load()/unload() を __init__ と分離し、遅延ロードを可能にする
    - recognize() は BGR numpy 配列（OpenCV 形式）を受け取る
    """

    @property
    @abstractmethod
    def engine_name(self) -> str:
        """エンジン識別名（例: "paddle", "manga", "glm"）."""
        ...

    @property
    @abstractmethod
    def is_loaded(self) -> bool:
        """モデルがロード済みかどうか."""
        ...

    @abstractmethod
    def load(self) -> None:
        """モデルを VRAM にロードする."""
        ...

    @abstractmethod
    def unload(self) -> None:
        """モデルを VRAM から解放する."""
        ...

    @abstractmethod
    def recognize(self, image: np.ndarray, lang: str = "ja") -> list[OCRResult]:
        """BGR numpy 配列に対して OCR を実行する.

        Args:
            image: BGR 形式の numpy 配列（OpenCV 標準）
            lang: 認識言語（デフォルト: 日本語）

        Returns:
            認識結果のリスト（上→下、左→右の順）
        """
        ...

    def recognize_from_file(self, path: str | Path, lang: str = "ja") -> list[OCRResult]:
        """ファイルパスから画像を読み込んで OCR を実行する."""
        import cv2

        img = cv2.imread(str(path))
        if img is None:
            raise FileNotFoundError(f"画像を読み込めません: {path}")
        return self.recognize(img, lang=lang)
