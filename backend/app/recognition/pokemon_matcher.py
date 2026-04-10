"""DINOv2 + FAISS によるポケモン画像識別.

選出画面のアイコンをクロップし、DINOv2 で embedding を抽出して
FAISS インデックスから最近傍検索でポケモンを判定する。

フロー:
    1. クロップ画像を DINOv2 ViT-S/14 に入力して embedding を抽出
    2. FAISS IndexFlatIP で cosine similarity 最近傍検索
    3. 閾値以上の最高スコアのポケモンを返す

事前準備:
    python -m tools.build_faiss_index  でインデックスを構築しておくこと。
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from pathlib import Path

import cv2
import faiss
import numpy as np
import torch
import torchvision.transforms as T

logger = logging.getLogger(__name__)

_DEFAULT_TEMPLATE_DIR = Path(__file__).parent.parent.parent.parent / "templates" / "pokemon"
_DEFAULT_THRESHOLD = 0.60
_DEFAULT_MODEL = "dinov2_vits14"


@dataclass(frozen=True, slots=True)
class MatchResult:
    """ポケモン識別結果."""

    pokemon_id: int
    confidence: float


@dataclass(frozen=True, slots=True)
class DetailedMatchResult:
    """詳細なポケモン識別結果（デバッグ用）."""

    candidates: list[MatchResult]
    threshold: float


class PokemonMatcher:
    """DINOv2 + FAISS でポケモンを識別する.

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
        model_name: str = _DEFAULT_MODEL,
        device: str | None = None,
    ) -> None:
        self._template_dir = Path(template_dir)
        self._threshold = threshold
        self._model_name = model_name
        self._device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self._model: torch.nn.Module | None = None
        self._transform: T.Compose | None = None
        self._index: faiss.IndexFlatIP | None = None
        self._pokemon_ids: np.ndarray | None = None
        self._loaded = False

    @property
    def template_dir(self) -> Path:
        """テンプレートディレクトリのパス."""
        return self._template_dir

    @property
    def template_count(self) -> int:
        """ロード済みテンプレート数 (FAISS インデックスのベクトル数)."""
        self._ensure_loaded()
        if self._index is None:
            return 0
        return self._index.ntotal

    def identify(self, icon_image: np.ndarray) -> MatchResult | None:
        """単一のクロップ画像からポケモンを識別する.

        Args:
            icon_image: BGR クロップ画像 (OpenCV 形式)。

        Returns:
            閾値以上の最高スコアの MatchResult、なければ None。
        """
        self._ensure_loaded()

        if self._index is None or self._index.ntotal == 0:
            logger.warning("FAISSインデックスが空です。build_faiss_index を実行してください")
            return None

        t0 = time.perf_counter()

        embedding = self._extract_embedding(icon_image)
        distances, indices = self._index.search(embedding, 1)

        confidence = float(distances[0, 0])
        idx = int(indices[0, 0])
        pokemon_id = int(self._pokemon_ids[idx])

        elapsed = (time.perf_counter() - t0) * 1000

        if confidence >= self._threshold:
            logger.debug(
                "識別成功: pokemon_id=%d confidence=%.3f (%.1fms)",
                pokemon_id,
                confidence,
                elapsed,
            )
            return MatchResult(pokemon_id=pokemon_id, confidence=confidence)

        logger.debug(
            "識別失敗: best_confidence=%.3f threshold=%.2f (%.1fms)",
            confidence,
            self._threshold,
            elapsed,
        )
        return None

    def identify_detailed(
        self,
        icon_image: np.ndarray,
        k: int = 5,
    ) -> DetailedMatchResult:
        """単一のクロップ画像からポケモンを識別し、Top-K候補を返す（デバッグ用）.

        Args:
            icon_image: BGR クロップ画像 (OpenCV 形式)。
            k: 返す候補数。

        Returns:
            Top-K候補と閾値を含む DetailedMatchResult。
        """
        self._ensure_loaded()

        if self._index is None or self._index.ntotal == 0:
            logger.warning("FAISSインデックスが空です。build_faiss_index を実行してください")
            return DetailedMatchResult(candidates=[], threshold=self._threshold)

        # インデックスのベクトル数より大きい k は使えない
        actual_k = min(k, self._index.ntotal)

        embedding = self._extract_embedding(icon_image)
        distances, indices = self._index.search(embedding, actual_k)

        candidates: list[MatchResult] = []
        for j in range(actual_k):
            idx = int(indices[0, j])
            if idx < 0:
                break
            candidates.append(
                MatchResult(
                    pokemon_id=int(self._pokemon_ids[idx]),
                    confidence=float(distances[0, j]),
                )
            )

        return DetailedMatchResult(candidates=candidates, threshold=self._threshold)

    def identify_team(
        self,
        frame: np.ndarray,
        positions: list[dict[str, int]],
        k: int = 5,
    ) -> list[DetailedMatchResult]:
        """フレームから複数のポケモンアイコンを一括識別する (バッチ処理).

        Args:
            frame: BGR フルフレーム画像。
            positions: クロップ座標のリスト。各要素は {"x", "y", "w", "h"} を持つ dict。
            k: 各位置で返す候補数。

        Returns:
            各位置に対応する DetailedMatchResult のリスト。
        """
        self._ensure_loaded()

        empty = DetailedMatchResult(candidates=[], threshold=self._threshold)

        if self._index is None or self._index.ntotal == 0:
            logger.warning("FAISSインデックスが空です。build_faiss_index を実行してください")
            return [empty] * len(positions)

        t0 = time.perf_counter()

        # クロップ画像を収集
        crops: list[np.ndarray] = []
        valid_indices: list[int] = []

        for i, pos in enumerate(positions):
            x, y, w, h = pos["x"], pos["y"], pos["w"], pos["h"]
            cropped = frame[y : y + h, x : x + w]

            if cropped.size == 0:
                logger.warning("クロップ領域が空です: %s", pos)
                continue

            crops.append(cropped)
            valid_indices.append(i)

        results: list[DetailedMatchResult] = [empty] * len(positions)

        if not crops:
            return results

        # バッチで embedding 抽出
        embeddings = self._extract_embeddings_batch(crops)

        # FAISS バッチ検索
        actual_k = min(k, self._index.ntotal)
        distances, indices = self._index.search(embeddings, actual_k)

        for j, orig_idx in enumerate(valid_indices):
            # 候補を構築（同一 pokemon_id は最高スコアのみ保持）
            seen: dict[int, float] = {}
            candidates: list[MatchResult] = []
            for col in range(actual_k):
                faiss_idx = int(indices[j, col])
                if faiss_idx < 0:
                    break
                confidence = float(distances[j, col])
                pokemon_id = int(self._pokemon_ids[faiss_idx])
                if pokemon_id in seen:
                    continue
                seen[pokemon_id] = confidence
                candidates.append(
                    MatchResult(pokemon_id=pokemon_id, confidence=confidence),
                )
            results[orig_idx] = DetailedMatchResult(
                candidates=candidates,
                threshold=self._threshold,
            )

        elapsed = (time.perf_counter() - t0) * 1000
        matched = sum(
            1
            for r in results
            if r.candidates and r.candidates[0].confidence >= self._threshold
        )
        logger.info(
            "チーム識別: %d/%d 成功 (%.1fms)",
            matched,
            len(positions),
            elapsed,
        )

        return results

    def reload(self) -> None:
        """FAISS インデックスとモデルを再読み込みする."""
        self._unload()
        self._ensure_loaded()

    def unload(self) -> None:
        """モデルとインデックスを解放する."""
        self._unload()

    def _unload(self) -> None:
        """内部リソースを解放する."""
        if self._model is not None:
            del self._model
            self._model = None
        self._index = None
        self._pokemon_ids = None
        self._transform = None
        self._loaded = False
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def _ensure_loaded(self) -> None:
        """DINOv2 モデルと FAISS インデックスを遅延ロードする."""
        if self._loaded:
            return

        self._loaded = True

        # DINOv2 モデルのロード
        t0 = time.perf_counter()
        try:
            self._model = torch.hub.load(
                "facebookresearch/dinov2", self._model_name
            )
            self._model = self._model.to(self._device).eval()
        except Exception:
            logger.exception("DINOv2 モデルのロードに失敗しました")
            return

        # 前処理パイプライン
        self._transform = T.Compose([
            T.ToPILImage(),
            T.Resize((224, 224)),
            T.ToTensor(),
            T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])

        model_elapsed = (time.perf_counter() - t0) * 1000
        logger.info("DINOv2 '%s' ロード完了 (%.0fms)", self._model_name, model_elapsed)

        # FAISS インデックスのロード
        index_path = self._template_dir / "faiss_index.bin"
        ids_path = self._template_dir / "faiss_ids.npy"

        if not index_path.exists() or not ids_path.exists():
            logger.warning(
                "FAISSインデックスが見つかりません: %s — "
                "python -m tools.build_faiss_index を実行してください",
                index_path,
            )
            return

        t0 = time.perf_counter()
        self._index = faiss.read_index(str(index_path))
        self._pokemon_ids = np.load(str(ids_path))

        index_elapsed = (time.perf_counter() - t0) * 1000
        logger.info(
            "FAISS インデックスロード完了: %d vectors (%.0fms)",
            self._index.ntotal,
            index_elapsed,
        )

    def _normalize_background(self, bgr_image: np.ndarray) -> np.ndarray:
        """ゲーム画面のクロップ背景を白に置換し、テンプレートとのドメインギャップを軽減する.

        四隅のピクセルから背景色を推定し、近い色のピクセルを白に置き換える。
        背景が既に白に近い場合（テンプレート画像など）はスキップする。
        """
        h, w = bgr_image.shape[:2]
        if h < 10 or w < 10:
            return bgr_image

        # 四隅から背景色をサンプリング
        m = max(2, min(h, w) // 8)
        corners = np.concatenate([
            bgr_image[:m, :m].reshape(-1, 3),
            bgr_image[:m, -m:].reshape(-1, 3),
            bgr_image[-m:, :m].reshape(-1, 3),
            bgr_image[-m:, -m:].reshape(-1, 3),
        ], axis=0).astype(np.float32)
        bg_color = np.median(corners, axis=0)

        # 背景色が既に白に近い場合はスキップ
        if np.all(bg_color > 200):
            return bgr_image

        # 各ピクセルと背景色のユークリッド距離でマスク生成
        diff = np.linalg.norm(
            bgr_image.astype(np.float32) - bg_color.reshape(1, 1, 3),
            axis=2,
        )
        bg_mask = (diff < 60).astype(np.uint8) * 255

        # モルフォロジー処理でマスクを整える
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        bg_mask = cv2.morphologyEx(bg_mask, cv2.MORPH_CLOSE, kernel)

        bg_ratio = np.count_nonzero(bg_mask) / bg_mask.size
        logger.debug(
            "背景正規化: bg_color=(%.0f,%.0f,%.0f) bg_ratio=%.1f%%",
            bg_color[0], bg_color[1], bg_color[2], bg_ratio * 100,
        )

        result = bgr_image.copy()
        result[bg_mask > 0] = [255, 255, 255]
        return result

    def _extract_embedding(self, bgr_image: np.ndarray) -> np.ndarray:
        """単一の BGR 画像から L2 正規化済み embedding を抽出する.

        Returns:
            shape (1, embed_dim) の float32 配列。
        """
        normalized = self._normalize_background(bgr_image)
        rgb = cv2.cvtColor(normalized, cv2.COLOR_BGR2RGB)
        tensor = self._transform(rgb).unsqueeze(0).to(self._device)

        with torch.no_grad():
            features = self._model(tensor)

        embedding = features.cpu().numpy().flatten()
        embedding = embedding / np.linalg.norm(embedding)
        return embedding.reshape(1, -1).astype(np.float32)

    def _extract_embeddings_batch(self, bgr_images: list[np.ndarray]) -> np.ndarray:
        """複数の BGR 画像からバッチで embedding を抽出する.

        Returns:
            shape (N, embed_dim) の float32 配列。
        """
        tensors = []
        for img in bgr_images:
            normalized = self._normalize_background(img)
            rgb = cv2.cvtColor(normalized, cv2.COLOR_BGR2RGB)
            tensors.append(self._transform(rgb))

        batch = torch.stack(tensors).to(self._device)

        with torch.no_grad():
            features = self._model(batch)

        embeddings = features.cpu().numpy()

        # L2 正規化 (行ごと)
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        norms = np.maximum(norms, 1e-12)
        embeddings = embeddings / norms

        return embeddings.astype(np.float32)
