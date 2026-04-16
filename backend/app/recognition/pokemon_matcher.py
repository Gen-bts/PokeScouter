"""Pokemon icon matcher backed by DINOv2 + FAISS."""

from __future__ import annotations

import json
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
_DEFAULT_MARGIN_THRESHOLD = 0.03
_DEFAULT_MODEL = "dinov2_vits14"
_POKEMON_SNAPSHOT_PATH = (
    Path(__file__).parent.parent.parent.parent
    / "data"
    / "showdown"
    / "champions-bss-reg-ma"
    / "pokemon.json"
)


@dataclass(frozen=True, slots=True)
class MatchResult:
    pokemon_key: str
    confidence: float


@dataclass(frozen=True, slots=True)
class DetailedMatchResult:
    candidates: list[MatchResult]
    threshold: float
    margin_threshold: float = _DEFAULT_MARGIN_THRESHOLD

    @property
    def margin(self) -> float | None:
        """top-1 と top-2 のスコア差。候補が2件未満なら None。"""
        if len(self.candidates) < 2:
            return None
        return self.candidates[0].confidence - self.candidates[1].confidence

    @property
    def is_uncertain(self) -> bool:
        """margin が閾値未満で判別が不確定かどうか。"""
        m = self.margin
        if m is None:
            return False
        return m < self.margin_threshold


