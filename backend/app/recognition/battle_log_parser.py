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

    全ポケモン辞書ではなく6体だけなので低閾値で誤検出しにくい。

    Args:
        name_candidate: OCR で読み取ったポケモン名テキスト。
        party: 相手パーティ情報のリスト。各要素は {"pokemon_key": str, "name": str}。
        threshold: マッチ判定の最低類似度（デフォルト 0.4）。

    Returns:
        {"matched_name": str, "pokemon_key": str, "confidence": float} or None。
    """
    norm = GameData._ocr_normalize
    norm_text = norm(name_candidate.strip())
    if not norm_text:
        return None

    best_name: str = ""
    best_id: str = ""
    best_ratio: float = 0.0

    for member in party:
        if member.get("name") is None:
            continue
        member_key = member.get("pokemon_key", member.get("species_id"))
        if member_key is None:
            continue
        norm_name = norm(member["name"])
        # 完全一致なら即返却
        if norm_text == norm_name:
            return {
                "matched_name": member["name"],
                "pokemon_key": str(member_key),
                "confidence": 1.0,
            }
        ratio = SequenceMatcher(None, norm_text, norm_name).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best_name = member["name"]
            best_id = str(member_key)

    if best_ratio < threshold:
        return None

    return {
        "matched_name": best_name,
        "pokemon_key": best_id,
        "confidence": round(best_ratio, 4),
    }


def match_move_against_learnset(
    move_candidate: str,
    pokemon_key: str,
    game_data: GameData,
    *,
    learnset_threshold: float = 0.88,
) -> dict[str, Any] | None:
    """OCR テキストをポケモンの覚える技リストに照合する.

    learnset で絞り込むことで ~50技 への照合になり、OCR 精度が向上する。
    Champions では覚えない技は使えないため、全辞書フォールバックは行わない。

    Args:
        move_candidate: OCR で読み取った技名テキスト。
        pokemon_key: ポケモンの pokemon_key（learnset 取得用）。
        game_data: GameData インスタンス。
        learnset_threshold: learnset 照合の最低類似度。

    Returns:
        {"matched_name": str, "move_key": str, "confidence": float} or None。
    """
    norm = GameData._ocr_normalize
    norm_text = norm(move_candidate.strip())
    if not norm_text:
        return None

    # learnset 限定マッチング
    learnset_keys = game_data.get_learnset(pokemon_key)
    if learnset_keys:
        # move_key → 日本語名の逆引き
        moves_dict = game_data.names.get("ja", {}).get("moves", {})
        key_to_name: dict[str, str] = {str(move_key): name for name, move_key in moves_dict.items()}

        best_name: str = ""
        best_id: str = ""
        best_ratio: float = 0.0

        for move_key in learnset_keys:
            name = key_to_name.get(move_key)
            if name is None:
                continue
            norm_name = norm(name)
            if norm_text == norm_name:
                return {
                    "matched_name": name,
                    "move_key": move_key,
                    "confidence": 1.0,
                }
            ratio = SequenceMatcher(None, norm_text, norm_name).ratio()
            if ratio > best_ratio:
                best_ratio = ratio
                best_name = name
                best_id = move_key

        if best_ratio >= learnset_threshold:
            return {
                "matched_name": best_name,
                "move_key": best_id,
                "confidence": round(best_ratio, 4),
            }

    return None


@dataclass(frozen=True, slots=True)
class BattleEvent:
    """パース済みバトルイベント."""

    event_type: str
    side: str  # "player" | "opponent"
    raw_text: str
    pokemon_name: str | None = None
    pokemon_key: str | None = None
    move_name: str | None = None
    move_key: str | None = None
    details: dict[str, Any] = field(default_factory=dict)

    @property
    def species_id(self) -> Any:
        return GameData.legacy_value(self.pokemon_key)

    @property
    def move_id(self) -> Any:
        return GameData.legacy_value(self.move_key)

    @property
    def fingerprint(self) -> str:
        """重複排除用のフィンガープリント."""
        if self.event_type == "stat_change":
            stat = self.details.get("stat", "")
            stages = self.details.get("stages", 0)
            return f"{self.event_type}:{self.side}:{self.pokemon_key}:{stat}:{stages}"
        move_fingerprint = self.move_key if self.move_key is not None else self.move_name
        return f"{self.event_type}:{self.side}:{self.pokemon_key}:{move_fingerprint}"

    def to_ws_message(self) -> dict[str, Any]:
        """WebSocket 送信用の dict に変換する."""
        return {
            "type": "battle_event",
            "event_type": self.event_type,
            "side": self.side,
            "raw_text": self.raw_text,
            "pokemon_name": self.pokemon_name,
            "pokemon_key": self.pokemon_key,
            "species_id": self.species_id,
            "move_name": self.move_name,
            "move_key": self.move_key,
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
        pokemon_key = match_result["pokemon_key"]
    else:
        pokemon_name = name_candidate
        pokemon_key = None

    return BattleEvent(
        event_type="pokemon_fainted",
        side=side,
        raw_text=raw_text,
        pokemon_name=pokemon_name,
        pokemon_key=pokemon_key,
    )


# ---------------------------------------------------------------------------
# ステータス変化パターン
# ---------------------------------------------------------------------------

_STAT_NAME_MAP: dict[str, str] = {
    "こうげき": "atk",
    "攻撃": "atk",
    "ぼうぎょ": "def",
    "防御": "def",
    "とくこう": "spa",
    "特攻": "spa",
    "とくぼう": "spd",
    "特防": "spd",
    "すばやさ": "spe",
    "素早さ": "spe",
    "命中率": "accuracy",
    "回避率": "evasion",
}

_STAGE_MAP: dict[str, int] = {
    "上がった": 1,
    "ぐーんと上がった": 2,
    "ぐぐーんと上がった": 3,
    "下がった": -1,
    "がくっと下がった": -2,
    "がくーんと下がった": -3,
}

_STAT_CHANGE_RE = re.compile(
    r"(?:(相手)の\s*)?(.+?)の\s*"
    r"(こうげき|攻撃|ぼうぎょ|防御|とくこう|特攻|とくぼう|特防|"
    r"すばやさ|素早さ|命中率|回避率)"
    r"\s*が\s*"
    r"(ぐぐーんと\s*上がった|ぐーんと\s*上がった|上がった|"
    r"がくーんと\s*下がった|がくっと\s*下がった|下がった)",
)


def _extract_stat_change(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    side = "opponent" if m.group(1) else "player"
    name_candidate = m.group(2).strip()
    stat_jp = m.group(3).strip()
    magnitude_raw = m.group(4).strip()

    if not name_candidate or not stat_jp:
        return None

    stat_key = _STAT_NAME_MAP.get(stat_jp)
    if stat_key is None:
        return None

    # スペースを除去してからステージ数を解決
    magnitude_normalized = re.sub(r"\s+", "", magnitude_raw)
    stages = _STAGE_MAP.get(magnitude_normalized)
    if stages is None:
        return None

    # ポケモン名解決: パーティ限定マッチング → 全辞書フォールバック
    match_result = None
    if side == "opponent":
        party = ctx.get("opponent_party", [])
        if party:
            match_result = match_against_party(name_candidate, party)
    if match_result is None:
        match_result = game_data.fuzzy_match_pokemon_name(name_candidate)

    if match_result is not None:
        pokemon_name = match_result["matched_name"]
        pokemon_key = match_result["pokemon_key"]
    else:
        pokemon_name = name_candidate
        pokemon_key = None

    return BattleEvent(
        event_type="stat_change",
        side=side,
        raw_text=raw_text,
        pokemon_name=pokemon_name,
        pokemon_key=pokemon_key,
        details={"stat": stat_key, "stages": stages},
    )


_PLAYER_SENT_OUT_RE = re.compile(
    r"ゆけ[っつ][っつがぁ]*[！!つ]?\s*(.+)",
)


def _extract_player_sent_out(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    name_candidate = m.group(1).strip()
    if not name_candidate:
        return None

    # プレイヤーパーティ限定マッチングを先に試行
    match_result = None
    party = ctx.get("player_party", [])
    if party:
        match_result = match_against_party(name_candidate, party)

    # パーティマッチング失敗時は全辞書にフォールバック
    if match_result is None:
        match_result = game_data.fuzzy_match_pokemon_name(name_candidate)

    if match_result is not None:
        pokemon_name = match_result["matched_name"]
        pokemon_key = match_result["pokemon_key"]
    else:
        pokemon_name = name_candidate
        pokemon_key = None

    return BattleEvent(
        event_type="player_sent_out",
        side="player",
        raw_text=raw_text,
        pokemon_name=pokemon_name,
        pokemon_key=pokemon_key,
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
        pokemon_key = match_result["pokemon_key"]
    else:
        pokemon_name = name_candidate
        pokemon_key = None

    return BattleEvent(
        event_type="opponent_sent_out",
        side="opponent",
        raw_text=raw_text,
        pokemon_name=pokemon_name,
        pokemon_key=pokemon_key,
        details={"trainer_name": trainer_name},
    )


# ---------------------------------------------------------------------------
# 技使用パターン
# ---------------------------------------------------------------------------

_MOVE_USED_RE = re.compile(r"(?:(相手)の\s*)?(.+?)の\s+(.+?)\s*[!！]")


def _is_non_move_main_text(move_candidate: str) -> bool:
    """「ポケモン名の ○○!」形式だが ○○ がわざ名ではない叙述（あくびのあと等）."""
    s = move_candidate.strip()
    if not s:
        return True
    if "眠気" in s:
        return True
    if "誘つた" in s or "誘った" in s:
        return True
    return False


def _extract_move_used(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    side = "opponent" if m.group(1) else "player"
    name_candidate = m.group(2).strip()
    move_candidate = m.group(3).strip()

    if not name_candidate or not move_candidate:
        return None

    if _is_non_move_main_text(move_candidate):
        return None

    # --- ポケモン名解決 ---
    match_result = None
    if side == "opponent":
        party = ctx.get("opponent_party", [])
        if party:
            match_result = match_against_party(name_candidate, party)
    if match_result is None:
        match_result = game_data.fuzzy_match_pokemon_name(name_candidate)

    if match_result is not None:
        pokemon_name = match_result["matched_name"]
        pokemon_key = match_result["pokemon_key"]
    else:
        pokemon_name = name_candidate
        pokemon_key = None

    # --- わざ名解決（learnset 限定マッチング） ---
    move_result = None
    if pokemon_key is not None:
        move_result = match_move_against_learnset(
            move_candidate, pokemon_key, game_data,
        )
    if move_result is None:
        move_result = game_data.fuzzy_match_move_name(move_candidate)

    # learnset にマッチしなかった場合は生テキストでイベント発行
    move_name = move_result["matched_name"] if move_result else move_candidate
    move_key = move_result["move_key"] if move_result else None

    return BattleEvent(
        event_type="move_used",
        side=side,
        raw_text=raw_text,
        pokemon_name=pokemon_name,
        pokemon_key=pokemon_key,
        move_name=move_name,
        move_key=move_key,
    )


PATTERNS: list[BattleTextPattern] = [
    BattleTextPattern(
        event_type="stat_change",
        regex=_STAT_CHANGE_RE,
        extract=_extract_stat_change,
    ),
    BattleTextPattern(
        event_type="pokemon_fainted",
        regex=_FAINTED_RE,
        extract=_extract_fainted,
    ),
    BattleTextPattern(
        event_type="player_sent_out",
        regex=_PLAYER_SENT_OUT_RE,
        extract=_extract_player_sent_out,
    ),
    BattleTextPattern(
        event_type="opponent_sent_out",
        regex=_OPPONENT_SENT_OUT_RE,
        extract=_extract_opponent_sent_out,
    ),
    BattleTextPattern(
        event_type="move_used",
        regex=_MOVE_USED_RE,
        extract=_extract_move_used,
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
        player_party: list[dict] | None = None,
    ) -> None:
        """OCR リージョン等から得たコンテキスト情報を更新する."""
        if opponent_trainer is not None:
            self._context["opponent_trainer"] = opponent_trainer
        if player_trainer is not None:
            self._context["player_trainer"] = player_trainer
        if opponent_party is not None:
            self._context["opponent_party"] = opponent_party
        if player_party is not None:
            self._context["player_party"] = player_party

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
        pattern_matched = False

        for pattern in PATTERNS:
            m = pattern.regex.search(combined)
            if m is None:
                continue
            event = pattern.extract(m, combined, self._game_data, self._context)
            if event is None:
                continue

            pattern_matched = True

            # 重複排除
            fp = event.fingerprint
            if fp in self._recent_events:
                last_time = self._recent_events[fp]
                if now - last_time < self._dedup_ttl_s:
                    break  # 上位パターンがマッチ済みなら下位パターンも試さない
            self._recent_events[fp] = now
            self._recent_events.move_to_end(fp)
            events.append(event)
            break  # 1フレームにつき最初にマッチしたパターンのみ

        # パターン未マッチ: 未認識イベントを生成（重複排除済みイベントは除く）
        if not events and not pattern_matched:
            fp = f"unrecognized:{combined}"
            if fp not in self._recent_events or (now - self._recent_events[fp]) >= self._dedup_ttl_s:
                self._recent_events[fp] = now
                self._recent_events.move_to_end(fp)
                events.append(BattleEvent(
                    event_type="unrecognized",
                    side="unknown",
                    raw_text=combined,
                ))

        # 古いエントリを刈り込み
        while len(self._recent_events) > self._max_dedup_entries:
            self._recent_events.popitem(last=False)

        return events

    def reset(self) -> None:
        """重複排除状態とコンテキストをリセットする（シーン変更時に呼び出す）."""
        self._recent_events.clear()
        self._last_raw_text = ""
        self._context.clear()
