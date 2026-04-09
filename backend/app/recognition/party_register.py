"""パーティ登録用のシンプルな状態マシン.

バトル用の SceneStateMachine とは独立して動作する。
2つの画面（party_screen_1, party_screen_2）を順に検出→OCR読み取りし、
自分のパーティ情報を登録する。

状態遷移:
    idle → detecting_screen1 → reading_screen1
         → detecting_screen2 → reading_screen2 → done → idle
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from app.ocr.region import RegionConfig, RegionRecognizer
from app.recognition.scene_detector import SceneDetector

logger = logging.getLogger(__name__)

SCREEN_SCENES = ["party_screen_1", "party_screen_2"]

DETECTION_DEBOUNCE = 3
"""画面検出に必要な連続フレーム数."""

DETECTION_TIMEOUT_S = 60.0
"""画面検出のタイムアウト（秒）."""


@dataclass(frozen=True, slots=True)
class ScreenResult:
    """1画面分の読み取り結果."""

    screen: int
    regions: dict[str, str]
    """リージョン名 → OCRテキスト."""
    pokemon: list[dict[str, Any]]
    """ポケモンアイコン識別結果."""


@dataclass
class PartyRegistrationState:
    """パーティ登録の現在状態."""

    phase: str = "idle"
    """idle / detecting_screen1 / reading_screen1 /
    detecting_screen2 / reading_screen2 / done"""

    screen_results: list[ScreenResult] = field(default_factory=list)
    """完了した画面の結果."""

    error: str | None = None
    """エラーメッセージ（タイムアウト等）."""


class PartyRegistrationMachine:
    """パーティ登録の状態マシン.

    使い方::

        machine = PartyRegistrationMachine(detector, recognizer, config)
        machine.start()
        # 毎フレーム:
        events = machine.process_frame(frame)
        for event in events:
            await websocket.send_json(event)
    """

    def __init__(
        self,
        detector: SceneDetector,
        recognizer: RegionRecognizer,
        config: RegionConfig,
        pokemon_matcher: Any | None = None,
    ) -> None:
        self._detector = detector
        self._recognizer = recognizer
        self._config = config
        self._pokemon_matcher = pokemon_matcher
        self._state = PartyRegistrationState()

        # デバウンス
        self._pending_scene: str | None = None
        self._pending_count: int = 0

        # タイムアウト
        self._phase_start_time: float = 0.0

    @property
    def state(self) -> PartyRegistrationState:
        return self._state

    @property
    def is_active(self) -> bool:
        return self._state.phase not in ("idle", "done")

    def start(self) -> list[dict[str, Any]]:
        """登録を開始する.

        Returns:
            送信すべき WebSocket メッセージのリスト。
        """
        self._state = PartyRegistrationState(phase="detecting_screen1")
        self._reset_debounce()
        self._phase_start_time = time.monotonic()
        logger.info("パーティ登録開始")
        return [{"type": "party_register_progress", "state": "detecting_screen1"}]

    def cancel(self) -> list[dict[str, Any]]:
        """登録をキャンセルする."""
        self._state = PartyRegistrationState()
        self._reset_debounce()
        logger.info("パーティ登録キャンセル")
        return [{"type": "party_register_progress", "state": "idle"}]

    def process_frame(self, frame: np.ndarray) -> list[dict[str, Any]]:
        """フレームを処理し、送信すべきメッセージを返す.

        Args:
            frame: BGR フルフレーム画像。

        Returns:
            WebSocket メッセージのリスト（0個以上）。
        """
        phase = self._state.phase
        if phase == "idle" or phase == "done":
            return []

        # タイムアウトチェック
        if phase.startswith("detecting_"):
            elapsed = time.monotonic() - self._phase_start_time
            if elapsed > DETECTION_TIMEOUT_S:
                screen_num = "1" if "1" in phase else "2"
                error_msg = f"画面{screen_num}の検出がタイムアウトしました"
                logger.warning("パーティ登録: %s", error_msg)
                self._state = PartyRegistrationState(error=error_msg)
                return [{"type": "party_register_error", "message": error_msg}]

        if phase == "detecting_screen1":
            return self._detect_screen(frame, "party_screen_1", 1)
        elif phase == "reading_screen1":
            return self._read_screen(frame, "party_screen_1", 1)
        elif phase == "detecting_screen2":
            return self._detect_screen(frame, "party_screen_2", 2)
        elif phase == "reading_screen2":
            return self._read_screen(frame, "party_screen_2", 2)

        return []

    def _detect_screen(
        self, frame: np.ndarray, scene_name: str, screen_num: int,
    ) -> list[dict[str, Any]]:
        """画面の検出を試みる."""
        detections = self._detector.detect(frame, [scene_name])
        if scene_name in detections:
            confidence = detections[scene_name]
            if self._pending_scene == scene_name:
                self._pending_count += 1
            else:
                self._pending_scene = scene_name
                self._pending_count = 1

            if self._pending_count >= DETECTION_DEBOUNCE:
                logger.info(
                    "パーティ登録: %s 検出 (confidence=%.3f)",
                    scene_name, confidence,
                )
                self._state.phase = f"reading_screen{screen_num}"
                self._reset_debounce()
                return [
                    {
                        "type": "party_register_progress",
                        "state": f"reading_screen{screen_num}",
                    },
                ]
        else:
            self._reset_debounce()

        return []

    def _read_screen(
        self, frame: np.ndarray, scene_name: str, screen_num: int,
    ) -> list[dict[str, Any]]:
        """画面のOCR読み取りとポケモン識別を実行する."""
        messages: list[dict[str, Any]] = []

        # OCR 読み取り
        regions = self._config.get_regions(scene_name)
        region_data: dict[str, str] = {}
        if regions:
            results = self._recognizer.recognize_regions(frame, regions)
            for r in results:
                region_data[r.region.name] = r.text

        # ポケモンアイコン識別
        pokemon_data: list[dict[str, Any]] = []
        if self._pokemon_matcher is not None:
            icon_defs = self._config.get_pokemon_icons(scene_name)
            if icon_defs:
                from app.data.names import get_id_to_name
                id_to_name = get_id_to_name()

                positions = [
                    {"x": ic["x"], "y": ic["y"], "w": ic["w"], "h": ic["h"]}
                    for ic in icon_defs
                ]
                results = self._pokemon_matcher.identify_team(frame, positions)

                for i, ic in enumerate(icon_defs):
                    entry: dict[str, Any] = {
                        "position": i + 1,
                        "name_key": ic["name"],
                    }
                    if i < len(results) and results[i].candidates:
                        best = results[i].candidates[0]
                        threshold = results[i].threshold
                        if best.confidence >= threshold:
                            entry["pokemon_id"] = best.pokemon_id
                            entry["name"] = id_to_name.get(
                                best.pokemon_id, f"#{best.pokemon_id}",
                            )
                            entry["confidence"] = round(best.confidence, 3)
                        else:
                            entry["pokemon_id"] = None
                            entry["name"] = None
                            entry["confidence"] = 0.0
                    else:
                        entry["pokemon_id"] = None
                        entry["name"] = None
                        entry["confidence"] = 0.0
                    pokemon_data.append(entry)

        screen_result = ScreenResult(
            screen=screen_num,
            regions=region_data,
            pokemon=pokemon_data,
        )
        self._state.screen_results.append(screen_result)

        # 画面結果を送信
        messages.append({
            "type": "party_register_screen",
            "screen": screen_num,
            "regions": region_data,
            "pokemon": pokemon_data,
        })

        if screen_num == 1:
            # 次の画面へ
            self._state.phase = "detecting_screen2"
            self._reset_debounce()
            self._phase_start_time = time.monotonic()
            messages.append({
                "type": "party_register_progress",
                "state": "detecting_screen2",
            })
        else:
            # 全画面完了
            self._state.phase = "done"
            party = self._build_party_result()
            messages.append({
                "type": "party_register_complete",
                "party": party,
            })
            logger.info("パーティ登録完了: %d体", len(party))

        return messages

    def _build_party_result(self) -> list[dict[str, Any]]:
        """全画面の結果を統合してパーティ情報を構築する."""
        party: list[dict[str, Any]] = []
        position = 1

        for sr in self._state.screen_results:
            # ポケモンアイコンがあればそこからスロットを構築
            if sr.pokemon:
                for p in sr.pokemon:
                    party.append({
                        "position": position,
                        "pokemon_id": p.get("pokemon_id"),
                        "name": p.get("name"),
                        "regions": sr.regions,
                    })
                    position += 1
            elif sr.regions:
                # ポケモンアイコンがない場合はリージョンデータのみ
                party.append({
                    "position": position,
                    "pokemon_id": None,
                    "name": None,
                    "regions": sr.regions,
                })
                position += 1

        return party

    def _reset_debounce(self) -> None:
        self._pending_scene = None
        self._pending_count = 0
