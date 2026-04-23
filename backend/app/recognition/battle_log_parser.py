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
from app.recognition.move_name_matching import pick_best_forms_for_global_fuzzy

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# パーティ限定マッチング
# ---------------------------------------------------------------------------

_FORM_SUFFIX_RE = re.compile(r'[(\uff08].+$')


def _strip_form_suffix(name: str) -> str:
    """括弧付きフォルム接尾辞を除去: "ヤドキング(ガラルのすがた)" → "ヤドキング"."""
    return _FORM_SUFFIX_RE.sub('', name)


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
        # フォルム接尾辞を除去して比較（ゲーム内表記はベース名のみ）
        norm_name_stripped = norm(_strip_form_suffix(member["name"]))
        if norm_text == norm_name_stripped:
            return {
                "matched_name": member["name"],
                "pokemon_key": str(member_key),
                "confidence": 1.0,
            }
        ratio = SequenceMatcher(None, norm_text, norm_name_stripped).ratio()
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
        if self.event_type == "status_condition":
            status = self.details.get("status", "")
            phase = self.details.get("phase", "")
            return f"{self.event_type}:{self.side}:{self.pokemon_key}:{status}:{phase}"
        if self.event_type == "weather":
            weather = self.details.get("weather", "")
            action = self.details.get("action", "")
            return f"{self.event_type}:{weather}:{action}"
        if self.event_type == "weather_damage":
            weather = self.details.get("weather", "")
            return f"{self.event_type}:{self.side}:{self.pokemon_key}:{weather}"
        if self.event_type == "field_effect":
            effect = self.details.get("effect", "")
            action = self.details.get("action", "")
            return f"{self.event_type}:{effect}:{action}"
        if self.event_type == "terrain":
            terrain = self.details.get("terrain", "")
            action = self.details.get("action", "")
            return f"{self.event_type}:{terrain}:{action}"
        if self.event_type == "screen":
            screen = self.details.get("screen", "")
            action = self.details.get("action", "")
            return f"{self.event_type}:{self.side}:{screen}:{action}"
        if self.event_type == "tailwind":
            action = self.details.get("action", "")
            return f"{self.event_type}:{self.side}:{action}"
        if self.event_type in {"hazard_set", "hazard_damage"}:
            hazard = self.details.get("hazard_type", "")
            return f"{self.event_type}:{self.side}:{self.pokemon_key}:{hazard}"
        if self.event_type == "type_effectiveness":
            eff = self.details.get("effectiveness", "")
            return f"{self.event_type}:{eff}"
        if self.event_type == "multi_hit":
            hits = self.details.get("hits", 0)
            return f"{self.event_type}:{hits}"
        if self.event_type == "item_triggered":
            item = self.details.get("item_key", self.details.get("item_name", ""))
            return f"{self.event_type}:{self.side}:{self.pokemon_key}:{item}"
        if self.event_type == "mega_stone_revealed":
            stone = self.details.get("stone_key", self.details.get("stone_name", ""))
            return f"{self.event_type}:{self.side}:{self.pokemon_key}:{stone}"
        if self.event_type == "ability_revealed":
            ability = self.details.get("ability_key", self.details.get("ability_name", ""))
            return f"{self.event_type}:{self.side}:{self.pokemon_key}:{ability}"
        if self.event_type == "substitute":
            phase = self.details.get("phase", "")
            return f"{self.event_type}:{self.side}:{self.pokemon_key}:{phase}"
        if self.event_type == "status_damage":
            status = self.details.get("status", "")
            return f"{self.event_type}:{self.side}:{self.pokemon_key}:{status}"
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

_FAINTED_RE = re.compile(
    r"(?:(相手)の\s*)?(.+?)\s*は[\sー\-−一1I|]*\s*たおれた",
)


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
    r"(ぐぐーんと\s*上が[つっ]た|ぐーんと\s*上が[つっ]た|上が[つっ]た|"
    r"がくーんと\s*下が[つっ]た|がく[つっ]と\s*下が[つっ]た|下が[つっ]た)",
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

    # スペース除去 + OCR揺らぎ（大きい「つ」→小さい「っ」）正規化
    magnitude_normalized = re.sub(r"\s+", "", magnitude_raw)
    magnitude_normalized = magnitude_normalized.replace("つた", "った").replace("つと", "っと")
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
    r"ゆけ[っつうづ][っつうづがぁ！!]*\s*(.+)",
)


