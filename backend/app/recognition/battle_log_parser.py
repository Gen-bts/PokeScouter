"""バトルログパーサー: メインテキストのOCR結果を構造化イベントに変換する.

バトル画面の「メインテキスト１」「メインテキスト２」を結合し、
正規表現パターンでマッチ → fuzzy_match でポケモン名等を解決 → BattleEvent を返す。
"""

from __future__ import annotations

import logging
import re
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Any, Callable

from app.data.game_data import GameData

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# パーティ限定マッチング
# ---------------------------------------------------------------------------

def match_against_party(
    name_candidate: str,
    party: list[dict],
    threshold: float = 0.4,
) -> dict[str, Any] | None:
    """OCR テキストを既知の相手パーティ（6体）に照合する.

    全ポケモン辞書（~4,400体）ではなく6体だけなので低閾値で誤検出しにくい。

    Args:
        name_candidate: OCR で読み取ったポケモン名テキスト。
        party: 相手パーティ情報のリスト。各要素は {"species_id": int, "name": str}。
        threshold: マッチ判定の最低類似度（デフォルト 0.4）。

    Returns:
        {"matched_name": str, "species_id": int, "confidence": float} or None。
    """
    norm = GameData._ocr_normalize
    norm_text = norm(name_candidate.strip())
    if not norm_text:
        return None

    best_name: str = ""
    best_id: int = 0
    best_ratio: float = 0.0

    for member in party:
        if member.get("name") is None:
            continue
        norm_name = norm(member["name"])
        # 完全一致なら即返却
        if norm_text == norm_name:
            return {
                "matched_name": member["name"],
                "species_id": member["species_id"],
                "confidence": 1.0,
            }
        ratio = SequenceMatcher(None, norm_text, norm_name).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best_name = member["name"]
            best_id = member["species_id"]

    if best_ratio < threshold:
        return None

    return {
        "matched_name": best_name,
        "species_id": best_id,
        "confidence": round(best_ratio, 4),
    }


@dataclass(frozen=True, slots=True)
class BattleEvent:
    """パース済みバトルイベント."""

    event_type: str
    side: str  # "player" | "opponent"
    raw_text: str
    pokemon_name: str | None = None
    species_id: int | None = None
    move_name: str | None = None
    move_id: int | None = None
    details: dict[str, Any] = field(default_factory=dict)

    @property
    def fingerprint(self) -> str:
        """重複排除用のフィンガープリント."""
        return f"{self.event_type}:{self.side}:{self.species_id}:{self.move_id}"

    def to_ws_message(self) -> dict[str, Any]:
        """WebSocket 送信用の dict に変換する."""
        return {
            "type": "battle_event",
            "event_type": self.event_type,
            "side": self.side,
            "raw_text": self.raw_text,
            "pokemon_name": self.pokemon_name,
            "species_id": self.species_id,
            "move_name": self.move_name,
            "move_id": self.move_id,
            "details": self.details,
        }


# パーサーから extract 関数へ渡すコンテキスト
ParseContext = dict[str, Any]


@dataclass(frozen=True)
class BattleTextPattern:
    """バトルテキストのマッチパターン定義."""

    event_type: str
    regex: re.Pattern[str]
    extract: Callable[[re.Match, str, GameData, ParseContext], BattleEvent | None]


# ---------------------------------------------------------------------------
# パターン定義
# ---------------------------------------------------------------------------

_FAINTED_RE = re.compile(r"(?:(相手)の\s*)?(.+?)\s*は\s*たおれた")


