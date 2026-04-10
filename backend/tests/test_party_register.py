"""PartyRegistrationMachine のユニットテスト.

GPU 不要。SceneDetector / RegionRecognizer をモックして純粋なロジックテスト。
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from app.recognition.party_register import (
    DETECTION_DEBOUNCE,
    DETECTION_DEBOUNCE_HIGH_CONF,
    DETECTION_TIMEOUT_S,
    HIGH_CONFIDENCE_THRESHOLD,
    PartyRegistrationMachine,
    ScreenResult,
    _group_regions_by_slot,
    _validate_fields,
)


def _make_frame() -> np.ndarray:
    """テスト用の空フレーム."""
    return np.zeros((1080, 1920, 3), dtype=np.uint8)


def _make_detailed_results(
    detect_results: dict[str, float],
) -> list[MagicMock]:
    """detect_detailed の戻り値を構築する."""
    results = []
    for scene, confidence in detect_results.items():
        d = MagicMock()
        d.scene = scene
        d.region_name = "test_region"
        d.matched = True
        d.confidence = confidence
        results.append(d)
    return results


def _make_machine(
    detect_results: dict[str, float] | None = None,
    ocr_regions: list | None = None,
    pokemon_icons: list | None = None,
) -> PartyRegistrationMachine:
    """モックを使ってマシンを構築."""
    detector = MagicMock()
    detailed = _make_detailed_results(detect_results or {})
    detector.detect_detailed.return_value = detailed

    recognizer = MagicMock()
    if ocr_regions is not None:
        recognizer.recognize_regions.return_value = ocr_regions
    else:
        recognizer.recognize_regions.return_value = []

    config = MagicMock()
    config.get_regions.return_value = []
    config.get_pokemon_icons.return_value = pokemon_icons or []
    config.get_stat_modifiers.return_value = []

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
        # 高信頼度（>= 0.95）なのでデバウンスは DETECTION_DEBOUNCE_HIGH_CONF
        for i in range(DETECTION_DEBOUNCE_HIGH_CONF - 1):
            msgs = machine.process_frame(frame)
            assert machine.state.phase == "detecting_screen1"

        # デバウンス達成 → 同一フレームで読み取りも完了 → detecting_screen2 へ
        msgs = machine.process_frame(frame)
        assert machine.state.phase == "detecting_screen2"
        assert any(m["type"] == "party_register_progress" for m in msgs)
        assert any(m.get("type") == "party_register_screen" and m.get("screen") == 1 for m in msgs)

    def test_detection_debounce_resets_on_miss(self) -> None:
        detector = MagicMock()
        recognizer = MagicMock()
        recognizer.recognize_regions.return_value = []
        config = MagicMock()
        config.get_regions.return_value = []
        config.get_pokemon_icons.return_value = []
        config.get_stat_modifiers.return_value = []

        machine = PartyRegistrationMachine(
            detector=detector,
            recognizer=recognizer,
            config=config,
        )
        machine.start()

        frame = _make_frame()

        # 低信頼度（< 0.95）なので DETECTION_DEBOUNCE (3) が必要
        # 2回検出成功
        detector.detect_detailed.return_value = _make_detailed_results({"party_screen_1": 0.9})
        machine.process_frame(frame)
        machine.process_frame(frame)

        # 1回ミス → リセット
        detector.detect_detailed.return_value = []
        machine.process_frame(frame)

        # 再開しても debounce 回数分必要
        detector.detect_detailed.return_value = _make_detailed_results({"party_screen_1": 0.9})
        for _ in range(DETECTION_DEBOUNCE - 1):
            machine.process_frame(frame)
        assert machine.state.phase == "detecting_screen1"

        # デバウンス達成 → 検出 + 読み取り → detecting_screen2 へ
        machine.process_frame(frame)
        assert machine.state.phase == "detecting_screen2"


class TestReading:
    """OCR 読み取りのテスト."""

    def test_screen1_read_transitions_to_detecting_screen2(self) -> None:
        machine = _make_machine(detect_results={"party_screen_1": 0.95})
        machine.start()

        frame = _make_frame()
        # 高信頼度デバウンス -1 回: まだ検出中
        for _ in range(DETECTION_DEBOUNCE_HIGH_CONF - 1):
            machine.process_frame(frame)
        assert machine.state.phase == "detecting_screen1"

        # デバウンス達成 → 検出 + 読み取りが同一フレームで完了
        msgs = machine.process_frame(frame)
        assert machine.state.phase == "detecting_screen2"
        screen_msgs = [m for m in msgs if m["type"] == "party_register_screen"]
        assert len(screen_msgs) == 1
        assert screen_msgs[0]["screen"] == 1

    def test_full_flow_completes(self) -> None:
        """screen1 検出+読み取り → screen2 検出+読み取り → done."""
        detector = MagicMock()
        recognizer = MagicMock()
        recognizer.recognize_regions.return_value = []
        config = MagicMock()
        config.get_regions.return_value = []
        config.get_pokemon_icons.return_value = []
        config.get_stat_modifiers.return_value = []

        machine = PartyRegistrationMachine(
            detector=detector,
            recognizer=recognizer,
            config=config,
        )
        machine.start()
        frame = _make_frame()

        # screen1 検出 + 読み取り（高信頼度、同一フレームで完了）
        detector.detect_detailed.return_value = _make_detailed_results({"party_screen_1": 0.95})
        for _ in range(DETECTION_DEBOUNCE_HIGH_CONF):
            machine.process_frame(frame)
        assert machine.state.phase == "detecting_screen2"

        # screen2 検出 + 読み取り（低信頼度、DETECTION_DEBOUNCE 必要）
        detector.detect_detailed.return_value = _make_detailed_results({"party_screen_2": 0.93})
        for _ in range(DETECTION_DEBOUNCE - 1):
            machine.process_frame(frame)
        assert machine.state.phase == "detecting_screen2"

        # デバウンス達成 → 検出 + 読み取り → done
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
        config.get_stat_modifiers.return_value = []

        machine = PartyRegistrationMachine(
            detector=detector,
            recognizer=recognizer,
            config=config,
        )
        machine.start()
        frame = _make_frame()

        # screen1 検出 + 読み取り（同一フレームで完了）
        detector.detect_detailed.return_value = _make_detailed_results({"party_screen_1": 0.95})
        for _ in range(DETECTION_DEBOUNCE_HIGH_CONF):
            machine.process_frame(frame)

        assert len(machine.state.screen_results) == 1
        assert machine.state.screen_results[0].screen == 1

        # screen2 検出 + 読み取り
        detector.detect_detailed.return_value = _make_detailed_results({"party_screen_2": 0.93})
        for _ in range(DETECTION_DEBOUNCE):
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


class TestGroupRegionsBySlot:
    """_group_regions_by_slot のテスト."""

    def test_groups_by_slot_prefix(self) -> None:
        regions = {
            "ポケモン１名前": "リザードン",
            "ポケモン１特性": "もうか",
            "ポケモン２名前": "ガブリアス",
            "ポケモン２特性": "さめはだ",
        }
        grouped = _group_regions_by_slot(regions)
        assert grouped == {
            1: {"名前": "リザードン", "特性": "もうか"},
            2: {"名前": "ガブリアス", "特性": "さめはだ"},
        }

    def test_all_six_slots(self) -> None:
        regions = {f"ポケモン{c}名前": f"pokemon{i+1}" for i, c in enumerate("１２３４５６")}
        grouped = _group_regions_by_slot(regions)
        assert len(grouped) == 6
        for pos in range(1, 7):
            assert grouped[pos]["名前"] == f"pokemon{pos}"

    def test_empty_regions(self) -> None:
        assert _group_regions_by_slot({}) == {}

    def test_non_slot_keys_ignored(self) -> None:
        regions = {
            "ポケモン１名前": "リザードン",
            "standalone_region": "some_value",
        }
        grouped = _group_regions_by_slot(regions)
        assert grouped == {1: {"名前": "リザードン"}}

    def test_stat_fields_grouped(self) -> None:
        regions = {
            "ポケモン１HP実数値": "153",
            "ポケモン１こうげき実数値": "120",
            "ポケモン２HP実数値": "200",
        }
        grouped = _group_regions_by_slot(regions)
        assert grouped[1] == {"HP実数値": "153", "こうげき実数値": "120"}
        assert grouped[2] == {"HP実数値": "200"}


class TestValidateFields:
    """_validate_fields のテスト."""

    @patch("app.dependencies.get_game_data")
    def test_pokemon_name_validated(self, mock_get_gd: MagicMock) -> None:
        mock_gd = MagicMock()
        mock_gd.fuzzy_match_pokemon_name.return_value = {
            "matched_name": "リザードン",
            "species_id": 6,
            "confidence": 0.95,
        }
        mock_get_gd.return_value = mock_gd

        result = _validate_fields({"名前": "リザードソ"})
        assert result["名前"]["raw"] == "リザードソ"
        assert result["名前"]["validated"] == "リザードン"
        assert result["名前"]["confidence"] == 0.95
        assert result["名前"]["matched_id"] == 6

    @patch("app.dependencies.get_game_data")
    def test_move_name_validated(self, mock_get_gd: MagicMock) -> None:
        mock_gd = MagicMock()
        mock_gd.fuzzy_match_move_name.return_value = {
            "matched_name": "かえんほうしゃ",
            "move_id": 53,
            "confidence": 1.0,
        }
        mock_get_gd.return_value = mock_gd

        result = _validate_fields({"わざ１": "かえんほうしゃ"})
        assert result["わざ１"]["validated"] == "かえんほうしゃ"
        assert result["わざ１"]["confidence"] == 1.0
        assert result["わざ１"]["matched_id"] == 53

    @patch("app.dependencies.get_game_data")
    def test_ability_validated(self, mock_get_gd: MagicMock) -> None:
        mock_gd = MagicMock()
        mock_gd.fuzzy_match_ability_name.return_value = {
            "matched_name": "もうか",
            "ability_id": 66,
            "confidence": 0.95,
        }
        mock_get_gd.return_value = mock_gd

        result = _validate_fields({"特性": "もうが"})
        assert result["特性"]["raw"] == "もうが"
        assert result["特性"]["validated"] == "もうか"
        assert result["特性"]["matched_id"] == 66

    @patch("app.dependencies.get_game_data")
    def test_item_validated(self, mock_get_gd: MagicMock) -> None:
        mock_gd = MagicMock()
        mock_gd.fuzzy_match_item_name.return_value = {
            "matched_name": "たべのこし",
            "item_id": 234,
            "confidence": 0.90,
        }
        mock_get_gd.return_value = mock_gd

        result = _validate_fields({"もちもの": "たべのこじ"})
        assert result["もちもの"]["raw"] == "たべのこじ"
        assert result["もちもの"]["validated"] == "たべのこし"
        assert result["もちもの"]["matched_id"] == 234

    @patch("app.dependencies.get_game_data")
    def test_stat_numeric_validation(self, mock_get_gd: MagicMock) -> None:
        mock_gd = MagicMock()
        mock_get_gd.return_value = mock_gd

        result = _validate_fields({"HP実数値": "153", "こうげき努力値": "252"})
        assert result["HP実数値"]["validated"] == "153"
        assert result["HP実数値"]["confidence"] == 1.0
        assert result["こうげき努力値"]["validated"] == "252"

    @patch("app.dependencies.get_game_data")
    def test_stat_invalid_numeric(self, mock_get_gd: MagicMock) -> None:
        mock_gd = MagicMock()
        mock_get_gd.return_value = mock_gd

        result = _validate_fields({"HP実数値": "abc"})
        assert result["HP実数値"]["validated"] is None
        assert result["HP実数値"]["confidence"] == 0.0

    @patch("app.dependencies.get_game_data")
    def test_nature_modifier_up(self, mock_get_gd: MagicMock) -> None:
        mock_gd = MagicMock()
        mock_get_gd.return_value = mock_gd

        result = _validate_fields({"こうげき性格補正": "up"})
        assert result["こうげき性格補正"]["validated"] == "up"
        assert result["こうげき性格補正"]["confidence"] == 1.0

    @patch("app.dependencies.get_game_data")
    def test_nature_modifier_down(self, mock_get_gd: MagicMock) -> None:
        mock_gd = MagicMock()
        mock_get_gd.return_value = mock_gd

        result = _validate_fields({"すばやさ性格補正": "down"})
        assert result["すばやさ性格補正"]["validated"] == "down"
        assert result["すばやさ性格補正"]["confidence"] == 1.0

    @patch("app.dependencies.get_game_data")
    def test_nature_modifier_neutral(self, mock_get_gd: MagicMock) -> None:
        mock_gd = MagicMock()
        mock_get_gd.return_value = mock_gd

        result = _validate_fields({"こうげき性格補正": ""})
        assert result["こうげき性格補正"]["validated"] is None
        assert result["こうげき性格補正"]["confidence"] == 1.0

    def test_game_data_unavailable_skips_validation(self) -> None:
        """GameData が未初期化でも例外にならず raw のみ返す."""
        with patch(
            "app.dependencies.get_game_data",
            side_effect=RuntimeError("not initialized"),
        ):
            result = _validate_fields({"名前": "テスト"})
            assert result["名前"]["raw"] == "テスト"
            assert result["名前"]["validated"] is None
            assert result["名前"]["matched_id"] is None


class TestBuildPartyResult:
    """_build_party_result の統合テスト."""

    @patch("app.dependencies.get_game_data", side_effect=RuntimeError)
    def test_per_pokemon_fields(self, _mock: MagicMock) -> None:
        """各ポケモンに自分のフィールドのみ割り当てられる."""
        detector = MagicMock()
        recognizer = MagicMock()
        recognizer.recognize_regions.return_value = []
        config = MagicMock()
        config.get_regions.return_value = []
        config.get_pokemon_icons.return_value = []
        config.get_stat_modifiers.return_value = []

        machine = PartyRegistrationMachine(
            detector=detector, recognizer=recognizer, config=config,
        )
        machine._state.phase = "done"
        machine._state.screen_results = [
            ScreenResult(
                screen=1,
                regions={
                    "ポケモン１名前": "リザードン",
                    "ポケモン１わざ１": "かえんほうしゃ",
                    "ポケモン２名前": "ガブリアス",
                    "ポケモン２わざ１": "じしん",
                },
                pokemon=[
                    {"position": 1, "pokemon_id": 6, "name": "リザードン"},
                    {"position": 2, "pokemon_id": 445, "name": "ガブリアス"},
                ],
            ),
        ]

        party = machine._build_party_result()
        assert len(party) == 2

        p1 = party[0]
        assert p1["position"] == 1
        assert p1["pokemon_id"] == 6
        assert "名前" in p1["fields"]
        assert p1["fields"]["名前"]["raw"] == "リザードン"
        assert "わざ１" in p1["fields"]
        assert p1["fields"]["わざ１"]["raw"] == "かえんほうしゃ"
        # ポケモン２のフィールドが混入していないこと
        assert len(p1["fields"]) == 2

        p2 = party[1]
        assert p2["position"] == 2
        assert p2["pokemon_id"] == 445
        assert p2["fields"]["名前"]["raw"] == "ガブリアス"
        assert p2["fields"]["わざ１"]["raw"] == "じしん"

    @patch("app.dependencies.get_game_data")
    def test_fallback_pokemon_id_from_name(self, mock_get_gd: MagicMock) -> None:
        """アイコンマッチング失敗時、名前照合の species_id を pokemon_id に使う."""
        mock_gd = MagicMock()
        mock_gd.fuzzy_match_pokemon_name.return_value = {
            "matched_name": "リザードン",
            "species_id": 6,
            "confidence": 0.95,
        }
        mock_gd.fuzzy_match_move_name.return_value = None
        mock_gd.fuzzy_match_ability_name.return_value = None
        mock_gd.fuzzy_match_item_name.return_value = None
        mock_get_gd.return_value = mock_gd

        detector = MagicMock()
        recognizer = MagicMock()
        recognizer.recognize_regions.return_value = []
        config = MagicMock()
        config.get_regions.return_value = []
        config.get_pokemon_icons.return_value = []
        config.get_stat_modifiers.return_value = []

        machine = PartyRegistrationMachine(
            detector=detector, recognizer=recognizer, config=config,
        )
        machine._state.phase = "done"
        machine._state.screen_results = [
            ScreenResult(
                screen=1,
                regions={"ポケモン１名前": "リザードン"},
                pokemon=[
                    {"position": 1, "pokemon_id": None, "name": None},
                ],
            ),
        ]

        party = machine._build_party_result()
        assert party[0]["pokemon_id"] == 6
        assert party[0]["name"] == "リザードン"

    @patch("app.dependencies.get_game_data", side_effect=RuntimeError)
    def test_merges_two_screens(self, _mock: MagicMock) -> None:
        """画面1と画面2のフィールドがマージされる."""
        detector = MagicMock()
        recognizer = MagicMock()
        recognizer.recognize_regions.return_value = []
        config = MagicMock()
        config.get_regions.return_value = []
        config.get_pokemon_icons.return_value = []
        config.get_stat_modifiers.return_value = []

        machine = PartyRegistrationMachine(
            detector=detector, recognizer=recognizer, config=config,
        )
        machine._state.phase = "done"
        machine._state.screen_results = [
            ScreenResult(
                screen=1,
                regions={"ポケモン１名前": "リザードン", "ポケモン１わざ１": "かえんほうしゃ"},
                pokemon=[{"position": 1, "pokemon_id": 6, "name": "リザードン"}],
            ),
            ScreenResult(
                screen=2,
                regions={"ポケモン１HP実数値": "153", "ポケモン１こうげき実数値": "120"},
                pokemon=[],
            ),
        ]

        party = machine._build_party_result()
        assert len(party) == 1
        fields = party[0]["fields"]
        # 画面1のフィールド
        assert fields["名前"]["raw"] == "リザードン"
        assert fields["わざ１"]["raw"] == "かえんほうしゃ"
        # 画面2のフィールド
        assert fields["HP実数値"]["raw"] == "153"
        assert fields["こうげき実数値"]["raw"] == "120"