def _extract_player_sent_out(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    name_candidate = re.sub(r"[!！\s]+$", "", m.group(1).strip())
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


_OPPONENT_SENT_OUT_RE = re.compile(r"(.+?)[がは]\s*(.+?)\s*を\s*繰り?出した")

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
    # OCR rules パイプラインで正規化した候補も含めて照合する
    move_forms = pick_best_forms_for_global_fuzzy(move_candidate)
    move_result = None
    if pokemon_key is not None:
        for form in move_forms:
            move_result = match_move_against_learnset(
                form, pokemon_key, game_data,
            )
            if move_result is not None:
                break
    if move_result is None:
        for form in move_forms:
            move_result = game_data.fuzzy_match_move_name(form)
            if move_result is not None:
                break

    # learnset にマッチしなかった場合は生テキストでイベント発行
    move_name = move_result["matched_name"] if move_result else move_candidate
    move_key = move_result["move_key"] if move_result else None

    # わざの優先度を付加（素早さ推定で使用）
    details: dict[str, Any] = {}
    if move_key is not None:
        move_data = game_data.get_move_by_key(move_key)
        if move_data is not None:
            details["priority"] = move_data.get("priority", 0)

    return BattleEvent(
        event_type="move_used",
        side=side,
        raw_text=raw_text,
        pokemon_name=pokemon_name,
        pokemon_key=pokemon_key,
        move_name=move_name,
        move_key=move_key,
        details=details,
    )


# ---------------------------------------------------------------------------
# ノイズフィルター
# ---------------------------------------------------------------------------

_NOISE_RE = re.compile(
    r"^[\d:.,\-\s!！?？#」広工大金小人]*$"  # タイマー・記号・OCR漢字ゴミ
    r"|^[A-Za-z\d\s.,\-]{1,6}$"             # 短いASCIIゴミ（06:50S 等含む）
)


def _is_noise(text: str) -> bool:
    """OCR ノイズ（タイマー、記号、短い ASCII）を判定する."""
    stripped = text.strip()
    return len(stripped) <= 2 or bool(_NOISE_RE.match(stripped))


# ---------------------------------------------------------------------------
# タイプ相性パターン
# ---------------------------------------------------------------------------

_TYPE_EFFECTIVENESS_RE = re.compile(
    r"効果[はが].*(?:ないようだ|かなり\s*いまひとつ|いまひとつ|"
    r"ち(?:ょう|よう).*[バパ][ツッ].*|大?[バパ][ツッ].*)",
)


def _extract_type_effectiveness(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    kind_jp = re.sub(r"[\s!！…。、ー\-−]", "", raw_text.strip())
    kind_jp = (
        kind_jp
        .replace("効果が", "効果は")
        .replace("ちよう", "ちょう")
        .replace("大バツグン", "バツグン")
        .replace("バッグン", "バツグン")
        .replace("バツダン", "バツグン")
        .replace("バツン", "バツグン")
        .replace("パツグン", "バツグン")
    )
    if "ないようだ" in kind_jp:
        effectiveness = "immune"
    elif "かなりいまひとつ" in kind_jp:
        effectiveness = "double_not_very_effective"
    elif "いまひとつ" in kind_jp:
        effectiveness = "not_very_effective"
    elif "ちょうバツグン" in kind_jp:
        effectiveness = "double_super_effective"
    elif "バツグン" in kind_jp:
        effectiveness = "super_effective"
    else:
        return None
    return BattleEvent(
        event_type="type_effectiveness",
        side="unknown",
        raw_text=raw_text,
        details={"effectiveness": effectiveness},
    )


# ---------------------------------------------------------------------------
# 降参パターン
# ---------------------------------------------------------------------------

_SURRENDER_RE = re.compile(r"降参が\s*選ばれました")


def _extract_surrender(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    return BattleEvent(
        event_type="surrender",
        side="unknown",
        raw_text=raw_text,
    )


# ---------------------------------------------------------------------------
# 天候パターン
# ---------------------------------------------------------------------------

_WEATHER_RE = re.compile(
    r"(雪)が\d?降り始めた"
    r"|(雪)が\d?止んだ"
    r"|(砂あ(?:らし|し))が\d?吹き始めた"
    r"|(砂あ(?:らし|し))が\d?おさま[つっ]た"
    r"|(雨)が\d?降り始めた"
    r"|(雨)が\d?止んだ"
    r"|日差しが\d?(強くな[つっ]た)"
    r"|日差しが\d?(元に戻[つっ]た)",
)

_WEATHER_GROUP_MAP: list[tuple[str, str]] = [
    ("snow", "start"),    # group 1: 雪...降り始めた
    ("snow", "end"),      # group 2: 雪...止んだ
    ("sand", "start"),    # group 3: 砂あらし...吹き始めた
    ("sand", "end"),      # group 4: 砂あらし...おさまった
    ("rain", "start"),    # group 5: 雨...降り始めた
    ("rain", "end"),      # group 6: 雨...止んだ
    ("sun", "start"),     # group 7: 日差し...強くなった
    ("sun", "end"),       # group 8: 日差し...元に戻った
]


def _extract_weather(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    for i, (weather, action) in enumerate(_WEATHER_GROUP_MAP, start=1):
        if m.group(i) is not None:
            return BattleEvent(
                event_type="weather",
                side="unknown",
                raw_text=raw_text,
                details={"weather": weather, "action": action},
            )
    return None


# ---------------------------------------------------------------------------
# テレインパターン
# ---------------------------------------------------------------------------

_TERRAIN_RE = re.compile(
    r"(エレクトリックフィールド)に\d?覆われた"
    r"|(エレクトリックフィールド)が\d?消え(?:去|)\d?った"
    r"|(草原)が\d?広が[つっ]た"
    r"|(草原)が\d?消え(?:去|)\d?った"
    r"|(サイコフィールド)に\d?覆われた"
    r"|(サイコフィールド)が\d?消え(?:去|)\d?った"
    r"|(ミストフィールド)に\d?覆われた"
    r"|(ミストフィールド)が\d?消え(?:去|)\d?った",
)

_TERRAIN_GROUP_MAP: list[tuple[str, str]] = [
    ("electric", "start"),  # group 1
    ("electric", "end"),    # group 2
    ("grassy", "start"),    # group 3
    ("grassy", "end"),      # group 4
    ("psychic", "start"),   # group 5
    ("psychic", "end"),     # group 6
    ("misty", "start"),     # group 7
    ("misty", "end"),       # group 8
]


def _extract_terrain(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    for i, (terrain, action) in enumerate(_TERRAIN_GROUP_MAP, start=1):
        if m.group(i) is not None:
            return BattleEvent(
                event_type="terrain",
                side="unknown",
                raw_text=raw_text,
                details={"terrain": terrain, "action": action},
            )
    return None


# ---------------------------------------------------------------------------
# 壁パターン（リフレクター・ひかりのかべ・オーロラベール）
# ---------------------------------------------------------------------------

_SCREEN_NAME_MAP: dict[str, str] = {
    "リフレクター": "reflect",
    "ひかりのかべ": "light_screen",
    "オーロラベール": "aurora_veil",
}

_SCREEN_SET_RE = re.compile(
    r"(相手)?\s*の?\s*(?:(リフレクター)の壁が|(ひかりのかべ)が|(オーロラベール)に\d?覆われた)",
)

_SCREEN_END_RE = re.compile(
    r"(相手)?\s*の?\s*(?:(リフレクター)|(ひかりのかべ)|(オーロラベール))(?:の効果)?が\d?(?:消えた|切れた|なくな[つっ]た)",
)


def _extract_screen_set(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    side = "opponent" if m.group(1) else "player"
    for i in range(2, 5):
        if m.group(i) is not None:
            screen_key = _SCREEN_NAME_MAP.get(m.group(i))
            if screen_key:
                return BattleEvent(
                    event_type="screen",
                    side=side,
                    raw_text=raw_text,
                    details={"screen": screen_key, "action": "start"},
                )
    return None


def _extract_screen_end(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    side = "opponent" if m.group(1) else "player"
    for i in range(2, 5):
        if m.group(i) is not None:
            screen_key = _SCREEN_NAME_MAP.get(m.group(i))
            if screen_key:
                return BattleEvent(
                    event_type="screen",
                    side=side,
                    raw_text=raw_text,
                    details={"screen": screen_key, "action": "end"},
                )
    return None


# ---------------------------------------------------------------------------
# おいかぜパターン
# ---------------------------------------------------------------------------

_TAILWIND_RE = re.compile(
    r"(相手)?\s*の?\s*(?:(おいかぜ)が\d?吹き始めた|(おいかぜ)が\d?(?:止んだ|やんだ))",
)


def _extract_tailwind(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    side = "opponent" if m.group(1) else "player"
    if m.group(2) is not None:
        action = "start"
    elif m.group(3) is not None:
        action = "end"
    else:
        return None
    return BattleEvent(
        event_type="tailwind",
        side=side,
        raw_text=raw_text,
        details={"action": action},
    )


# ---------------------------------------------------------------------------
# フィールド効果パターン（トリックルーム）
# ---------------------------------------------------------------------------

_TRICK_ROOM_END_RE = re.compile(r"ゆがんだ時空が\d?元に\d?戻[つっ]た")

_TRICK_ROOM_START_RE = re.compile(
    r"(?:(相手)の\s*)?(.+?)は\s*時空を\d?ゆがめた",
)


def _extract_trick_room_end(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    return BattleEvent(
        event_type="field_effect",
        side="unknown",
        raw_text=raw_text,
        details={"effect": "trick_room", "action": "end"},
    )


def _extract_trick_room_start(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    side = "opponent" if m.group(1) else "player"
    name_candidate = m.group(2).strip()

    match_result = _resolve_pokemon_name(name_candidate, side, game_data, ctx)
    pokemon_name = match_result[0]
    pokemon_key = match_result[1]

    return BattleEvent(
        event_type="field_effect",
        side=side,
        raw_text=raw_text,
        pokemon_name=pokemon_name,
        pokemon_key=pokemon_key,
        details={"effect": "trick_room", "action": "start"},
    )


# ---------------------------------------------------------------------------
# ステルスロックパターン
# ---------------------------------------------------------------------------

_HAZARD_SET_RE = re.compile(
    r"(相手)?の?\s*周りに\s*とが[つっ]?(?:た)?岩が\d?(?:た?だよ|だよ)い始めた",
)

_HAZARD_DAMAGE_RE = re.compile(
    r"(?:(相手)の\s*)?(.+?)に\s*とが[つっ]?(?:た)?岩が\d?食い[こコ]んだ",
)


def _extract_hazard_set(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    side = "opponent" if m.group(1) else "player"
    return BattleEvent(
        event_type="hazard_set",
        side=side,
        raw_text=raw_text,
        details={"hazard_type": "stealth_rock"},
    )


def _extract_hazard_damage(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    side = "opponent" if m.group(1) else "player"
    name_candidate = m.group(2).strip()

    match_result = _resolve_pokemon_name(name_candidate, side, game_data, ctx)
    pokemon_name = match_result[0]
    pokemon_key = match_result[1]

    return BattleEvent(
        event_type="hazard_damage",
        side=side,
        raw_text=raw_text,
        pokemon_name=pokemon_name,
        pokemon_key=pokemon_key,
        details={"hazard_type": "stealth_rock"},
    )


# ---------------------------------------------------------------------------
# まきびしパターン
# ---------------------------------------------------------------------------

_SPIKES_SET_RE = re.compile(
    r"(?:(相手)の\s*)?足下に\s*まきびしが\s*散(?:ら)?ば[つっ]た",
)

_SPIKES_DAMAGE_RE = re.compile(
    r"(?:(相手)の\s*)?(.+?)は\s*まきびしの\s*ダメ(?:ージ|ー)?\s*を?\s*受(?:け)?た",
)


def _extract_spikes_set(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    side = "opponent" if m.group(1) else "player"
    return BattleEvent(
        event_type="hazard_set",
        side=side,
        raw_text=raw_text,
        details={"hazard_type": "spikes"},
    )


def _extract_spikes_damage(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    side = "opponent" if m.group(1) else "player"
    name_candidate = m.group(2).strip()
    if not name_candidate:
        return None

    match_result = _resolve_pokemon_name(name_candidate, side, game_data, ctx)
    pokemon_name = match_result[0]
    pokemon_key = match_result[1]

    return BattleEvent(
        event_type="hazard_damage",
        side=side,
        raw_text=raw_text,
        pokemon_name=pokemon_name,
        pokemon_key=pokemon_key,
        details={"hazard_type": "spikes"},
    )


# ---------------------------------------------------------------------------
# 技失敗・命中ミスパターン
# ---------------------------------------------------------------------------

_MOVE_FAILED_RE = re.compile(
    r"しかしうまく決まらなか[つっ]た"
    r"|(?:(相手)の\s*)?(.+?)には?\s*当たらなか[つっ]た",
)


def _extract_move_failed(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    if m.group(2):
        # 「{pokemon}には当たらなかった」パターン
        target_side = "opponent" if m.group(1) else "player"
        name_candidate = m.group(2).strip()
        match_result = _resolve_pokemon_name(name_candidate, target_side, game_data, ctx)
        return BattleEvent(
            event_type="move_failed",
            side=target_side,
            raw_text=raw_text,
            pokemon_name=match_result[0],
            pokemon_key=match_result[1],
            details={"reason": "missed"},
        )
    return BattleEvent(
        event_type="move_failed",
        side="unknown",
        raw_text=raw_text,
        details={"reason": "failed"},
    )


# ---------------------------------------------------------------------------
# 状態異常パターン（ねむり）
# ---------------------------------------------------------------------------

_SLEEP_RE = re.compile(
    r"(?:(相手)の\s*)?(.+?)は\s*(?:眠[つっ]てしま[つっ]た|ぐうぐう眠[つっ]ている)",
)

_DROWSY_RE = re.compile(
    r"(?:(相手)の\s*)?(.+?)の\s*眠気を\s*誘[つっ]た",
)

_CONFUSION_RE = re.compile(
    r"(?:(相手)の\s*)?(.+?)は\s*(?:つかれ果てて\s*)?混乱した",
)


def _extract_sleep(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    side = "opponent" if m.group(1) else "player"
    name_candidate = m.group(2).strip()
    if not name_candidate:
        return None

    match_result = _resolve_pokemon_name(name_candidate, side, game_data, ctx)
    pokemon_name = match_result[0]
    pokemon_key = match_result[1]

    phase = "continuing" if "ぐうぐう" in raw_text else "inflicted"
    return BattleEvent(
        event_type="status_condition",
        side=side,
        raw_text=raw_text,
        pokemon_name=pokemon_name,
        pokemon_key=pokemon_key,
        details={"status": "sleep", "phase": phase},
    )


def _extract_drowsy(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    side = "opponent" if m.group(1) else "player"
    name_candidate = m.group(2).strip()
    if not name_candidate:
        return None

    match_result = _resolve_pokemon_name(name_candidate, side, game_data, ctx)
    pokemon_name = match_result[0]
    pokemon_key = match_result[1]

    return BattleEvent(
        event_type="status_condition",
        side=side,
        raw_text=raw_text,
        pokemon_name=pokemon_name,
        pokemon_key=pokemon_key,
        details={"status": "drowsy", "phase": "inflicted"},
    )


def _extract_confusion(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    side = "opponent" if m.group(1) else "player"
    name_candidate = m.group(2).strip()
    if not name_candidate:
        return None

    match_result = _resolve_pokemon_name(name_candidate, side, game_data, ctx)
    pokemon_name = match_result[0]
    pokemon_key = match_result[1]

    return BattleEvent(
        event_type="status_condition",
        side=side,
        raw_text=raw_text,
        pokemon_name=pokemon_name,
        pokemon_key=pokemon_key,
        details={"status": "confusion", "phase": "inflicted"},
    )


# ---------------------------------------------------------------------------
# まもるパターン
# ---------------------------------------------------------------------------

_PROTECT_RE = re.compile(
    r"(?:(相手)の\s*)?(.+?)は\s*"
    r"(?:守りの体勢に\d?入[つっ]た|攻撃から\d?身を\d?守[つっ]た)",
)


def _extract_protect(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    side = "opponent" if m.group(1) else "player"
    name_candidate = m.group(2).strip()
    if not name_candidate:
        return None

    match_result = _resolve_pokemon_name(name_candidate, side, game_data, ctx)
    pokemon_name = match_result[0]
    pokemon_key = match_result[1]

    phase = "blocked" if "身を" in raw_text else "stance"
    return BattleEvent(
        event_type="protect",
        side=side,
        raw_text=raw_text,
        pokemon_name=pokemon_name,
        pokemon_key=pokemon_key,
        details={"phase": phase},
    )


# ---------------------------------------------------------------------------
# 身代わりパターン
# ---------------------------------------------------------------------------

_SUBSTITUTE_BLOCK_RE = re.compile(
    r"(?:(相手)の\s*)?(.+?)に\s*かわ[つっ]て\s*身代わりが\s*攻撃を\s*受けた",
)

_SUBSTITUTE_BROKEN_RE = re.compile(
    r"(?:(相手)の\s*)?(.+?)の\s*身代わりは\s*消えてしま[つっ]た",
)


def _extract_substitute_block(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    side = "opponent" if m.group(1) else "player"
    name_candidate = m.group(2).strip()
    if not name_candidate:
        return None

    match_result = _resolve_pokemon_name(name_candidate, side, game_data, ctx)
    pokemon_name = match_result[0]
    pokemon_key = match_result[1]

    return BattleEvent(
        event_type="substitute",
        side=side,
        raw_text=raw_text,
        pokemon_name=pokemon_name,
        pokemon_key=pokemon_key,
        details={"phase": "took_hit"},
    )


def _extract_substitute_broken(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    side = "opponent" if m.group(1) else "player"
    name_candidate = m.group(2).strip()
    if not name_candidate:
        return None

    match_result = _resolve_pokemon_name(name_candidate, side, game_data, ctx)
    pokemon_name = match_result[0]
    pokemon_key = match_result[1]

    return BattleEvent(
        event_type="substitute",
        side=side,
        raw_text=raw_text,
        pokemon_name=pokemon_name,
        pokemon_key=pokemon_key,
        details={"phase": "broken"},
    )


# ---------------------------------------------------------------------------
# メガシンカパターン
# ---------------------------------------------------------------------------

_MEGA_EVOLUTION_RE = re.compile(
    r"(?:(相手)の\s*)?(.+?)は\s*メガ(.+?)に[-\-ー−]?メガシンカした",
)


def _extract_mega_evolution(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    side = "opponent" if m.group(1) else "player"
    name_candidate = m.group(2).strip()
    mega_name = f"メガ{m.group(3).strip()}"

    match_result = _resolve_pokemon_name(name_candidate, side, game_data, ctx)
    pokemon_name = match_result[0]
    pokemon_key = match_result[1]

    mega_pokemon_key: str | None = None
    if pokemon_key is not None:
        mega_pokemon_key = game_data.resolve_mega_pokemon_key(pokemon_key, mega_name)

    return BattleEvent(
        event_type="mega_evolution",
        side=side,
        raw_text=raw_text,
        pokemon_name=pokemon_name,
        pokemon_key=pokemon_key,
        details={"mega_name": mega_name, "mega_pokemon_key": mega_pokemon_key},
    )


# ---------------------------------------------------------------------------
# 強制交代パターン
# ---------------------------------------------------------------------------

_FORCED_SWITCH_RE = re.compile(
    r"(?:(相手)の\s*)?(.+?)は\s*戦闘に引き[ずす]\d?[りだ]*された",
)


def _extract_forced_switch(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    side = "opponent" if m.group(1) else "player"
    name_candidate = m.group(2).strip()
    if not name_candidate:
        return None

    match_result = _resolve_pokemon_name(name_candidate, side, game_data, ctx)
    pokemon_name = match_result[0]
    pokemon_key = match_result[1]

    return BattleEvent(
        event_type="forced_switch",
        side=side,
        raw_text=raw_text,
        pokemon_name=pokemon_name,
        pokemon_key=pokemon_key,
        details={"method": "dragged"},
    )


# ---------------------------------------------------------------------------
# ポケモン引っ込め/戻しパターン
# ---------------------------------------------------------------------------

_PLAYER_RECALL_RE = re.compile(r"(.+?)\s*戻れ[!！]?$")

_WITHDREW_RE = re.compile(r"(.+?)[がは]\s*(.+?)を\s*引[つっ]こめた")

_OPPONENT_RETURNING_RE = re.compile(
    r"(?:(相手)の\s*)?(.+?)は\s*.+の元[へえヘ]\d?戻[つっ]ていく",
)


def _extract_player_recall(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    name_candidate = m.group(1).strip()
    if not name_candidate:
        return None

    match_result = _resolve_pokemon_name(name_candidate, "player", game_data, ctx)
    pokemon_name = match_result[0]
    pokemon_key = match_result[1]

    return BattleEvent(
        event_type="pokemon_recalled",
        side="player",
        raw_text=raw_text,
        pokemon_name=pokemon_name,
        pokemon_key=pokemon_key,
        details={"method": "recall"},
    )


def _extract_withdrew(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    name_candidate = m.group(2).strip()
    if not name_candidate:
        return None

    # トレーナー名の部分からside判定
    trainer_part = m.group(1).strip()
    known_opponent = ctx.get("opponent_trainer", "")
    if known_opponent:
        norm = GameData._ocr_normalize
        ratio = SequenceMatcher(None, norm(trainer_part), norm(known_opponent)).ratio()
        side = "opponent" if ratio >= _TRAINER_NAME_THRESHOLD else "player"
    else:
        # コンテキストなし: プレイヤートレーナー名と比較
        known_player = ctx.get("player_trainer", "")
        if known_player:
            norm = GameData._ocr_normalize
            ratio = SequenceMatcher(None, norm(trainer_part), norm(known_player)).ratio()
            side = "player" if ratio >= _TRAINER_NAME_THRESHOLD else "opponent"
        else:
            side = "unknown"

    match_result = _resolve_pokemon_name(name_candidate, side, game_data, ctx)
    pokemon_name = match_result[0]
    pokemon_key = match_result[1]

    return BattleEvent(
        event_type="pokemon_recalled",
        side=side,
        raw_text=raw_text,
        pokemon_name=pokemon_name,
        pokemon_key=pokemon_key,
        details={"method": "withdrew"},
    )


def _extract_opponent_returning(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    side = "opponent" if m.group(1) else "opponent"  # 「元へ戻っていく」は常に相手
    name_candidate = m.group(2).strip()
    if not name_candidate:
        return None

    match_result = _resolve_pokemon_name(name_candidate, side, game_data, ctx)
    pokemon_name = match_result[0]
    pokemon_key = match_result[1]

    return BattleEvent(
        event_type="pokemon_recalled",
        side="opponent",
        raw_text=raw_text,
        pokemon_name=pokemon_name,
        pokemon_key=pokemon_key,
        details={"method": "returning"},
    )


# ---------------------------------------------------------------------------
# 急所・連続ヒットパターン
# ---------------------------------------------------------------------------

_CRITICAL_HIT_RE = re.compile(r"急所に\s*当た[つっ]た")

_MULTI_HIT_RE = re.compile(r"(\d+)\s*回\s*当た[つっ]た")


def _extract_critical_hit(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    return BattleEvent(
        event_type="critical_hit",
        side="unknown",
        raw_text=raw_text,
        details={"critical": True},
    )


def _extract_multi_hit(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    try:
        hits = int(m.group(1))
    except (TypeError, ValueError):
        return None
    return BattleEvent(
        event_type="multi_hit",
        side="unknown",
        raw_text=raw_text,
        details={"hits": hits},
    )


# ---------------------------------------------------------------------------
# 持ち物発動メッセージパターン
# ---------------------------------------------------------------------------

_ITEM_TRIGGER_KEYWORDS = (
    "きあいのタスキ",
    "オボンのみ",
    "いのちのたま",
    "ゴツゴツメット",
    "たべのこし",
    "せんせいのツメ",
    "しろいハーブ",
    "メンタルハーブ",
    "きのみジュース",
    "じゃくてんほけん",
    "とつげきチョッキ",
)

_ITEM_TRIGGERED_RE = re.compile(
    r"(?:(相手)の\s*)?(.+?)は\s*"
    r"(" + "|".join(re.escape(name) for name in _ITEM_TRIGGER_KEYWORDS) + r")"
    r"(?:で\s*もちこたえた|で\s*回復|の\s*効果|が\s*発動|で\s*行動がはやくなった|で\s*行動がはやくな[つっ]た)",
)


def _extract_item_triggered(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    side = "opponent" if m.group(1) else "player"
    name_candidate = m.group(2).strip()
    item_name = m.group(3).strip()
    if not name_candidate or not item_name:
        return None

    match_result = _resolve_pokemon_name(name_candidate, side, game_data, ctx)
    pokemon_name = match_result[0]
    pokemon_key = match_result[1]

    item_key: str | None = None
    item_match = game_data.fuzzy_match_item_name(item_name)
    if item_match is not None:
        item_key = item_match.get("item_key")

    return BattleEvent(
        event_type="item_triggered",
        side=side,
        raw_text=raw_text,
        pokemon_name=pokemon_name,
        pokemon_key=pokemon_key,
        details={"item_name": item_name, "item_key": item_key},
    )


# ---------------------------------------------------------------------------
# メガストーン反応パターン（対戦開始時の所持判明）
# ---------------------------------------------------------------------------

_MEGA_STONE_REVEAL_RE = re.compile(
    r"(?:(相手)の\s*)?(.+?)の\s*(\S+?ナイト[XYZ]?)と\s*"
    r"(?:(?:(相手)の\s*)?(.+?)の\s*(\S+?ナイト[XYZ]?)|.+?の\s*(\S*リング))が\s*反応した",
)


def _extract_mega_stone_revealed(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    first_side = "opponent" if m.group(1) else "player"
    first_pokemon_raw = m.group(2).strip()
    first_stone = m.group(3).strip()
    second_side = "opponent" if m.group(4) else "player"
    second_pokemon_raw = (m.group(5) or "").strip()
    second_stone = (m.group(6) or "").strip()
    ring_name = (m.group(7) or "").strip()
    if not first_pokemon_raw:
        return None

    first_resolved = _resolve_pokemon_name(first_pokemon_raw, first_side, game_data, ctx)
    first_item = game_data.fuzzy_match_item_name(first_stone)
    details: dict[str, Any] = {
        "stone_name": first_stone,
        "stone_key": first_item.get("item_key") if first_item else None,
    }

    if second_pokemon_raw and second_stone:
        second_resolved = _resolve_pokemon_name(second_pokemon_raw, second_side, game_data, ctx)
        second_item = game_data.fuzzy_match_item_name(second_stone)
        details["pairs"] = {
            first_side: {
                "pokemon_name": first_resolved[0],
                "pokemon_key": first_resolved[1],
                "stone_name": first_stone,
                "stone_key": first_item.get("item_key") if first_item else None,
            },
            second_side: {
                "pokemon_name": second_resolved[0],
                "pokemon_key": second_resolved[1],
                "stone_name": second_stone,
                "stone_key": second_item.get("item_key") if second_item else None,
            },
        }
    elif ring_name:
        details["ring_name"] = ring_name

    return BattleEvent(
        event_type="mega_stone_revealed",
        side=first_side,
        raw_text=raw_text,
        pokemon_name=first_resolved[0],
        pokemon_key=first_resolved[1],
        details=details,
    )


# ---------------------------------------------------------------------------
# 天気被害パターン（毎ターンのダメージメッセージ）
# ---------------------------------------------------------------------------

_WEATHER_DAMAGE_RE = re.compile(
    r"(砂あらし|あられ|雪)が\s*"
    r"(?:(相手)の\s*)?(.+?)を\s*襲う",
)

_WEATHER_NAME_MAP: dict[str, str] = {
    "砂あらし": "sand",
    "あられ": "hail",
    "雪": "snow",
}


def _extract_weather_damage(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    weather_jp = m.group(1).strip()
    side = "opponent" if m.group(2) else "player"
    name_candidate = m.group(3).strip()
    if not name_candidate:
        return None

    match_result = _resolve_pokemon_name(name_candidate, side, game_data, ctx)
    pokemon_name = match_result[0]
    pokemon_key = match_result[1]

    return BattleEvent(
        event_type="weather_damage",
        side=side,
        raw_text=raw_text,
        pokemon_name=pokemon_name,
        pokemon_key=pokemon_key,
        details={"weather": _WEATHER_NAME_MAP.get(weather_jp, weather_jp)},
    )


# ---------------------------------------------------------------------------
# 特性表示・状態ダメージパターン
# ---------------------------------------------------------------------------

_ABILITY_REVEALED_RE = re.compile(
    r"(?:(相手)の\s*)?(.+?)は\s*(.+?)を\s*放[つっ]ている",
)

_SUPREME_OVERLORD_RE = re.compile(
    r"(?:(相手)の\s*)?(.+?)は\s*倒された仲間から力をもら[つっ]た",
)

_BURN_DAMAGE_RE = re.compile(
    r"(?:(相手)の\s*)?(.+?)は\s*やけどの\s*ダメ(?:ージ|ー)\s*を?\s*受(?:け)?た",
)


def _extract_ability_revealed(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    side = "opponent" if m.group(1) else "player"
    name_candidate = m.group(2).strip()
    ability_name = m.group(3).strip()
    if not name_candidate or not ability_name:
        return None

    match_result = _resolve_pokemon_name(name_candidate, side, game_data, ctx)
    pokemon_name = match_result[0]
    pokemon_key = match_result[1]
    ability_match = game_data.fuzzy_match_ability_name(ability_name)

    return BattleEvent(
        event_type="ability_revealed",
        side=side,
        raw_text=raw_text,
        pokemon_name=pokemon_name,
        pokemon_key=pokemon_key,
        details={
            "ability_name": ability_match["matched_name"] if ability_match else ability_name,
            "ability_key": ability_match["ability_key"] if ability_match else None,
        },
    )


def _extract_supreme_overlord(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    side = "opponent" if m.group(1) else "player"
    name_candidate = m.group(2).strip()
    if not name_candidate:
        return None

    match_result = _resolve_pokemon_name(name_candidate, side, game_data, ctx)
    pokemon_name = match_result[0]
    pokemon_key = match_result[1]
    ability_match = game_data.fuzzy_match_ability_name("そうだいしょう")

    return BattleEvent(
        event_type="ability_revealed",
        side=side,
        raw_text=raw_text,
        pokemon_name=pokemon_name,
        pokemon_key=pokemon_key,
        details={
            "ability_name": ability_match["matched_name"] if ability_match else "そうだいしょう",
            "ability_key": ability_match["ability_key"] if ability_match else None,
        },
    )


def _extract_burn_damage(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    side = "opponent" if m.group(1) else "player"
    name_candidate = m.group(2).strip()
    if not name_candidate:
        return None

    match_result = _resolve_pokemon_name(name_candidate, side, game_data, ctx)
    pokemon_name = match_result[0]
    pokemon_key = match_result[1]

    return BattleEvent(
        event_type="status_damage",
        side=side,
        raw_text=raw_text,
        pokemon_name=pokemon_name,
        pokemon_key=pokemon_key,
        details={"status": "burn"},
    )


# ---------------------------------------------------------------------------
# ステータスリセットパターン（黒い霧・ミストバースト等）
# ---------------------------------------------------------------------------

_STAT_RESET_RE = re.compile(r"全ての\s*ステータスが\s*元に\s*戻[つっ]た")


def _extract_stat_reset(
    m: re.Match, raw_text: str, game_data: GameData, ctx: ParseContext,
) -> BattleEvent | None:
    return BattleEvent(
        event_type="stat_reset",
        side="unknown",
        raw_text=raw_text,
        details={"reset_type": "all_stats"},
    )


# ---------------------------------------------------------------------------
# ポケモン名解決ヘルパー
# ---------------------------------------------------------------------------

def _resolve_pokemon_name(
    name_candidate: str,
    side: str,
    game_data: GameData,
    ctx: ParseContext,
) -> tuple[str, str | None]:
    """パーティ限定マッチング → 全辞書フォールバックでポケモン名を解決する."""
    match_result = None
    if side == "opponent":
        party = ctx.get("opponent_party", [])
        if party:
            match_result = match_against_party(name_candidate, party)
    elif side == "player":
        party = ctx.get("player_party", [])
        if party:
            match_result = match_against_party(name_candidate, party)
    if match_result is None:
        match_result = game_data.fuzzy_match_pokemon_name(name_candidate)

    if match_result is not None:
        return match_result["matched_name"], match_result["pokemon_key"]
    return name_candidate, None


# ---------------------------------------------------------------------------
# パターン定義リスト（順序重要: 最初にマッチしたパターンが採用される）
# ---------------------------------------------------------------------------

PATTERNS: list[BattleTextPattern] = [
    # --- 固有文字列パターン（衝突リスク低） ---
    BattleTextPattern(
        event_type="surrender",
        regex=_SURRENDER_RE,
        extract=_extract_surrender,
    ),
    BattleTextPattern(
        event_type="critical_hit",
        regex=_CRITICAL_HIT_RE,
        extract=_extract_critical_hit,
    ),
    BattleTextPattern(
        event_type="multi_hit",
        regex=_MULTI_HIT_RE,
        extract=_extract_multi_hit,
    ),
    BattleTextPattern(
        event_type="stat_reset",
        regex=_STAT_RESET_RE,
        extract=_extract_stat_reset,
    ),
    BattleTextPattern(
        event_type="weather",
        regex=_WEATHER_RE,
        extract=_extract_weather,
    ),
    BattleTextPattern(
        event_type="weather_damage",
        regex=_WEATHER_DAMAGE_RE,
        extract=_extract_weather_damage,
    ),
    BattleTextPattern(
        event_type="mega_stone_revealed",
        regex=_MEGA_STONE_REVEAL_RE,
        extract=_extract_mega_stone_revealed,
    ),
    BattleTextPattern(
        event_type="terrain",
        regex=_TERRAIN_RE,
        extract=_extract_terrain,
    ),
    BattleTextPattern(
        event_type="screen",
        regex=_SCREEN_END_RE,
        extract=_extract_screen_end,
    ),
    BattleTextPattern(
        event_type="screen",
        regex=_SCREEN_SET_RE,
        extract=_extract_screen_set,
    ),
    BattleTextPattern(
        event_type="tailwind",
        regex=_TAILWIND_RE,
        extract=_extract_tailwind,
    ),
    BattleTextPattern(
        event_type="field_effect",
        regex=_TRICK_ROOM_END_RE,
        extract=_extract_trick_room_end,
    ),
    BattleTextPattern(
        event_type="hazard_set",
        regex=_HAZARD_SET_RE,
        extract=_extract_hazard_set,
    ),
    BattleTextPattern(
        event_type="hazard_set",
        regex=_SPIKES_SET_RE,
        extract=_extract_spikes_set,
    ),
    BattleTextPattern(
        event_type="type_effectiveness",
        regex=_TYPE_EFFECTIVENESS_RE,
        extract=_extract_type_effectiveness,
    ),
    BattleTextPattern(
        event_type="move_failed",
        regex=_MOVE_FAILED_RE,
        extract=_extract_move_failed,
    ),
    # --- 既存: stat_change は move_used より先 ---
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
    # --- ポケモン名 + 動作パターン ---
    BattleTextPattern(
        event_type="status_condition",
        regex=_SLEEP_RE,
        extract=_extract_sleep,
    ),
    BattleTextPattern(
        event_type="status_condition",
        regex=_DROWSY_RE,
        extract=_extract_drowsy,
    ),
    BattleTextPattern(
        event_type="status_condition",
        regex=_CONFUSION_RE,
        extract=_extract_confusion,
    ),
    BattleTextPattern(
        event_type="protect",
        regex=_PROTECT_RE,
        extract=_extract_protect,
    ),
    BattleTextPattern(
        event_type="substitute",
        regex=_SUBSTITUTE_BROKEN_RE,
        extract=_extract_substitute_broken,
    ),
    BattleTextPattern(
        event_type="substitute",
        regex=_SUBSTITUTE_BLOCK_RE,
        extract=_extract_substitute_block,
    ),
    BattleTextPattern(
        event_type="item_triggered",
        regex=_ITEM_TRIGGERED_RE,
        extract=_extract_item_triggered,
    ),
    BattleTextPattern(
        event_type="hazard_damage",
        regex=_HAZARD_DAMAGE_RE,
        extract=_extract_hazard_damage,
    ),
    BattleTextPattern(
        event_type="hazard_damage",
        regex=_SPIKES_DAMAGE_RE,
        extract=_extract_spikes_damage,
    ),
    BattleTextPattern(
        event_type="field_effect",
        regex=_TRICK_ROOM_START_RE,
        extract=_extract_trick_room_start,
    ),
    BattleTextPattern(
        event_type="mega_evolution",
        regex=_MEGA_EVOLUTION_RE,
        extract=_extract_mega_evolution,
    ),
    BattleTextPattern(
        event_type="forced_switch",
        regex=_FORCED_SWITCH_RE,
        extract=_extract_forced_switch,
    ),
    BattleTextPattern(
        event_type="ability_revealed",
        regex=_SUPREME_OVERLORD_RE,
        extract=_extract_supreme_overlord,
    ),
    BattleTextPattern(
        event_type="ability_revealed",
        regex=_ABILITY_REVEALED_RE,
        extract=_extract_ability_revealed,
    ),
    BattleTextPattern(
        event_type="status_damage",
        regex=_BURN_DAMAGE_RE,
        extract=_extract_burn_damage,
    ),
    # --- 送り出し/戻しパターン ---
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
        event_type="pokemon_recalled",
        regex=_OPPONENT_RETURNING_RE,
        extract=_extract_opponent_returning,
    ),
    BattleTextPattern(
        event_type="pokemon_recalled",
        regex=_WITHDREW_RE,
        extract=_extract_withdrew,
    ),
    BattleTextPattern(
        event_type="pokemon_recalled",
        regex=_PLAYER_RECALL_RE,
        extract=_extract_player_recall,
    ),
    # --- 最も貪欲なパターン → 最後 ---
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

        # ノイズフィルター: タイマー・記号・短いASCIIゴミを無視
        if _is_noise(combined):
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