def _extract_fainted(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    side = "opponent" if m.group(1) else "player"
    name_candidate = m.group(2).strip()
    if not name_candidate:
        return None

    # opponent 側: パーティ限定マッチングを先に試行
    match_result = None
    if side == "opponent":
        party = ctx.get("opponent_party", [])
        if party:
            match_result = match_against_party(name_candidate, party)

    # パーティマッチング失敗時は全辞書にフォールバック
    if match_result is None:
        match_result = game_data.fuzzy_match_pokemon_name(name_candidate)

    if match_result is not None:
        pokemon_name = match_result["matched_name"]
        species_id = match_result["species_id"]
    else:
        pokemon_name = name_candidate
        species_id = None

    return BattleEvent(
        event_type="pokemon_fainted",
        side=side,
        raw_text=raw_text,
        pokemon_name=pokemon_name,
        species_id=species_id,
    )


_OPPONENT_SENT_OUT_RE = re.compile(r"(.+?)が\s*(.+?)\s*を\s*繰り出した")

_TRAINER_NAME_THRESHOLD = 0.5


def _extract_opponent_sent_out(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    ocr_trainer = m.group(1).strip()
    name_candidate = m.group(2).strip()
    if not name_candidate:
        return None

    # 既知の相手トレーナー名と照合して誤検出を防ぐ
    known_opponent = ctx.get("opponent_trainer", "")
    if known_opponent:
        norm = GameData._ocr_normalize
        ratio = SequenceMatcher(
            None, norm(ocr_trainer), norm(known_opponent),
        ).ratio()
        if ratio < _TRAINER_NAME_THRESHOLD:
            return None
        # OCR専用リージョンの方が精度が高いので採用
        trainer_name = known_opponent
    else:
        trainer_name = ocr_trainer

    # パーティ限定マッチングを先に試行
    match_result = None
    party = ctx.get("opponent_party", [])
    if party:
        match_result = match_against_party(name_candidate, party)

    # パーティマッチング失敗時は全辞書にフォールバック
    if match_result is None:
        match_result = game_data.fuzzy_match_pokemon_name(name_candidate)

    if match_result is not None:
        pokemon_name = match_result["matched_name"]
        species_id = match_result["species_id"]
    else:
        pokemon_name = name_candidate
        species_id = None

    return BattleEvent(
        event_type="opponent_sent_out",
        side="opponent",
        raw_text=raw_text,
        pokemon_name=pokemon_name,
        species_id=species_id,
        details={"trainer_name": trainer_name},
    )


PATTERNS: list[BattleTextPattern] = [
    BattleTextPattern(
        event_type="pokemon_fainted",
        regex=_FAINTED_RE,
        extract=_extract_fainted,
    ),
    BattleTextPattern(
        event_type="opponent_sent_out",
        regex=_OPPONENT_SENT_OUT_RE,
        extract=_extract_opponent_sent_out,
    ),
]


# ---------------------------------------------------------------------------
# パーサー本体
# ---------------------------------------------------------------------------

class BattleLogParser:
    """バトルテキストを構造化イベントに変換するステートフルパーサー.

    セッションごとに1インスタンス生成し、重複排除状態を保持する。
    """

    def __init__(
        self,
        game_data: GameData,
        *,
        dedup_ttl_s: float = 5.0,
        max_dedup_entries: int = 50,
    ) -> None:
        self._game_data = game_data
        self._dedup_ttl_s = dedup_ttl_s
        self._max_dedup_entries = max_dedup_entries
        self._recent_events: OrderedDict[str, float] = OrderedDict()
        self._last_raw_text: str = ""
        self._context: ParseContext = {}

    def update_context(
        self,
        *,
        opponent_trainer: str | None = None,
        player_trainer: str | None = None,
        opponent_party: list[dict] | None = None,
    ) -> None:
        """OCR リージョン等から得たコンテキスト情報を更新する."""
        if opponent_trainer is not None:
            self._context["opponent_trainer"] = opponent_trainer
        if player_trainer is not None:
            self._context["player_trainer"] = player_trainer
        if opponent_party is not None:
            self._context["opponent_party"] = opponent_party

    def parse(self, line1: str, line2: str) -> list[BattleEvent]:
        """メインテキスト2行をパースし、構造化イベントのリストを返す.

        Args:
            line1: メインテキスト１のOCRテキスト。
            line2: メインテキスト２のOCRテキスト。

        Returns:
            検出されたイベントのリスト（重複排除済み）。通常0〜1件。
        """
        combined = f"{line1.strip()} {line2.strip()}".strip()
        if not combined:
            return []

        # 高速パス: 前回と同一テキストならスキップ
        if combined == self._last_raw_text:
            return []
        self._last_raw_text = combined

        now = time.monotonic()
        events: list[BattleEvent] = []

        for pattern in PATTERNS:
            m = pattern.regex.search(combined)
            if m is None:
                continue
            event = pattern.extract(m, combined, self._game_data, self._context)
            if event is None:
                continue

            # 重複排除
            fp = event.fingerprint
            if fp in self._recent_events:
                last_time = self._recent_events[fp]
                if now - last_time < self._dedup_ttl_s:
                    continue
            self._recent_events[fp] = now
            self._recent_events.move_to_end(fp)
            events.append(event)
            break  # 1フレームにつき最初にマッチしたパターンのみ

        # 古いエントリを刈り込み
        while len(self._recent_events) > self._max_dedup_entries:
            self._recent_events.popitem(last=False)

        return events

    def reset(self) -> None:
        """重複排除状態をリセットする（シーン変更時に呼び出す）."""
        self._recent_events.clear()
        self._last_raw_text = ""
