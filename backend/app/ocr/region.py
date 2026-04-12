"""画面領域の自動クロップと一括認識.

config/regions.json の座標定義に基づいて、全体画像から各領域を切り出し、
適切なエンジン・パイプラインで認識する。
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from app.ocr.base import OCREngine, OCRResult
from app.ocr.pipeline import OCRPipeline

logger = logging.getLogger(__name__)

_DEFAULT_CONFIG = Path(__file__).parent.parent.parent / "config" / "regions.json"

# 旧→新フォーマットのクロップ名マッピング
_NAME_MIGRATION: dict[str, str] = {
    "own_name": "自分の名前",
    "own_hp": "自分HP",
    "opponent_name": "相手の名前",
    "opponent_hp": "相手HP",
    "own_pokemon_1": "味方ポケモン1",
    "own_pokemon_2": "味方ポケモン2",
    "own_pokemon_3": "味方ポケモン3",
    "own_pokemon_4": "味方ポケモン4",
    "own_pokemon_5": "味方ポケモン5",
    "own_pokemon_6": "味方ポケモン6",
}

# シーンキーの表示名マッピング
_SCENE_DISPLAY_NAMES: dict[str, str] = {
    "battle": "バトル",
    "team_select": "チーム選択",
}


@dataclass(frozen=True, slots=True)
class Region:
    """OCR読み取り用の矩形領域."""

    name: str
    x: int
    y: int
    w: int
    h: int
    engine: str
    read_once: bool = False

    def crop(self, image: np.ndarray) -> np.ndarray:
        """画像からこの領域を切り出す."""
        return image[self.y : self.y + self.h, self.x : self.x + self.w]


@dataclass(frozen=True, slots=True)
class DetectionRegion:
    """シーン検出用の矩形領域."""

    name: str
    x: int
    y: int
    w: int
    h: int
    method: str  # "template" | "ocr"
    params: dict[str, Any]

    def crop(self, image: np.ndarray) -> np.ndarray:
        """画像からこの領域を切り出す."""
        return image[self.y : self.y + self.h, self.x : self.x + self.w]


@dataclass(frozen=True, slots=True)
class RegionResult:
    """領域ごとの認識結果."""

    region: Region
    ocr_results: list[OCRResult]
    text: str  # 全 OCRResult のテキストを結合したもの
    elapsed_ms: float


class RegionConfig:
    """regions.json を読み込んで Region オブジェクトを提供する."""

    def __init__(self, config_path: str | Path = _DEFAULT_CONFIG) -> None:
        self._path = Path(config_path)
        self._data: dict[str, Any] = {}
        self._load()

    def _load(self) -> None:
        text = self._path.read_text(encoding="utf-8")
        self._data = json.loads(text)
        self._migrate_if_needed()

    def _migrate_if_needed(self) -> None:
        """旧フォーマット（フラット構造）を新フォーマット（scenes ネスト）に変換."""
        if "scenes" in self._data:
            return

        logger.info("regions.json: 旧フォーマットを検出、マイグレーションを実行します")

        old_data = self._data
        resolution = old_data.get("resolution", {"width": 1920, "height": 1080})

        scenes: dict[str, Any] = {}
        for key, value in old_data.items():
            if key in ("_comment", "resolution") or not isinstance(value, dict):
                continue
            # 旧シーンのリージョンを新構造に変換
            new_regions: dict[str, Any] = {}
            for region_name, region_def in value.items():
                if region_name.startswith("_"):
                    continue
                new_name = _NAME_MIGRATION.get(region_name, region_name)
                new_regions[new_name] = region_def

            scenes[key] = {
                "display_name": _SCENE_DISPLAY_NAMES.get(key, key),
                "description": "",
                "detection": {},
                "regions": new_regions,
            }

        self._data = {
            "_comment": "画面領域の座標定義 (1920x1080 基準)",
            "resolution": resolution,
            "scenes": scenes,
        }

        # 変換結果をファイルに書き戻す
        self._path.write_text(
            json.dumps(self._data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        logger.info("regions.json: マイグレーション完了")

    def reload(self) -> None:
        """設定ファイルを再読み込み（座標調整後に使う）."""
        self._load()

    @property
    def resolution(self) -> tuple[int, int]:
        r = self._data["resolution"]
        return r["width"], r["height"]

    def get_regions(self, scene: str) -> list[Region]:
        """シーン名から全OCR読み取り領域を取得."""
        scene_data = self._data.get("scenes", {}).get(scene, {})
        regions: list[Region] = []

        # region_groups 展開 (type="region" のみ)
        for _group_name, group in scene_data.get("region_groups", {}).items():
            template = group.get("template", {})
            for slot in group.get("slots", []):
                sx, sy = slot["x"], slot["y"]
                for sub_name, sub_cfg in template.items():
                    if sub_cfg.get("type", "region") != "region":
                        continue
                    regions.append(Region(
                        name=f"{slot['name']}{sub_name}",
                        x=sx + sub_cfg["dx"],
                        y=sy + sub_cfg["dy"],
                        w=sub_cfg["w"],
                        h=sub_cfg["h"],
                        engine=sub_cfg.get("engine", "paddle"),
                        read_once=sub_cfg.get("read_once", False),
                    ))

        # standalone regions
        for name, cfg in scene_data.get("regions", {}).items():
            if name.startswith("_"):
                continue
            regions.append(Region(
                name=name,
                x=cfg["x"],
                y=cfg["y"],
                w=cfg["w"],
                h=cfg["h"],
                engine=cfg.get("engine", "paddle"),
                read_once=cfg.get("read_once", False),
            ))
        return regions

    def get_detection_regions(self, scene: str) -> list[DetectionRegion]:
        """シーン名から全検出用領域を取得."""
        scene_data = self._data.get("scenes", {}).get(scene, {})
        detection_data = scene_data.get("detection", {})
        regions = []
        for name, cfg in detection_data.items():
            if name.startswith("_"):
                continue
            # method 固有パラメータを params にまとめる
            params = {k: v for k, v in cfg.items()
                      if k not in ("x", "y", "w", "h", "method")}
            regions.append(DetectionRegion(
                name=name,
                x=cfg["x"],
                y=cfg["y"],
                w=cfg["w"],
                h=cfg["h"],
                method=cfg.get("method", "template"),
                params=params,
            ))
        return regions

    def get_pokemon_icons(self, scene: str) -> list[dict[str, Any]]:
        """シーン名からポケモンアイコン領域を取得."""
        scene_data = self._data.get("scenes", {}).get(scene, {})
        icons: list[dict[str, Any]] = []

        # region_groups 展開 (type="pokemon_icon" のみ)
        for _group_name, group in scene_data.get("region_groups", {}).items():
            template = group.get("template", {})
            for slot in group.get("slots", []):
                sx, sy = slot["x"], slot["y"]
                for sub_name, sub_cfg in template.items():
                    if sub_cfg.get("type") != "pokemon_icon":
                        continue
                    icons.append({
                        "name": f"{slot['name']}{sub_name}",
                        "x": sx + sub_cfg["dx"],
                        "y": sy + sub_cfg["dy"],
                        "w": sub_cfg["w"],
                        "h": sub_cfg["h"],
                        "read_once": sub_cfg.get("read_once", False),
                    })

        # standalone pokemon_icons
        for name, cfg in scene_data.get("pokemon_icons", {}).items():
            if name.startswith("_"):
                continue
            icons.append({
                "name": name,
                "x": cfg["x"],
                "y": cfg["y"],
                "w": cfg["w"],
                "h": cfg["h"],
                "read_once": cfg.get("read_once", False),
            })
        return icons

    def get_stat_modifiers(self, scene: str) -> list[dict[str, Any]]:
        """シーン名から性格補正領域を取得."""
        scene_data = self._data.get("scenes", {}).get(scene, {})
        modifiers: list[dict[str, Any]] = []

        # region_groups 展開 (type="stat_modifier" のみ)
        for _group_name, group in scene_data.get("region_groups", {}).items():
            template = group.get("template", {})
            for slot in group.get("slots", []):
                sx, sy = slot["x"], slot["y"]
                for sub_name, sub_cfg in template.items():
                    if sub_cfg.get("type") != "stat_modifier":
                        continue
                    modifiers.append({
                        "name": f"{slot['name']}{sub_name}",
                        "x": sx + sub_cfg["dx"],
                        "y": sy + sub_cfg["dy"],
                        "w": sub_cfg["w"],
                        "h": sub_cfg["h"],
                        "read_once": sub_cfg.get("read_once", False),
                    })

        return modifiers

    @property
    def scenes(self) -> list[str]:
        """利用可能なシーン名一覧."""
        return list(self._data.get("scenes", {}).keys())

    def get_scene_meta(self, scene: str) -> dict[str, str]:
        """シーンのメタデータ (display_name, description) を取得."""
        scene_data = self._data.get("scenes", {}).get(scene, {})
        return {
            "display_name": scene_data.get("display_name", scene),
            "description": scene_data.get("description", ""),
        }

    def get_all_scenes_meta(self) -> dict[str, dict[str, str]]:
        """全シーンのメタデータを取得."""
        return {scene: self.get_scene_meta(scene) for scene in self.scenes}

    def get_interval_ms(self, scene: str) -> int:
        """シーンのポーリング間隔(ms)を取得."""
        scene_data = self._data.get("scenes", {}).get(scene, {})
        return scene_data.get(
            "interval_ms", self._data.get("default_interval_ms", 500),
        )

    def get_all_intervals(self) -> dict[str, int]:
        """全シーンの {シーン名: interval_ms} を取得."""
        default = self._data.get("default_interval_ms", 500)
        return {
            name: scene.get("interval_ms", default)
            for name, scene in self._data.get("scenes", {}).items()
        }


ALL_ENGINES = ["paddle", "manga", "glm"]


class RegionRecognizer:
    """config に基づいて画面全体から各領域を自動クロップ → 認識する.

    使い方:
        recognizer = RegionRecognizer()
        results = recognizer.recognize(image, scene="battle")
        for r in results:
            print(f"{r.region.name}: {r.text}")
    """

    def __init__(
        self,
        config: RegionConfig | None = None,
        ocr_config: Any | None = None,
    ) -> None:
        self._config = config or RegionConfig()
        self._ocr_config = ocr_config
        self._engines: dict[str, OCREngine] = {}
        self._pipelines: dict[str, OCRPipeline] = {}

    def _get_pipeline(self, engine_name: str) -> OCRPipeline:
        """エンジンのパイプラインを取得（キャッシュ付き）."""
        if engine_name not in self._pipelines:
            engine = self._get_engine(engine_name)
            self._pipelines[engine_name] = OCRPipeline(engine)
        return self._pipelines[engine_name]

    def _get_engine(self, name: str) -> OCREngine:
        """エンジンを取得（キャッシュ付き、未ロードならロード）."""
        if name not in self._engines:
            from app.ocr.glm_ocr import GLMOCREngine
            from app.ocr.manga_ocr import MangaOCREngine
            from app.ocr.paddle_ocr import PaddleOCREngine

            cfg = self._ocr_config
            if name == "paddle" and cfg is not None:
                engine: OCREngine = PaddleOCREngine(
                    det_model=cfg.paddle.det_model,
                    rec_model=cfg.paddle.rec_model,
                    device=cfg.paddle.device,
                )
            elif name == "glm" and cfg is not None:
                engine = GLMOCREngine(
                    model_id=cfg.glm.model_id,
                    max_new_tokens=cfg.glm.max_new_tokens,
                )
            elif name == "manga":
                engine = MangaOCREngine()
            else:
                factories: dict[str, type[OCREngine]] = {
                    "paddle": PaddleOCREngine,
                    "manga": MangaOCREngine,
                    "glm": GLMOCREngine,
                }
                if name not in factories:
                    raise ValueError(f"不明なエンジン: '{name}'")
                engine = factories[name]()
            engine.load()
            self._engines[name] = engine
        return self._engines[name]

    def recognize_regions(
        self, image: np.ndarray, regions: list[Region],
    ) -> list[RegionResult]:
        """指定された領域リストを認識する."""
        results: list[RegionResult] = []

        for region in regions:
            cropped = region.crop(image)
            pipeline = self._get_pipeline(region.engine)

            t0 = time.perf_counter()
            ocr_results = pipeline.run(cropped)
            elapsed = (time.perf_counter() - t0) * 1000

            text = "".join(r.text for r in ocr_results)
            results.append(RegionResult(
                region=region,
                ocr_results=ocr_results,
                text=text,
                elapsed_ms=elapsed,
            ))

        return results

    def recognize_regions_batched(
        self, image: np.ndarray, regions: list[Region],
    ) -> list[RegionResult]:
        """エンジンごとにバッチ推論で認識する.

        リージョンをエンジン名でグルーピングし、各エンジンに対して
        1回の run_batch() でまとめて推論する。逐次版と同じ結果を返す。
        """
        if not regions:
            return []

        # エンジン名でグルーピング（元の順序を保持するために index を記録）
        engine_groups: dict[str, list[tuple[int, Region, np.ndarray]]] = {}
        for i, region in enumerate(regions):
            cropped = region.crop(image)
            engine_groups.setdefault(region.engine, []).append((i, region, cropped))

        # エンジンごとにバッチ推論
        results_by_index: dict[int, RegionResult] = {}
        for engine_name, group in engine_groups.items():
            pipeline = self._get_pipeline(engine_name)
            images = [cropped for _, _, cropped in group]

            t0 = time.perf_counter()
            batch_ocr = pipeline.run_batch(images)
            batch_elapsed = (time.perf_counter() - t0) * 1000

            per_region_ms = batch_elapsed / len(group) if group else 0.0
            for (idx, region, _cropped), ocr_results in zip(group, batch_ocr):
                text = "".join(r.text for r in ocr_results)
                results_by_index[idx] = RegionResult(
                    region=region,
                    ocr_results=ocr_results,
                    text=text,
                    elapsed_ms=per_region_ms,
                )

        return [results_by_index[i] for i in range(len(regions))]

    def recognize(self, image: np.ndarray, scene: str) -> list[RegionResult]:
        """全体画像から指定シーンの全領域を認識する."""
        regions = self._config.get_regions(scene)
        return self.recognize_regions(image, regions)

    def recognize_all_engines(
        self, image: np.ndarray, scene: str,
    ) -> list[dict[str, Any]]:
        """全エンジンで各リージョンを認識する（ベンチマーク用）.

        Returns:
            [{"region": Region, "engines": [{"engine": str, "text": str,
              "confidence": float, "elapsed_ms": float}, ...]}]
        """
        regions = self._config.get_regions(scene)
        results: list[dict[str, Any]] = []

        for region in regions:
            cropped = region.crop(image)
            engine_results: list[dict[str, Any]] = []
            for engine_name in ALL_ENGINES:
                pipeline = self._get_pipeline(engine_name)
                t0 = time.perf_counter()
                ocr_results = pipeline.run(cropped)
                elapsed = (time.perf_counter() - t0) * 1000
                text = "".join(r.text for r in ocr_results)
                conf = ocr_results[0].confidence if ocr_results else 0.0
                engine_results.append({
                    "engine": engine_name,
                    "text": text,
                    "confidence": round(conf, 4),
                    "elapsed_ms": round(elapsed, 1),
                })
            results.append({"region": region, "engines": engine_results})

        return results

    def recognize_from_file(self, path: str | Path, scene: str) -> list[RegionResult]:
        """ファイルから画像を読み込んで認識."""
        import cv2

        img = cv2.imread(str(path))
        if img is None:
            raise FileNotFoundError(f"画像を読み込めません: {path}")
        return self.recognize(img, scene)

    def unload_all(self) -> None:
        """全エンジンを解放."""
        for engine in self._engines.values():
            engine.unload()
        self._engines.clear()
        self._pipelines.clear()
