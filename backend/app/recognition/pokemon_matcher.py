"""pHash + テンプレートマッチングによるポケモン画像識別.

選出画面のアイコンをクロップし、テンプレート画像群と照合して
どのポケモンかを判定する。

フロー:
    1. クロップ画像の pHash を計算
    2. 全テンプレートの pHash とのハミング距離で上位 top_k 件に絞り込み
    3. 候補のみ cv2.matchTemplate(TM_CCOEFF_NORMED) で精密マッチ
    4. 閾値以上の最高スコアのポケモンを返す
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from pathlib import Path

import cv2
import imagehash
import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

_DEFAULT_TEMPLATE_DIR = Path(__file__).parent.parent.parent / "templates" / "pokemon"
_DEFAULT_THRESHOLD = 0.80
_DEFAULT_TOP_K = 10


@dataclass(frozen=True, slots=True)
class MatchResult:
    """ポケモン識別結果."""

    pokemon_id: int
    confidence: float


@dataclass(frozen=True, slots=True)
class _TemplateEntry:
    """テンプレート画像のキャッシュエントリ."""

    pokemon_id: int
    image: np.ndarray
    phash: imagehash.ImageHash


class PokemonMatcher:
    """pHash 前段フィルタ + テンプレートマッチングでポケモンを識別する.

    使い方::

        matcher = PokemonMatcher("templates/pokemon")
        result = matcher.identify(cropped_icon)
        # MatchResult(pokemon_id=25, confidence=0.95)

        results = matcher.identify_team(frame, [
            {"x": 100, "y": 200, "w": 80, "h": 80},
            ...
        ])
    """

    def __init__(
        self,
        template_dir: str | Path = _DEFAULT_TEMPLATE_DIR,
        threshold: float = _DEFAULT_THRESHOLD,
        top_k: int = _DEFAULT_TOP_K,
    ) -> None:
        self._template_dir = Path(template_dir)
        self._threshold = threshold
        self._top_k = top_k
        self._templates: list[_TemplateEntry] = []
        self._loaded = False

    @property
    def template_count(self) -> int:
        """ロード済みテンプレート数."""
        self._ensure_loaded()
        return len(self._templates)

    def identify(self, icon_image: np.ndarray) -> MatchResult | None:
        """単一のクロップ画像からポケモンを識別する.

        Args:
            icon_image: BGR クロップ画像 (OpenCV 形式)。

        Returns:
            閾値以上の最高スコアの MatchResult、なければ None。
        """
        self._ensure_loaded()

        if not self._templates:
            logger.warning("テンプレートが0件です。templates/pokemon/ を確認してください")
            return None

        t0 = time.perf_counter()

        # 1. pHash で候補を絞り込み
        query_hash = self._compute_phash(icon_image)
        candidates = self._filter_by_phash(query_hash, self._top_k)

        # 2. テンプレートマッチングで精密比較
        best_result: MatchResult | None = None
        best_confidence = 0.0

        # クロップ画像をテンプレートサイズにリサイズ
        for entry in candidates:
            th, tw = entry.image.shape[:2]
            resized = cv2.resize(icon_image, (tw, th), interpolation=cv2.INTER_AREA)
            confidence = self._match_template(resized, entry.image)

            if confidence > best_confidence:
                best_confidence = confidence
                best_result = MatchResult(
                    pokemon_id=entry.pokemon_id,
                    confidence=confidence,
                )

        elapsed = (time.perf_counter() - t0) * 1000

        if best_result and best_result.confidence >= self._threshold:
            logger.debug(
                "識別成功: pokemon_id=%d confidence=%.3f (%.1fms)",
                best_result.pokemon_id,
                best_result.confidence,
                elapsed,
            )
            return best_result

        logger.debug(
            "識別失敗: best_confidence=%.3f threshold=%.2f (%.1fms)",
            best_confidence,
            self._threshold,
            elapsed,
        )
        return None

    def identify_team(
        self,
        frame: np.ndarray,
        positions: list[dict[str, int]],
    ) -> list[MatchResult | None]:
        """フレームから複数のポケモンアイコンを一括識別する.

        Args:
            frame: BGR フルフレーム画像。
            positions: クロップ座標のリスト。各要素は {"x", "y", "w", "h"} を持つ dict。

        Returns:
            各位置に対応する MatchResult のリスト (識別失敗は None)。
        """
        results: list[MatchResult | None] = []

        for pos in positions:
            x, y, w, h = pos["x"], pos["y"], pos["w"], pos["h"]
            cropped = frame[y : y + h, x : x + w]

            if cropped.size == 0:
                logger.warning("クロップ領域が空です: %s", pos)
                results.append(None)
                continue

            results.append(self.identify(cropped))

        return results

    def reload(self) -> None:
        """テンプレート画像を再読み込みする."""
        self._templates.clear()
        self._loaded = False
        self._ensure_loaded()

    def _ensure_loaded(self) -> None:
        """テンプレート画像を遅延ロードする."""
        if self._loaded:
            return

        self._loaded = True

        if not self._template_dir.exists():
            logger.warning(
                "テンプレートディレクトリが存在しません: %s",
                self._template_dir,
            )
            return

        png_files = sorted(self._template_dir.glob("*.png"))
        if not png_files:
            logger.warning(
                "テンプレート画像が見つかりません: %s",
                self._template_dir,
            )
            return

        t0 = time.perf_counter()

        for png_path in png_files:
            try:
                pokemon_id = int(png_path.stem)
            except ValueError:
                logger.debug("ファイル名が数値ではないためスキップ: %s", png_path.name)
                continue

            img = cv2.imread(str(png_path), cv2.IMREAD_UNCHANGED)
            if img is None:
                logger.warning("画像読み込み失敗: %s", png_path)
                continue

            # RGBA → BGR 変換 (アルファチャンネルがある場合は白背景に合成)
            if img.shape[2] == 4:
                img = self._alpha_to_bgr(img)

            phash = self._compute_phash(img)

            self._templates.append(
                _TemplateEntry(
                    pokemon_id=pokemon_id,
                    image=img,
                    phash=phash,
                )
            )

        elapsed = (time.perf_counter() - t0) * 1000
        logger.info(
            "テンプレート %d 件をロード (%.0fms): %s",
            len(self._templates),
            elapsed,
            self._template_dir,
        )

    def _filter_by_phash(
        self, query_hash: imagehash.ImageHash, top_k: int
    ) -> list[_TemplateEntry]:
        """pHash のハミング距離で上位 top_k 件を返す."""
        distances: list[tuple[int, _TemplateEntry]] = []
        for entry in self._templates:
            dist = query_hash - entry.phash
            distances.append((dist, entry))

        distances.sort(key=lambda x: x[0])
        return [entry for _, entry in distances[:top_k]]

    @staticmethod
    def _compute_phash(image: np.ndarray) -> imagehash.ImageHash:
        """OpenCV BGR 画像から pHash を計算する."""
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        pil_image = Image.fromarray(rgb)
        return imagehash.phash(pil_image)

    @staticmethod
    def _match_template(image: np.ndarray, template: np.ndarray) -> float:
        """テンプレートマッチングの最大信頼度を返す."""
        result = cv2.matchTemplate(image, template, cv2.TM_CCOEFF_NORMED)
        _, max_val, _, _ = cv2.minMaxLoc(result)
        return float(max_val)

    @staticmethod
    def _alpha_to_bgr(img: np.ndarray) -> np.ndarray:
        """BGRA 画像を白背景の BGR に変換する."""
        alpha = img[:, :, 3:4] / 255.0
        bgr = img[:, :, :3]
        white = np.full_like(bgr, 255)
        composited = (bgr * alpha + white * (1 - alpha)).astype(np.uint8)
        return composited
