"""バトルフィールド状態アキュムレータ.

BattleEvent を受け取り、天候・テレイン・壁・おいかぜ等の
現在のフィールド状態を蓄積・管理する。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.recognition.battle_log_parser import BattleEvent

_VALID_WEATHERS = frozenset({"snow", "sand", "rain", "sun"})
_VALID_TERRAINS = frozenset({"electric", "grassy", "psychic", "misty"})
_VALID_SCREENS = frozenset({"reflect", "light_screen", "aurora_veil"})


@dataclass
class SideFieldState:
    """サイド別フィールド状態."""

    reflect: bool = False
    light_screen: bool = False
    aurora_veil: bool = False
    tailwind: bool = False
    stealth_rock: bool = False
    spikes: int = 0        # 0-3（将来用）
    toxic_spikes: int = 0  # 0-2（将来用）

    def to_dict(self) -> dict[str, Any]:
        return {
            "reflect": self.reflect,
            "light_screen": self.light_screen,
            "aurora_veil": self.aurora_veil,
            "tailwind": self.tailwind,
            "stealth_rock": self.stealth_rock,
            "spikes": self.spikes,
            "toxic_spikes": self.toxic_spikes,
        }


@dataclass
class FieldState:
    """グローバル + サイド別フィールド状態."""

    weather: str | None = None
    terrain: str | None = None
    trick_room: bool = False
    player_side: SideFieldState = field(default_factory=SideFieldState)
    opponent_side: SideFieldState = field(default_factory=SideFieldState)

    def to_dict(self) -> dict[str, Any]:
        return {
            "weather": self.weather,
            "terrain": self.terrain,
            "trick_room": self.trick_room,
            "player_side": self.player_side.to_dict(),
            "opponent_side": self.opponent_side.to_dict(),
        }


class FieldStateAccumulator:
    """BattleEvent からフィールド状態を蓄積する."""

    def __init__(self) -> None:
        self._state = FieldState()

    @property
    def state(self) -> FieldState:
        return self._state

    def reset(self) -> None:
        """状態をリセットする（新しい試合開始時）."""
        self._state = FieldState()

    def to_dict(self) -> dict[str, Any]:
        """WebSocket 送信用の dict."""
        return self._state.to_dict()

    def apply_event(self, event: BattleEvent) -> bool:
        """BattleEvent を適用する. 状態が変化した場合 True を返す."""
        et = event.event_type
        details = event.details or {}

        if et == "weather":
            return self._apply_weather(details)
        if et == "terrain":
            return self._apply_terrain(details)
        if et == "field_effect":
            return self._apply_field_effect(details)
        if et == "screen":
            return self._apply_screen(event.side, details)
        if et == "tailwind":
            return self._apply_tailwind(event.side, details)
        if et == "hazard_set":
            return self._apply_hazard_set(event.side, details)
        return False

    def _apply_weather(self, details: dict[str, Any]) -> bool:
        weather = details.get("weather")
        action = details.get("action")
        if action == "start" and weather in _VALID_WEATHERS:
            if self._state.weather == weather:
                return False
            self._state.weather = weather
            return True
        if action == "end":
            if self._state.weather is None:
                return False
            self._state.weather = None
            return True
        return False

    def _apply_terrain(self, details: dict[str, Any]) -> bool:
        terrain = details.get("terrain")
        action = details.get("action")
        if action == "start" and terrain in _VALID_TERRAINS:
            if self._state.terrain == terrain:
                return False
            self._state.terrain = terrain
            return True
        if action == "end":
            if self._state.terrain is None:
                return False
            self._state.terrain = None
            return True
        return False

    def _apply_field_effect(self, details: dict[str, Any]) -> bool:
        effect = details.get("effect")
        action = details.get("action")
        if effect == "trick_room":
            new_val = action == "start"
            if self._state.trick_room == new_val:
                return False
            self._state.trick_room = new_val
            return True
        return False

    def _apply_screen(self, side: str, details: dict[str, Any]) -> bool:
        screen = details.get("screen")
        action = details.get("action")
        if screen not in _VALID_SCREENS:
            return False
        side_state = self._get_side(side)
        if side_state is None:
            return False
        new_val = action == "start"
        attr = screen  # "reflect", "light_screen", "aurora_veil"
        if getattr(side_state, attr) == new_val:
            return False
        setattr(side_state, attr, new_val)
        return True

    def _apply_tailwind(self, side: str, details: dict[str, Any]) -> bool:
        action = details.get("action")
        side_state = self._get_side(side)
        if side_state is None:
            return False
        new_val = action == "start"
        if side_state.tailwind == new_val:
            return False
        side_state.tailwind = new_val
        return True

    def _apply_hazard_set(self, side: str, details: dict[str, Any]) -> bool:
        hazard = details.get("hazard_type")
        side_state = self._get_side(side)
        if side_state is None:
            return False
        if hazard == "stealth_rock":
            if side_state.stealth_rock:
                return False
            side_state.stealth_rock = True
            return True
        return False

    def _get_side(self, side: str) -> SideFieldState | None:
        if side == "player":
            return self._state.player_side
        if side == "opponent":
            return self._state.opponent_side
        return None
