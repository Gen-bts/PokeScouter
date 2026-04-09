"""シーン自動判定の階層型ステートマシン.

トップレベル遷移:
    none → pre_match → team_select → team_confirm →(auto) battle → battle_end → pre_match → ...
    none への復帰は手動リセット (reset()) のみ

バトル内サブシーン（可逆）:
    battle（デフォルト） ↔ move_select ↔ pokemon_summary ↔ ...
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class SceneState:
    """シーン状態のイミュータブルなスナップショット."""

    top_level: str
    """トップレベル状態: none / pre_match / team_select / team_confirm / battle / battle_end"""

    sub_scene: str | None = None
    """バトル内サブシーン: None（battle以外）/ move_select / pokemon_summary / ..."""

    confidence: float = 0.0
    """この状態に遷移した際の検出信頼度."""

    timestamp: float = 0.0
    """この状態に遷移した時刻 (time.monotonic)."""

    @property
    def scene_key(self) -> str:
        """RegionConfig のシーン名として使うキー.

        サブシーンがあればそれを返し、なければトップレベルを返す。
        """
        if self.sub_scene and self.sub_scene != self.top_level:
            return self.sub_scene
        return self.top_level


class SceneStateMachine:
    """階層型ステートマシンによるシーン自動判定.

    トップレベルは不可逆な一方向遷移。battle 状態の中でのみ
    サブシーンが可逆的に切り替わる。

    使い方::

        sm = SceneStateMachine()
        candidates = sm.candidates()            # 検出すべきシーン一覧
        detections = detector.detect(frame, candidates)  # テンプレートマッチング
        state = sm.update(detections)           # ステートマシン更新
        print(state.scene_key)                  # OCR に渡すシーン名
    """

    # --- 遷移定義 ---

    TOP_TRANSITIONS: dict[str, list[str]] = {
        "none": ["pre_match"],
        "pre_match": ["team_select"],
        "team_select": ["team_confirm"],
        "team_confirm": [],  # battle へは自動遷移
        "battle": ["battle_end"],
        "battle_end": ["pre_match"],
    }
    """トップレベルの遷移先マッピング."""

    DETECTABLE_STATES: frozenset[str] = frozenset(
        {"pre_match", "team_select", "team_confirm", "battle_end"}
    )
    """画像検出で判定するトップレベル状態（battle は推定なので含まない）."""

    BATTLE_SUB_SCENES: list[str] = ["move_select", "pokemon_summary"]
    """バトル内のサブシーン一覧. regions.json に detection 定義があるもの."""

    # --- デバウンス設定 ---

    TOP_DEBOUNCE: int = 3
    """トップレベル遷移に必要な連続検出フレーム数."""

    SUB_DEBOUNCE: int = 2
    """サブシーン切り替えに必要な連続検出フレーム数."""

    SUB_REVERT_COUNT: int = 3
    """サブシーン未検出がこの回数続いたらデフォルト battle に戻る."""

    def __init__(self, initial: str = "none") -> None:
        self._state = SceneState(
            top_level=initial,
            sub_scene=None,
            confidence=0.0,
            timestamp=time.monotonic(),
        )
        # デバウンス用
        self._pending_top: str | None = None
        self._pending_top_count: int = 0
        self._pending_top_confidence: float = 0.0

        self._pending_sub: str | None = None
        self._pending_sub_count: int = 0
        self._pending_sub_confidence: float = 0.0

        self._no_sub_count: int = 0

    @property
    def state(self) -> SceneState:
        """現在のシーン状態."""
        return self._state

    def candidates(self) -> list[str]:
        """現在の状態から検出を試みるべきシーン候補を返す.

        ステートマシンの遷移制約に基づき、「次に遷移可能な状態」のみを返す。
        """
        top = self._state.top_level
        result: list[str] = []

        # トップレベルの次の遷移先（検出可能なもののみ）
        for next_state in self.TOP_TRANSITIONS.get(top, []):
            if next_state in self.DETECTABLE_STATES:
                result.append(next_state)

        # battle 中はサブシーン + battle_end を検出候補に追加
        if top == "battle":
            result.extend(self.BATTLE_SUB_SCENES)
            if "battle_end" not in result:
                result.append("battle_end")

        return result

    def update(self, detections: dict[str, float]) -> SceneState:
        """検出結果を受け取りステートマシンを更新する.

        Args:
            detections: {scene_key: confidence} 閾値を超えたもののみ。

        Returns:
            更新後の SceneState。
        """
        top = self._state.top_level

        # --- トップレベル遷移の処理 ---
        top_candidate = self._find_top_candidate(detections)
        if top_candidate is not None:
            scene_name, confidence = top_candidate
            if scene_name == self._pending_top:
                self._pending_top_count += 1
                self._pending_top_confidence = max(
                    self._pending_top_confidence, confidence
                )
            else:
                self._pending_top = scene_name
                self._pending_top_count = 1
                self._pending_top_confidence = confidence

            if self._pending_top_count >= self.TOP_DEBOUNCE:
                self._transition_top(scene_name, self._pending_top_confidence)
                self._reset_top_pending()
                return self._state
        else:
            self._reset_top_pending()

        # --- team_confirm → battle 自動遷移 ---
        if top == "team_confirm":
            # team_confirm が確定した直後、即座に battle へ遷移
            self._transition_top("battle", self._state.confidence)
            return self._state

        # --- バトル内サブシーン処理 ---
        if top == "battle":
            sub_candidate = self._find_sub_candidate(detections)
            if sub_candidate is not None:
                scene_name, confidence = sub_candidate
                self._no_sub_count = 0

                if scene_name == self._pending_sub:
                    self._pending_sub_count += 1
                    self._pending_sub_confidence = max(
                        self._pending_sub_confidence, confidence
                    )
                else:
                    self._pending_sub = scene_name
                    self._pending_sub_count = 1
                    self._pending_sub_confidence = confidence

                if self._pending_sub_count >= self.SUB_DEBOUNCE:
                    self._set_sub_scene(scene_name, self._pending_sub_confidence)
                    self._reset_sub_pending()
            else:
                self._reset_sub_pending()
                # サブシーン未検出が続いたらデフォルトに戻す
                if self._state.sub_scene is not None:
                    self._no_sub_count += 1
                    if self._no_sub_count >= self.SUB_REVERT_COUNT:
                        self._set_sub_scene(None, 0.0)
                        self._no_sub_count = 0

        return self._state

    def reset(self) -> None:
        """ステートマシンを初期状態にリセットする."""
        self._state = SceneState(
            top_level="none",
            sub_scene=None,
            confidence=0.0,
            timestamp=time.monotonic(),
        )
        self._reset_top_pending()
        self._reset_sub_pending()
        self._no_sub_count = 0

    # --- 内部ヘルパー ---

    def _find_top_candidate(
        self, detections: dict[str, float]
    ) -> tuple[str, float] | None:
        """検出結果からトップレベル遷移先の候補を探す."""
        top = self._state.top_level
        valid_next = set(self.TOP_TRANSITIONS.get(top, []))

        # battle 中は battle_end も遷移先
        if top == "battle":
            valid_next.add("battle_end")

        best: tuple[str, float] | None = None
        for scene, confidence in detections.items():
            if scene in valid_next and scene in self.DETECTABLE_STATES:
                if best is None or confidence > best[1]:
                    best = (scene, confidence)
        return best

    def _find_sub_candidate(
        self, detections: dict[str, float]
    ) -> tuple[str, float] | None:
        """検出結果からサブシーン候補を探す."""
        best: tuple[str, float] | None = None
        for scene, confidence in detections.items():
            if scene in self.BATTLE_SUB_SCENES:
                if best is None or confidence > best[1]:
                    best = (scene, confidence)
        return best

    def _transition_top(self, new_top: str, confidence: float) -> None:
        """トップレベル状態を遷移させる."""
        now = time.monotonic()
        self._state = SceneState(
            top_level=new_top,
            sub_scene=None,
            confidence=confidence,
            timestamp=now,
        )
        self._reset_sub_pending()
        self._no_sub_count = 0

    def _set_sub_scene(self, sub: str | None, confidence: float) -> None:
        """サブシーンを変更する."""
        self._state = SceneState(
            top_level=self._state.top_level,
            sub_scene=sub,
            confidence=confidence if sub else self._state.confidence,
            timestamp=time.monotonic() if sub != self._state.sub_scene else self._state.timestamp,
        )

    def _reset_top_pending(self) -> None:
        self._pending_top = None
        self._pending_top_count = 0
        self._pending_top_confidence = 0.0

    def _reset_sub_pending(self) -> None:
        self._pending_sub = None
        self._pending_sub_count = 0
        self._pending_sub_confidence = 0.0
