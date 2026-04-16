"""FieldStateAccumulator のユニットテスト."""

import pytest

from app.recognition.battle_log_parser import BattleEvent
from app.recognition.field_state import FieldStateAccumulator


def _event(event_type: str, side: str = "unknown", **details) -> BattleEvent:
    """テスト用 BattleEvent を簡潔に生成する."""
    return BattleEvent(
        event_type=event_type,
        side=side,
        raw_text="test",
        details=details,
    )


class TestWeatherAccumulation:
    def test_weather_start(self) -> None:
        acc = FieldStateAccumulator()
        changed = acc.apply_event(_event("weather", weather="rain", action="start"))
        assert changed is True
        assert acc.state.weather == "rain"

    def test_weather_end(self) -> None:
        acc = FieldStateAccumulator()
        acc.apply_event(_event("weather", weather="rain", action="start"))
        changed = acc.apply_event(_event("weather", weather="rain", action="end"))
        assert changed is True
        assert acc.state.weather is None

    def test_weather_replaces_weather(self) -> None:
        acc = FieldStateAccumulator()
        acc.apply_event(_event("weather", weather="rain", action="start"))
        changed = acc.apply_event(_event("weather", weather="sun", action="start"))
        assert changed is True
        assert acc.state.weather == "sun"

    def test_duplicate_weather_no_change(self) -> None:
        acc = FieldStateAccumulator()
        acc.apply_event(_event("weather", weather="rain", action="start"))
        changed = acc.apply_event(_event("weather", weather="rain", action="start"))
        assert changed is False

    def test_end_without_start_no_change(self) -> None:
        acc = FieldStateAccumulator()
        changed = acc.apply_event(_event("weather", weather="rain", action="end"))
        assert changed is False


class TestTerrainAccumulation:
    def test_terrain_start(self) -> None:
        acc = FieldStateAccumulator()
        changed = acc.apply_event(_event("terrain", terrain="electric", action="start"))
        assert changed is True
        assert acc.state.terrain == "electric"

    def test_terrain_end(self) -> None:
        acc = FieldStateAccumulator()
        acc.apply_event(_event("terrain", terrain="grassy", action="start"))
        changed = acc.apply_event(_event("terrain", terrain="grassy", action="end"))
        assert changed is True
        assert acc.state.terrain is None

    def test_terrain_replaces_terrain(self) -> None:
        acc = FieldStateAccumulator()
        acc.apply_event(_event("terrain", terrain="grassy", action="start"))
        changed = acc.apply_event(_event("terrain", terrain="psychic", action="start"))
        assert changed is True
        assert acc.state.terrain == "psychic"

    def test_invalid_terrain_ignored(self) -> None:
        acc = FieldStateAccumulator()
        changed = acc.apply_event(_event("terrain", terrain="invalid", action="start"))
        assert changed is False
        assert acc.state.terrain is None


class TestTrickRoomAccumulation:
    def test_trick_room_start(self) -> None:
        acc = FieldStateAccumulator()
        changed = acc.apply_event(_event("field_effect", effect="trick_room", action="start"))
        assert changed is True
        assert acc.state.trick_room is True

    def test_trick_room_end(self) -> None:
        acc = FieldStateAccumulator()
        acc.apply_event(_event("field_effect", effect="trick_room", action="start"))
        changed = acc.apply_event(_event("field_effect", effect="trick_room", action="end"))
        assert changed is True
        assert acc.state.trick_room is False

    def test_duplicate_trick_room_no_change(self) -> None:
        acc = FieldStateAccumulator()
        acc.apply_event(_event("field_effect", effect="trick_room", action="start"))
        changed = acc.apply_event(_event("field_effect", effect="trick_room", action="start"))
        assert changed is False