class PokemonMatcher:
    def __init__(
        self,
        template_dir: str | Path = _DEFAULT_TEMPLATE_DIR,
        threshold: float = _DEFAULT_THRESHOLD,
        margin_threshold: float = _DEFAULT_MARGIN_THRESHOLD,
        model_name: str = _DEFAULT_MODEL,
        device: str | None = None,
    ) -> None:
        self._template_dir = Path(template_dir)
        self._threshold = threshold
        self._margin_threshold = margin_threshold
        self._model_name = model_name
        self._device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self._model: torch.nn.Module | None = None
        self._transform: T.Compose | None = None
        self._index: faiss.IndexFlatIP | None = None
        self._pokemon_keys: list[str] | None = None
        self._full_index: faiss.IndexFlatIP | None = None
        self._full_pokemon_keys: list[str] | None = None
        self._legal_pokemon_keys: set[str] | None = None
        self._manifest: dict[str, str] = {}
        self._sprite_fallbacks: dict[str, str] = {}
        self._loaded = False

    @property
    def template_dir(self) -> Path:
        return self._template_dir

    @property
    def template_count(self) -> int:
        self._ensure_loaded()
        if self._index is None:
            return 0
        return self._index.ntotal

    def resolve_template_path(self, pokemon_key: str) -> Path:
        filename = (
            self._manifest.get(pokemon_key)
            or self._sprite_fallbacks.get(pokemon_key)
            or f"{pokemon_key}.png"
        )
        return self._template_dir / filename

    def identify(self, icon_image: np.ndarray) -> MatchResult | None:
        detailed = self.identify_detailed(icon_image, k=2)
        if not detailed.candidates:
            return None
        best = detailed.candidates[0]
        if best.confidence < self._threshold:
            return None
        if detailed.is_uncertain:
            logger.info(
                "margin too small but accepting top-1: %s(%.3f) vs %s(%.3f), margin=%.4f < %.4f",
                best.pokemon_key, best.confidence,
                detailed.candidates[1].pokemon_key, detailed.candidates[1].confidence,
                detailed.margin, self._margin_threshold,
            )
        return best

    def identify_detailed(
        self,
        icon_image: np.ndarray,
        k: int = 5,
    ) -> DetailedMatchResult:
        self._ensure_loaded()
        if self._index is None or self._pokemon_keys is None or self._index.ntotal == 0:
            return DetailedMatchResult(candidates=[], threshold=self._threshold)

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
                    pokemon_key=self._pokemon_keys[idx],
                    confidence=float(distances[0, j]),
                ),
            )
        return DetailedMatchResult(
            candidates=candidates,
            threshold=self._threshold,
            margin_threshold=self._margin_threshold,
        )

    def identify_team(
        self,
        frame: np.ndarray,
        positions: list[dict[str, int]],
        k: int = 5,
    ) -> list[DetailedMatchResult]:
        self._ensure_loaded()

        if self._index is None or self._pokemon_keys is None or self._index.ntotal == 0:
            return [empty] * len(positions)

        crops: list[np.ndarray] = []
        valid_indices: list[int] = []
        for i, pos in enumerate(positions):
            x, y, w, h = pos["x"], pos["y"], pos["w"], pos["h"]
            cropped = frame[y : y + h, x : x + w]
            if cropped.size == 0:
                logger.warning("empty icon crop: %s", pos)
                continue
            crops.append(cropped)
            valid_indices.append(i)

        empty = DetailedMatchResult(
            candidates=[],
            threshold=self._threshold,
            margin_threshold=self._margin_threshold,
        )
        results: list[DetailedMatchResult] = [empty] * len(positions)
        if not crops:
            return results

        embeddings = self._extract_embeddings_batch(crops)
        actual_k = min(k, self._index.ntotal)
        distances, indices = self._index.search(embeddings, actual_k)

        for j, orig_idx in enumerate(valid_indices):
            seen: set[str] = set()
            candidates: list[MatchResult] = []
            for col in range(actual_k):
                faiss_idx = int(indices[j, col])
                if faiss_idx < 0:
                    break
                pokemon_key = self._pokemon_keys[faiss_idx]
                if pokemon_key in seen:
                    continue
                seen.add(pokemon_key)
                candidates.append(
                    MatchResult(
                        pokemon_key=pokemon_key,
                        confidence=float(distances[j, col]),
                    ),
                )
            results[orig_idx] = DetailedMatchResult(
                candidates=candidates,
                threshold=self._threshold,
                margin_threshold=self._margin_threshold,
            )
        return results

    def reload(self) -> None:
        self._unload()
        self._ensure_loaded()

    def unload(self) -> None:
        self._unload()

    def set_legal_pokemon(self, keys: list[str]) -> None:
        new_set = set(keys) if keys else None
        if new_set == self._legal_pokemon_keys:
            return
        self._legal_pokemon_keys = new_set
        logger.info("set_legal_pokemon: %d keys provided", len(new_set) if new_set else 0)
        if self._loaded and self._full_index is not None:
            self._rebuild_filtered_index()

    def _rebuild_filtered_index(self) -> None:
        if self._full_index is None or self._full_pokemon_keys is None:
            return

        if self._legal_pokemon_keys is None or len(self._legal_pokemon_keys) == 0:
            self._index = self._full_index
            self._pokemon_keys = list(self._full_pokemon_keys)
            logger.info("FAISS legal filter: disabled (using full index, %d vectors)", self._full_index.ntotal)
            return

        mask = np.array(
            [key in self._legal_pokemon_keys for key in self._full_pokemon_keys],
            dtype=bool,
        )
        filtered_keys = [
            key for key, include in zip(self._full_pokemon_keys, mask, strict=False) if include
        ]
        if not filtered_keys:
            logger.warning("legal pool filter produced an empty matcher index; using full index")
            self._index = self._full_index
            self._pokemon_keys = list(self._full_pokemon_keys)
            return

        n_total = self._full_index.ntotal
        d = self._full_index.d
        all_vectors = faiss.rev_swig_ptr(
            self._full_index.get_xb(), n_total * d,
        ).reshape(n_total, d).copy()
        filtered_vectors = all_vectors[mask]

        sub_index = faiss.IndexFlatIP(d)
        sub_index.add(filtered_vectors)
        self._index = sub_index
        self._pokemon_keys = filtered_keys
        removed = n_total - len(filtered_keys)
        logger.info(
            "FAISS legal filter: %d → %d vectors (%d removed)",
            n_total, len(filtered_keys), removed,
        )

    def _unload(self) -> None:
        if self._model is not None:
            del self._model
            self._model = None
        self._index = None
        self._pokemon_keys = None
        self._full_index = None
        self._full_pokemon_keys = None
        self._legal_pokemon_keys = None
        self._transform = None
        self._loaded = False
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def _ensure_loaded(self) -> None:
        if self._loaded:
            return
        self._loaded = True

        self._load_manifest()

        try:
            self._model = torch.hub.load("facebookresearch/dinov2", self._model_name)
            self._model = self._model.to(self._device).eval()
        except Exception:
            logger.exception("failed to load DINOv2 model")
            return

        self._transform = T.Compose([
            T.ToPILImage(),
            T.Resize((224, 224)),
            T.ToTensor(),
            T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])

        index_path = self._template_dir / "faiss_index.bin"
        manifest_path = self._template_dir / "faiss_manifest.json"
        ids_path = self._template_dir / "faiss_ids.npy"
        if not index_path.exists():
            logger.warning("missing FAISS index: %s", index_path)
            return

        self._full_index = faiss.read_index(str(index_path))
        if manifest_path.exists():
            self._full_pokemon_keys = list(json.loads(manifest_path.read_text(encoding="utf-8")))
        elif ids_path.exists():
            ids = np.load(str(ids_path))
            reverse_manifest = {
                Path(filename).stem: key for key, filename in self._manifest.items()
            }
            self._full_pokemon_keys = [
                reverse_manifest.get(str(int(identifier)), str(int(identifier)))
                for identifier in ids
            ]
        else:
            logger.warning("missing FAISS manifest and legacy id mapping")
            return

        self._index = self._full_index
        self._pokemon_keys = list(self._full_pokemon_keys)
        if self._legal_pokemon_keys is not None:
            self._rebuild_filtered_index()

    def _load_manifest(self) -> None:
        manifest_path = self._template_dir / "manifest.json"
        if manifest_path.exists():
            payload = json.loads(manifest_path.read_text(encoding="utf-8"))
            if isinstance(payload, dict) and isinstance(payload.get("sprites"), dict):
                self._manifest = payload["sprites"]
            elif isinstance(payload, dict):
                self._manifest = payload
            else:
                self._manifest = {}
        else:
            self._manifest = {}
        self._load_sprite_fallbacks()

    def _load_sprite_fallbacks(self) -> None:
        self._sprite_fallbacks = {}
        if not _POKEMON_SNAPSHOT_PATH.exists():
            return

        payload = json.loads(_POKEMON_SNAPSHOT_PATH.read_text(encoding="utf-8"))
        for pokemon_key, pdata in payload.items():
            if not isinstance(pdata, dict):
                continue

            candidates: list[str] = []
            num = pdata.get("num")
            if isinstance(num, int):
                candidates.append(f"{num}.png")

            sprite_id = pdata.get("sprite_id")
            if isinstance(sprite_id, str) and sprite_id:
                candidates.append(f"{sprite_id}.png")

            base_species_key = pdata.get("base_species_key")
            if isinstance(base_species_key, str):
                mapped = self._manifest.get(base_species_key)
                if mapped:
                    candidates.append(mapped)

            for candidate in candidates:
                if (self._template_dir / candidate).exists():
                    self._sprite_fallbacks[pokemon_key] = candidate
                    break

    def _normalize_background(self, bgr_image: np.ndarray) -> np.ndarray:
        h, w = bgr_image.shape[:2]
        if h < 10 or w < 10:
            return bgr_image

        m = max(2, min(h, w) // 8)
        corners = np.concatenate([
            bgr_image[:m, :m].reshape(-1, 3),
            bgr_image[:m, -m:].reshape(-1, 3),
            bgr_image[-m:, :m].reshape(-1, 3),
            bgr_image[-m:, -m:].reshape(-1, 3),
        ], axis=0).astype(np.float32)
        bg_color = np.median(corners, axis=0)
        if np.all(bg_color > 200):
            return bgr_image

        diff = np.linalg.norm(
            bgr_image.astype(np.float32) - bg_color.reshape(1, 1, 3),
            axis=2,
        )
        bg_mask = (diff < 60).astype(np.uint8) * 255
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        bg_mask = cv2.morphologyEx(bg_mask, cv2.MORPH_CLOSE, kernel)

        result = bgr_image.copy()
        result[bg_mask > 0] = [255, 255, 255]
        return result

    def _extract_embedding(self, bgr_image: np.ndarray) -> np.ndarray:
        normalized = self._normalize_background(bgr_image)
        rgb = cv2.cvtColor(normalized, cv2.COLOR_BGR2RGB)
        tensor = self._transform(rgb).unsqueeze(0).to(self._device)
        with torch.no_grad():
            features = self._model(tensor)
        embedding = features.cpu().numpy().flatten()
        embedding = embedding / np.linalg.norm(embedding)
        return embedding.reshape(1, -1).astype(np.float32)

    def _extract_embeddings_batch(self, bgr_images: list[np.ndarray]) -> np.ndarray:
        tensors = []
        for img in bgr_images:
            normalized = self._normalize_background(img)
            rgb = cv2.cvtColor(normalized, cv2.COLOR_BGR2RGB)
            tensors.append(self._transform(rgb))

        batch = torch.stack(tensors).to(self._device)
        with torch.no_grad():
            features = self._model(batch)

        embeddings = features.cpu().numpy()
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        norms = np.maximum(norms, 1e-12)
        embeddings = embeddings / norms
        return embeddings.astype(np.float32)
