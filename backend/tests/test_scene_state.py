"""SceneStateMachine のユニットテスト.

GPU 不要。純粋なロジックテスト。
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from app.recognition.scene_state import SceneState, SceneStateMachine


class TestSceneState:
    """SceneState データクラスのテスト."""

    def test_scene_key_top_level(self) -> None:
        state = SceneState(top_level="pre_match")
        assert state.scene_key == "pre_match"

    def test_scene_key_battle_no_sub(self) -> None:
        state = SceneState(top_level="battle")
        assert state.scene_key == "battle"

    def test_scene_key_with_sub_scene(self) -> None:
        state = SceneState(top_level="battle", sub_scene="move_select")
        assert state.scene_key == "move_select"

    def test_scene_key_sub_same_as_top(self) -> None:
        """sub_scene が top_level と同名の場合は top_level を返す."""
        state = SceneState(top_level="battle", sub_scene="battle")
        assert state.scene_key == "battle"


class TestCandidates:
    """candidates() のテスト."""

    def test_pre_match_candidates(self) -> None:
        sm = SceneStateMachine(initial="pre_match")
        candidates = sm.candidates()
        assert "team_select" in candidates
        assert "battle_end" not in candidates

    def test_team_select_candidates(self) -> None:
        sm = SceneStateMachine(initial="team_select")
        candidates = sm.candidates()
        assert "team_confirm" in candidates
        assert "team_select" not in candidates

    def test_battle_candidates_include_sub_scenes(self) -> None:
        sm = SceneStateMachine(initial="battle")
        candidates = sm.candidates()
        assert "battle_end" in candidates
        assert "move_select" in candidates
        assert "pokemon_summary" in candidates
        assert "battle_Neutral" in candidates
        assert "team_select" not in candidates

    def test_none_candidates(self) -> None:
        sm = SceneStateMachine(initial="none")
        candidates = sm.candidates()
        assert "pre_match" in candidates
        assert len(candidates) == 1

    def test_battle_end_candidates(self) -> None:
        sm = SceneStateMachine(initial="battle_end")
        candidates = sm.candidates()
        assert "pre_match" in candidates
        assert "battle" not in candidates


class TestTopLevelTransitions:
    """トップレベル遷移のテスト."""

    def _advance(self, sm: SceneStateMachine, scene: str, confidence: float = 0.9) -> None:
        """デバウンス分のフレームを送って遷移を確定させる."""
        for _ in range(sm.TOP_DEBOUNCE):
            sm.update({scene: confidence})

    def test_full_match_cycle(self) -> None:
        """none → pre_match → ... → battle_end → pre_match（次の試合へ）."""
        sm = SceneStateMachine()
        assert sm.state.top_level == "none"

        # none → pre_match
        self._advance(sm, "pre_match")
        assert sm.state.top_level == "pre_match"

        # pre_match → team_select
        self._advance(sm, "team_select")
        assert sm.state.top_level == "team_select"

        # team_select → team_confirm
        self._advance(sm, "team_confirm")
        assert sm.state.top_level == "team_confirm"

        # team_confirm → battle（自動遷移）
        sm.update({})  # 空の検出でも team_confirm から battle へ自動遷移
        assert sm.state.top_level == "battle"

        # battle → battle_end
        self._advance(sm, "battle_end")
        assert sm.state.top_level == "battle_end"

        # battle_end → pre_match（次の試合）
        self._advance(sm, "pre_match")
        assert sm.state.top_level == "pre_match"

    def test_invalid_transition_ignored(self) -> None:
        """遷移先でない状態の検出は無視される."""
        sm = SceneStateMachine(initial="pre_match")
        # pre_match から直接 battle_end への遷移は無効
        for _ in range(10):
            sm.update({"battle_end": 0.99})
        assert sm.state.top_level == "pre_match"

    def test_debounce_prevents_premature_transition(self) -> None:
        """デバウンス回数未満では遷移しない."""
        sm = SceneStateMachine(initial="pre_match")
        for _ in range(sm.TOP_DEBOUNCE - 1):
            sm.update({"team_select": 0.95})
        assert sm.state.top_level == "pre_match"

        # あと1回で遷移
        sm.update({"team_select": 0.95})
        assert sm.state.top_level == "team_select"

    def test_debounce_resets_on_different_detection(self) -> None:
        """異なるシーンが検出されるとデバウンスカウントがリセットされる."""
        sm = SceneStateMachine(initial="battle")
        # battle_end を 2 回検出
        sm.update({"battle_end": 0.9})
        sm.update({"battle_end": 0.9})
        # 間に空の検出が入る → リセット
        sm.update({})
        # また battle_end を 2 回 → まだ遷移しない（TOP_DEBOUNCE=3 なので）
        sm.update({"battle_end": 0.9})
        sm.update({"battle_end": 0.9})
        assert sm.state.top_level == "battle"
        # 3 回連続で遷移
        sm.update({"battle_end": 0.9})
        assert sm.state.top_level == "battle_end"


class TestTeamConfirmAutoTransition:
    """team_confirm → battle の自動遷移テスト."""

    def test_auto_transition_to_battle(self) -> None:
        sm = SceneStateMachine(initial="team_confirm")
        # team_confirm にいる場合、update() を呼ぶと即座に battle へ遷移
        sm.update({})
        assert sm.state.top_level == "battle"
        assert sm.state.sub_scene is None

    def test_after_team_confirm_detection(self) -> None:
        sm = SceneStateMachine(initial="team_select")
        # team_confirm を検出 → debounce 後に team_confirm → 次の update で battle
        for _ in range(sm.TOP_DEBOUNCE):
            sm.update({"team_confirm": 0.92})
        # team_confirm に遷移した直後、同じ update 内で battle へ自動遷移
        # （_transition_top で team_confirm に遷移 → 次フレームで battle へ）
        # 実際には team_confirm 遷移後の次の update() で battle になる
        assert sm.state.top_level in ("team_confirm", "battle")
        sm.update({})
        assert sm.state.top_level == "battle"


class TestBattleSubScenes:
    """バトル内サブシーンのテスト."""

    def test_sub_scene_detection(self) -> None:
        sm = SceneStateMachine(initial="battle")
        for _ in range(sm.SUB_DEBOUNCE):
            sm.update({"move_select": 0.88})
        assert sm.state.top_level == "battle"
        assert sm.state.sub_scene == "move_select"
        assert sm.state.scene_key == "move_select"

    def test_sub_scene_switch(self) -> None:
        sm = SceneStateMachine(initial="battle")
        # move_select に遷移
        for _ in range(sm.SUB_DEBOUNCE):
            sm.update({"move_select": 0.88})
        assert sm.state.sub_scene == "move_select"

        # pokemon_summary に遷移
        for _ in range(sm.SUB_DEBOUNCE):
            sm.update({"pokemon_summary": 0.90})
        assert sm.state.sub_scene == "pokemon_summary"

    def test_sub_scene_reverts_on_no_detection(self) -> None:
        sm = SceneStateMachine(initial="battle")
        # move_select に遷移
        for _ in range(sm.SUB_DEBOUNCE):
            sm.update({"move_select": 0.88})
        assert sm.state.sub_scene == "move_select"

        # 未検出が SUB_REVERT_COUNT 回続くとデフォルトに戻る
        for _ in range(sm.SUB_REVERT_COUNT):
            sm.update({})
        assert sm.state.sub_scene is None
        assert sm.state.scene_key == "battle"

    def test_battle_neutral_detection(self) -> None:
        """battle_Neutral がサブシーンとして検出される."""
        sm = SceneStateMachine(initial="battle")
        for _ in range(sm.SUB_DEBOUNCE):
            sm.update({"battle_Neutral": 0.9})
        assert sm.state.top_level == "battle"
        assert sm.state.sub_scene == "battle_Neutral"
        assert sm.state.scene_key == "battle_Neutral"

    def test_battle_neutral_reverts_to_battle(self) -> None:
        """battle_Neutral 未検出が続くとデフォルト（sub_scene=None）に戻る."""
        sm = SceneStateMachine(initial="battle")
        for _ in range(sm.SUB_DEBOUNCE):
            sm.update({"battle_Neutral": 0.9})
        assert sm.state.sub_scene == "battle_Neutral"

        for _ in range(sm.SUB_REVERT_COUNT):
            sm.update({})
        assert sm.state.sub_scene is None
        assert sm.state.scene_key == "battle"

    def test_battle_neutral_to_move_select(self) -> None:
        """battle_Neutral から move_select へのサブシーン切り替え."""
        sm = SceneStateMachine(initial="battle")
        for _ in range(sm.SUB_DEBOUNCE):
            sm.update({"battle_Neutral": 0.9})
        assert sm.state.sub_scene == "battle_Neutral"

        for _ in range(sm.SUB_DEBOUNCE):
            sm.update({"move_select": 0.88})
        assert sm.state.sub_scene == "move_select"

    def test_battle_end_from_sub_scene(self) -> None:
        """サブシーン中でも battle_end を検出できる."""
        sm = SceneStateMachine(initial="battle")
        for _ in range(sm.SUB_DEBOUNCE):
            sm.update({"move_select": 0.88})
        assert sm.state.sub_scene == "move_select"

        # battle_end をデバウンス分検出
        for _ in range(sm.TOP_DEBOUNCE):
            sm.update({"battle_end": 0.95})
        assert sm.state.top_level == "battle_end"
        assert sm.state.sub_scene is None


class TestReset:
    """reset() のテスト."""

    def test_reset_returns_to_initial(self) -> None:
        sm = SceneStateMachine(initial="battle")
        sm.update({"battle_end": 0.9})
        sm.reset()
        assert sm.state.top_level == "none"
        assert sm.state.sub_scene is None

    def test_reset_clears_pending(self) -> None:
        sm = SceneStateMachine(initial="pre_match")
        # デバウンス途中
        sm.update({"team_select": 0.9})
        sm.reset()
        # リセット後は none に戻り、デバウンスもクリアされる
        assert sm.state.top_level == "none"
        # 1回の検出では遷移しない
        sm.update({"pre_match": 0.9})
        assert sm.state.top_level == "none"


class TestConfidence:
    """信頼度の記録テスト."""

    def test_confidence_stored(self) -> None:
        sm = SceneStateMachine(initial="pre_match")
        for _ in range(sm.TOP_DEBOUNCE):
            sm.update({"team_select": 0.93})
        assert sm.state.confidence == pytest.approx(0.93)

    def test_highest_confidence_kept(self) -> None:
        sm = SceneStateMachine(initial="pre_match")
        sm.update({"team_select": 0.85})
        sm.update({"team_select": 0.95})
        sm.update({"team_select": 0.90})
        assert sm.state.confidence == pytest.approx(0.95)


class TestForceCooldown:
    """force_transition() クールダウンのテスト."""

    def test_force_sets_cooldown(self) -> None:
        sm = SceneStateMachine(initial="none")
        sm.force_transition("battle", None)
        assert sm.is_force_cooldown_active()

    def test_cooldown_expires(self) -> None:
        sm = SceneStateMachine(initial="none")
        sm.force_transition("battle", None)
        # クールダウン期限を過去に設定して期限切れをシミュレート
        sm._force_cooldown_until = 0.0
        assert not sm.is_force_cooldown_active()

    def test_reset_clears_cooldown(self) -> None:
        sm = SceneStateMachine(initial="none")
        sm.force_transition("battle", None)
        assert sm.is_force_cooldown_active()
        sm.reset()
        assert not sm.is_force_cooldown_active()

    def test_force_does_not_affect_state(self) -> None:
        """クールダウンは状態遷移自体には影響しない."""
        sm = SceneStateMachine(initial="none")
        sm.force_transition("battle", "move_select")
        assert sm.state.top_level == "battle"
        assert sm.state.sub_scene == "move_select"
        assert sm.state.confidence == 1.0