class TestScreenAccumulation:
    @pytest.mark.parametrize("screen", ["reflect", "light_screen", "aurora_veil"])
    def test_screen_start(self, screen: str) -> None:
        acc = FieldStateAccumulator()
        changed = acc.apply_event(_event("screen", side="player", screen=screen, action="start"))
        assert changed is True
        assert getattr(acc.state.player_side, screen) is True

    @pytest.mark.parametrize("screen", ["reflect", "light_screen", "aurora_veil"])
    def test_screen_end(self, screen: str) -> None:
        acc = FieldStateAccumulator()
        acc.apply_event(_event("screen", side="opponent", screen=screen, action="start"))
        changed = acc.apply_event(_event("screen", side="opponent", screen=screen, action="end"))
        assert changed is True
        assert getattr(acc.state.opponent_side, screen) is False

    def test_screen_side_independent(self) -> None:
        acc = FieldStateAccumulator()
        acc.apply_event(_event("screen", side="player", screen="reflect", action="start"))
        assert acc.state.player_side.reflect is True
        assert acc.state.opponent_side.reflect is False

    def test_unknown_side_ignored(self) -> None:
        acc = FieldStateAccumulator()
        changed = acc.apply_event(_event("screen", side="unknown", screen="reflect", action="start"))
        assert changed is False


class TestTailwindAccumulation:
    def test_tailwind_start(self) -> None:
        acc = FieldStateAccumulator()
        changed = acc.apply_event(_event("tailwind", side="player", action="start"))
        assert changed is True
        assert acc.state.player_side.tailwind is True

    def test_tailwind_end(self) -> None:
        acc = FieldStateAccumulator()
        acc.apply_event(_event("tailwind", side="opponent", action="start"))
        changed = acc.apply_event(_event("tailwind", side="opponent", action="end"))
        assert changed is True
        assert acc.state.opponent_side.tailwind is False


class TestHazardAccumulation:
    def test_stealth_rock_set(self) -> None:
        acc = FieldStateAccumulator()
        changed = acc.apply_event(_event("hazard_set", side="opponent", hazard_type="stealth_rock"))
        assert changed is True
        assert acc.state.opponent_side.stealth_rock is True

    def test_stealth_rock_duplicate_no_change(self) -> None:
        acc = FieldStateAccumulator()
        acc.apply_event(_event("hazard_set", side="opponent", hazard_type="stealth_rock"))
        changed = acc.apply_event(_event("hazard_set", side="opponent", hazard_type="stealth_rock"))
        assert changed is False


class TestReset:
    def test_reset_clears_all(self) -> None:
        acc = FieldStateAccumulator()
        acc.apply_event(_event("weather", weather="rain", action="start"))
        acc.apply_event(_event("terrain", terrain="electric", action="start"))
        acc.apply_event(_event("field_effect", effect="trick_room", action="start"))
        acc.apply_event(_event("screen", side="player", screen="reflect", action="start"))
        acc.apply_event(_event("tailwind", side="opponent", action="start"))
        acc.apply_event(_event("hazard_set", side="opponent", hazard_type="stealth_rock"))

        acc.reset()

        assert acc.state.weather is None
        assert acc.state.terrain is None
        assert acc.state.trick_room is False
        assert acc.state.player_side.reflect is False
        assert acc.state.opponent_side.tailwind is False
        assert acc.state.opponent_side.stealth_rock is False


class TestToDict:
    def test_to_dict_structure(self) -> None:
        acc = FieldStateAccumulator()
        acc.apply_event(_event("weather", weather="sun", action="start"))
        acc.apply_event(_event("screen", side="player", screen="light_screen", action="start"))

        d = acc.to_dict()
        assert d["weather"] == "sun"
        assert d["terrain"] is None
        assert d["trick_room"] is False
        assert d["player_side"]["light_screen"] is True
        assert d["player_side"]["reflect"] is False
        assert d["opponent_side"]["light_screen"] is False


class TestUnrelatedEvents:
    def test_move_used_ignored(self) -> None:
        acc = FieldStateAccumulator()
        changed = acc.apply_event(
            BattleEvent(
                event_type="move_used",
                side="player",
                raw_text="ピカチュウの 10まんボルト！",
                pokemon_name="ピカチュウ",
                move_name="10まんボルト",
            )
        )
        assert changed is False
