"""PartyRegistrationMachine のユニットテスト.

GPU 不要。SceneDetector / RegionRecognizer をモックして純粋なロジックテスト。
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from app.recognition.party_register import (
    DETECTION_DEBOUNCE,
    DETECTION_TIMEOUT_S,
    PartyRegistrationMachine,
    ScreenResult,
)


def _make_frame() -> np.ndarray:
    """テスト用の空フレーム."""
    return np.zeros((1080, 1920, 3), dtype=np.uint8)


def _make_machine(
    detect_results: dict[str, float] | None = None,
    ocr_regions: list | None = None,
    pokemon_icons: list | None = None,
) -> PartyRegistrationMachine:
    """モックを使ってマシンを構築."""
    detector = MagicMock()
    detector.detect.return_value = detect_results or {}

    recognizer = MagicMock()
    if ocr_regions is not None:
        recognizer.recognize_regions.return_value = ocr_regions
    else:
        recognizer.recognize_regions.return_value = []

    config = MagicMock()
    config.get_regions.return_value = []
    config.get_pokemon_icons.return_value = pokemon_icons or []

    return PartyRegistrationMachine(
        detector=detector,
        recognizer=recognizer,
        config=config,
        pokemon_matcher=None,
    )


class TestLifecycle:
    """基本的なライフサイクルテスト."""

    def test_initial_state_is_idle(self) -> None:
        machine = _make_machine()
        assert machine.state.phase == "idle"
        assert not machine.is_active

    def test_start_transitions_to_detecting_screen1(self) -> None:
        machine = _make_machine()
        msgs = machine.start()
        assert machine.state.phase == "detecting_screen1"
        assert machine.is_active
        assert len(msgs) == 1
        assert msgs[0]["type"] == "party_register_progress"
        assert msgs[0]["state"] == "detecting_screen1"

    def test_cancel_returns_to_idle(self) -> None:
        machine = _make_machine()
        machine.start()
        msgs = machine.cancel()
        assert machine.state.phase == "idle"
        assert not machine.is_active
        assert msgs[0]["type"] == "party_register_progress"
        assert msgs[0]["state"] == "idle"

    def test_process_frame_while_idle_returns_empty(self) -> None:
        machine = _make_machine()
        msgs = machine.process_frame(_make_frame())
        assert msgs == []


class TestDetection:
    """画面検出のテスト."""

    def test_screen1_detected_after_debounce(self) -> None:
        machine = _make_machine(detect_results={"party_screen_1": 0.95})
        machine.start()

        frame = _make_frame()
        for i in range(DETECTION_DEBOUNCE - 1):
            msgs = machine.process_frame(frame)
            assert machine.state.phase == "detecting_screen1"

        # デバウンス達成
        msgs = machine.process_frame(frame)
        assert machine.state.phase == "reading_screen1"
        assert any(m["type"] == "party_register_progress" for m in msgs)

    def test_detection_debounce_resets_on_miss(self) -> None:
        detector = MagicMock()
        recognizer = MagicMock()
        recognizer.recognize_regions.return_value = []
        config = MagicMock()
        config.get_regions.return_value = []
        config.get_pokemon_icons.return_value = []

        machine = PartyRegistrationMachine(
            detector=detector,
            recognizer=recognizer,
            config=config,
        )
        machine.start()

        frame = _make_frame()

        # 2回検出成功
        detector.detect.return_value = {"party_screen_1": 0.9}
        machine.process_frame(frame)
        machine.process_frame(frame)

        # 1回ミス → リセット
        detector.detect.return_value = {}
        machine.process_frame(frame)

        # 再開しても debounce 回数分必要
        detector.detect.return_value = {"party_screen_1": 0.9}
        for _ in range(DETECTION_DEBOUNCE - 1):
            machine.process_frame(frame)
        assert machine.state.phase == "detecting_screen1"

        machine.process_frame(frame)
        assert machine.state.phase == "reading_screen1"


class TestReading:
    """OCR 読み取りのテスト."""

    def test_screen1_read_transitions_to_detecting_screen2(self) -> None:
        machine = _make_machine(detect_results={"party_screen_1": 0.95})
        machine.start()

        frame = _make_frame()
        # 検出フェーズを通過
        for _ in range(DETECTION_DEBOUNCE):
            machine.process_frame(frame)
        assert machine.state.phase == "reading_screen1"

        # 読み取りフェーズ
        msgs = machine.process_frame(frame)
        assert machine.state.phase == "detecting_screen2"
        screen_msgs = [m for m in msgs if m["type"] == "party_register_screen"]
        assert len(screen_msgs) == 1
        assert screen_msgs[0]["screen"] == 1

    def test_full_flow_completes(self) -> None:
        """screen1 検出 → 読み取り → screen2 検出 → 読み取り → done."""
        detector = MagicMock()
        recognizer = MagicMock()
        recognizer.recognize_regions.return_value = []
        config = MagicMock()
        config.get_regions.return_value = []
        config.get_pokemon_icons.return_value = []

        machine = PartyRegistrationMachine(
            detector=detector,
            recognizer=recognizer,
            config=config,
        )
        machine.start()
        frame = _make_frame()

        # screen1 検出
        detector.detect.return_value = {"party_screen_1": 0.95}
        for _ in range(DETECTION_DEBOUNCE):
            machine.process_frame(frame)
        assert machine.state.phase == "reading_screen1"

        # screen1 読み取り
        machine.process_frame(frame)
        assert machine.state.phase == "detecting_screen2"

        # screen2 検出
        detector.detect.return_value = {"party_screen_2": 0.93}
        for _ in range(DETECTION_DEBOUNCE):
            machine.process_frame(frame)
        assert machine.state.phase == "reading_screen2"

        # screen2 読み取り → done
        msgs = machine.process_frame(frame)
        assert machine.state.phase == "done"
        assert not machine.is_active
        complete_msgs = [m for m in msgs if m["type"] == "party_register_complete"]
        assert len(complete_msgs) == 1

    def test_screen_results_accumulated(self) -> None:
        """各画面の読み取り結果が state に蓄積される."""
        detector = MagicMock()
        recognizer = MagicMock()
        recognizer.recognize_regions.return_value = []
        config = MagicMock()
        config.get_regions.return_value = []
        config.get_pokemon_icons.return_value = []

        machine = PartyRegistrationMachine(
            detector=detector,
            recognizer=recognizer,
            config=config,
        )
        machine.start()
        frame = _make_frame()

        # screen1 検出 + 読み取り
        detector.detect.return_value = {"party_screen_1": 0.95}
        for _ in range(DETECTION_DEBOUNCE):
            machine.process_frame(frame)
        machine.process_frame(frame)

        assert len(machine.state.screen_results) == 1
        assert machine.state.screen_results[0].screen == 1

        # screen2 検出 + 読み取り
        detector.detect.return_value = {"party_screen_2": 0.93}
        for _ in range(DETECTION_DEBOUNCE):
            machine.process_frame(frame)
        machine.process_frame(frame)

        assert len(machine.state.screen_results) == 2
        assert machine.state.screen_results[1].screen == 2


class TestTimeout:
    """タイムアウトのテスト."""

    def test_detection_timeout(self) -> None:
        machine = _make_machine(detect_results={})
        machine.start()

        frame = _make_frame()

        # タイムアウト時刻を過去に設定
        machine._phase_start_time -= DETECTION_TIMEOUT_S + 1

        msgs = machine.process_frame(frame)
        assert any(m["type"] == "party_register_error" for m in msgs)
        assert not machine.is_active
