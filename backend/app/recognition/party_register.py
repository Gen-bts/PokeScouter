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
import re
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from app.ocr.region import RegionConfig, RegionRecognizer
from app.recognition.move_name_matching import (
    match_move_in_learnset as _match_move_in_learnset,
    pick_best_forms_for_global_fuzzy,
)
from app.recognition.scene_detector import SceneDetector

logger = logging.getLogger(__name__)

SCREEN_SCENES = ["party_screen_1", "party_screen_2"]

DETECTION_DEBOUNCE = 3
"""画面検出に必要な連続フレーム数."""

DETECTION_DEBOUNCE_HIGH_CONF = 2
"""高信頼度（>= 0.95）検出に必要な連続フレーム数."""

HIGH_CONFIDENCE_THRESHOLD = 0.95
"""デバウンス緩和の信頼度閾値."""

DETECTION_TIMEOUT_S = 60.0
"""画面検出のタイムアウト（秒）."""

SLOT_PREFIXES = [
    "ポケモン１", "ポケモン２", "ポケモン３",
    "ポケモン４", "ポケモン５", "ポケモン６",
]
"""リージョン名のスロットプレフィックス（全角数字）."""

_MOVE_FIELD_RE = re.compile(r"^わざ[１２３４５６７８９]$")
"""わざフィールド名の正規表現."""


def _group_regions_by_slot(
    regions: dict[str, str],
) -> dict[int, dict[str, str]]:
    """リージョン辞書をスロットごとにグループ化しプレフィックスを除去する.

    Args:
        regions: {"ポケモン１名前": "リザードン", "ポケモン２特性": "いかく", ...}

    Returns:
        {1: {"名前": "リザードン"}, 2: {"特性": "いかく"}, ...}
    """
    grouped: dict[int, dict[str, str]] = {}
    for key, value in regions.items():
        for i, prefix in enumerate(SLOT_PREFIXES):
            if key.startswith(prefix):
                position = i + 1
                field_name = key[len(prefix):]
                grouped.setdefault(position, {})[field_name] = value
                break
    return grouped


def _no_match(raw_text: str) -> dict[str, Any]:
    return {
        "raw": raw_text,
        "validated": None,
        "confidence": 0.0,
        "matched_id": None,
        "matched_key": None,
    }


def _coerce_legacy_value(value: Any) -> Any:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return value


def _match_ability_for_pokemon(
    ocr_text: str,
    pokemon_key: str,
    game_data: Any,
    threshold: float = 0.6,
) -> dict[str, Any] | None:
    """OCR テキストをポケモンが取りうる特性に照合する.

    Returns:
        fuzzy_match_ability_name 互換の dict、または None。
    """
    from difflib import SequenceMatcher

    from app.data.game_data import GameData

    norm = GameData._ocr_normalize
    norm_text = norm(ocr_text.strip())
    if not norm_text:
        return None

    pdata = game_data.get_pokemon_by_key(pokemon_key)
    if pdata is None:
        return None

    abilities_data = pdata.get("abilities", {})
    ability_keys: list[str] = list(abilities_data.get("normal", []))
    hidden = abilities_data.get("hidden")
    if hidden:
        ability_keys.append(hidden)

    if not ability_keys:
        return None

    abilities_dict = game_data.names.get("ja", {}).get("abilities", {})
    key_to_name: dict[str, str] = {
        str(ability_key): name
        for name, ability_key in abilities_dict.items()
    }

    best_name = ""
    best_key = ""
    best_ratio = 0.0

    for ability_key in ability_keys:
        name = key_to_name.get(ability_key)
        if name is None:
            continue
        norm_name = norm(name)
        if norm_text == norm_name:
            return {
                "matched_name": name,
                "ability_key": ability_key,
                "matched_key": ability_key,
                "ability_id": GameData.legacy_value(ability_key),
                "confidence": 1.0,
            }
        ratio = SequenceMatcher(None, norm_text, norm_name).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best_name = name
            best_key = ability_key

    if best_ratio < threshold:
        return None

    return {
        "matched_name": best_name,
        "ability_key": best_key,
        "matched_key": best_key,
        "ability_id": GameData.legacy_value(best_key),
        "confidence": round(best_ratio, 4),
    }


def _validate_fields(
    fields: dict[str, str],
    pokemon_key: str | None = None,
    game_data: Any | None = None,
) -> dict[str, dict[str, Any]]:
    """スロット内の各フィールドを辞書照合で検証する.

    Args:
        game_data: 呼び出し元で取得済みの GameData（ThreadPool 内では必須に近い）。
            None の場合のみ get_game_data() を呼ぶ（単体テスト用）。

    Returns:
        {"名前": {"raw": "リザードソ", "validated": "リザードン",
                  "confidence": 0.95, "matched_id": 6}, ...}
    """
    if game_data is None:
        try:
            from app.dependencies import get_game_data
            game_data = get_game_data()
        except Exception:
            # GameData 未初期化の場合は検証スキップ
            return {k: _no_match(v) for k, v in fields.items()}

    result: dict[str, dict[str, Any]] = {}
    for name, raw_text in fields.items():
        if name == "名前":
            match = game_data.fuzzy_match_pokemon_name(raw_text)
            if match:
                matched_key = match.get("pokemon_key")
                matched_id = match.get("species_id", _coerce_legacy_value(matched_key))
                result[name] = {
                    "raw": raw_text,
                    "validated": match["matched_name"],
                    "confidence": match["confidence"],
                    "matched_id": matched_id,
                    "matched_key": matched_key or str(matched_id),
                }
            else:
                result[name] = _no_match(raw_text)
        elif _MOVE_FIELD_RE.match(name):
            match = None
            if pokemon_key is not None:
                match = _match_move_in_learnset(raw_text, pokemon_key, game_data)
            if match is None:
                for cand in pick_best_forms_for_global_fuzzy(raw_text):
                    match = game_data.fuzzy_match_move_name(cand)
                    if match is not None:
                        break
            if match is None:
                match = game_data.fuzzy_match_move_name(raw_text)
            if match:
                matched_key = match.get("move_key")
                matched_id = match.get("move_id", _coerce_legacy_value(matched_key))
                move_data = game_data.moves.get(str(matched_key), {}) if matched_key is not None else {}
                result[name] = {
                    "raw": raw_text,
                    "validated": match["matched_name"],
                    "confidence": match["confidence"],
                    "matched_id": matched_id,
                    "matched_key": matched_key or str(matched_id),
                    "move_meta": {
                        "type": move_data.get("type"),
                        "power": move_data.get("power"),
                        "accuracy": move_data.get("accuracy"),
                        "damage_class": move_data.get("damage_class"),
                    } if move_data else None,
                }
            else:
                result[name] = _no_match(raw_text)
        elif name == "特性":
            match = None
            if pokemon_key is not None:
                match = _match_ability_for_pokemon(raw_text, pokemon_key, game_data)
            if match is None:
                match = game_data.fuzzy_match_ability_name(raw_text)
            if match:
                matched_key = match.get("ability_key")
                matched_id = match.get("ability_id", _coerce_legacy_value(matched_key))
                result[name] = {
                    "raw": raw_text,
                    "validated": match["matched_name"],
                    "confidence": match["confidence"],
                    "matched_id": matched_id,
                    "matched_key": matched_key or str(matched_id),
                }
            else:
                result[name] = _no_match(raw_text)
        elif name == "もちもの":
            match = game_data.fuzzy_match_item_name(raw_text)
            if match:
                matched_key = match.get("item_key")
                matched_id = match.get("item_id", _coerce_legacy_value(matched_key))
                item_data = game_data.items.get(str(matched_key), {}) if matched_key is not None else {}
                result[name] = {
                    "raw": raw_text,
                    "validated": match["matched_name"],
                    "confidence": match["confidence"],
                    "matched_id": matched_id,
                    "matched_key": matched_key or str(matched_id),
                    "matched_identifier": item_data.get("identifier") or matched_key or str(matched_id),
                    "is_mega_stone": item_data.get("mega_stone") is not None,
                }
            else:
                result[name] = _no_match(raw_text)
        elif "性格補正" in name:
            # 性格補正: "up" / "down" / 空文字
            cleaned = raw_text.strip()
            if cleaned in ("up", "down"):
                result[name] = {
                    "raw": raw_text,
                    "validated": cleaned,
                    "confidence": 1.0,
                    "matched_id": None,
                    "matched_key": None,
                }
            else:
                result[name] = {
                    "raw": raw_text,
                    "validated": None,
                    "confidence": 1.0,
                    "matched_id": None,
                    "matched_key": None,
                }
        elif "実数値" in name or "努力値" in name:
            # 数値フィールド: int パースで検証
            cleaned = raw_text.strip()
            try:
                int(cleaned)
                result[name] = {
                    "raw": raw_text,
                    "validated": cleaned,
                    "confidence": 1.0,
                    "matched_id": None,
                    "matched_key": None,
                }
            except ValueError:
                result[name] = _no_match(raw_text)
        else:
            result[name] = _no_match(raw_text)
    return result


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
        party_register_config: Any | None = None,
    ) -> None:
        self._detector = detector
        self._recognizer = recognizer
        self._config = config
        self._pokemon_matcher = pokemon_matcher
        self._state = PartyRegistrationState()

        # 設定値（config が渡されなければモジュール定数をフォールバック）
        cfg = party_register_config
        self._detection_debounce: int = (
            cfg.detection_debounce if cfg else DETECTION_DEBOUNCE
        )
        self._detection_debounce_high_conf: int = (
            cfg.detection_debounce_high_conf if cfg else DETECTION_DEBOUNCE_HIGH_CONF
        )
        self._high_confidence_threshold: float = (
            cfg.high_confidence_threshold if cfg else HIGH_CONFIDENCE_THRESHOLD
        )
        self._detection_timeout_s: float = (
            cfg.detection_timeout_s if cfg else DETECTION_TIMEOUT_S
        )

        # デバウンス
        self._pending_scene: str | None = None
        self._pending_count: int = 0

        # タイムアウト
        self._phase_start_time: float = 0.0

        # タイミング計測
        self._registration_start_time: float = 0.0
        self._last_build_timing: dict[str, Any] = {}

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
        self._registration_start_time = time.perf_counter()
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
            if elapsed > self._detection_timeout_s:
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
        h, w = frame.shape[:2]
        detailed = self._detector.detect_detailed(frame, [scene_name])
        for d in detailed:
            logger.info(
                "パーティ検出: scene=%s region=%s matched=%s confidence=%.3f elapsed=%.1fms frame=%dx%d",
                d.scene, d.region_name, d.matched, d.confidence, d.elapsed_ms, w, h,
            )
        detections = {
            d.scene: d.confidence for d in detailed if d.matched
        }
        if scene_name in detections:
            confidence = detections[scene_name]
            if self._pending_scene == scene_name:
                self._pending_count += 1
            else:
                self._pending_scene = scene_name
                self._pending_count = 1

            required = (
                self._detection_debounce_high_conf
                if confidence >= self._high_confidence_threshold
                else self._detection_debounce
            )
            if self._pending_count >= required:
                logger.info(
                    "パーティ登録: %s 検出 (confidence=%.3f)",
                    scene_name, confidence,
                )
                self._state.phase = f"reading_screen{screen_num}"
                self._reset_debounce()
                messages: list[dict[str, Any]] = [
                    {
                        "type": "party_register_progress",
                        "state": f"reading_screen{screen_num}",
                    },
                ]
                # 同じフレームで即座に読み取り実行（次フレーム待ちを排除）
                messages.extend(
                    self._read_screen(frame, scene_name, screen_num),
                )
                return messages
        else:
            self._reset_debounce()

        return []

    def _read_screen(
        self, frame: np.ndarray, scene_name: str, screen_num: int,
    ) -> list[dict[str, Any]]:
        """画面のOCR読み取りとポケモン識別を実行する."""
        t_read_start = time.perf_counter()
        messages: list[dict[str, Any]] = []

        # OCR 読み取り（Screen 2 では Screen 1 で取得済みの名前リージョンを省略）
        regions = self._config.get_regions(scene_name)
        region_data: dict[str, str] = {}
        skip_names: set[str] = set()
        if screen_num == 2 and self._state.screen_results:
            prev = self._state.screen_results[0].regions
            for name, value in prev.items():
                if "名前" in name:
                    skip_names.add(name)
                    region_data[name] = value
            if skip_names:
                regions = [r for r in regions if r.name not in skip_names]
                logger.info(
                    "_read_screen(%d): %d name regions skipped from screen 1",
                    screen_num, len(skip_names),
                )
        ocr_elapsed_ms = 0.0
        ocr_timing: list[dict[str, Any]] = []
        if regions:
            t_ocr = time.perf_counter()
            results = self._recognizer.recognize_regions_batched(frame, regions)
            ocr_elapsed_ms = (time.perf_counter() - t_ocr) * 1000
            for r in results:
                region_data[r.region.name] = r.text
                logger.debug(
                    "  OCR region '%s': %.1fms text='%s'",
                    r.region.name, r.elapsed_ms, r.text[:30],
                )
                ocr_timing.append({
                    "name": r.region.name,
                    "elapsed_ms": round(r.elapsed_ms, 1),
                })
            ocr_sum_ms = sum(r.elapsed_ms for r in results)
            logger.info(
                "_read_screen(%d): OCR %d regions, total=%.1fms (per_region_sum=%.1fms)",
                screen_num, len(results), ocr_elapsed_ms, ocr_sum_ms,
            )

        # 性格補正検出
        modifier_defs = self._config.get_stat_modifiers(scene_name)
        modifier_elapsed_ms = 0.0
        if modifier_defs:
            from app.recognition.stat_modifier import detect_nature_modifiers_batch

            t_mod = time.perf_counter()
            modifiers = detect_nature_modifiers_batch(frame, modifier_defs)
            modifier_elapsed_ms = (time.perf_counter() - t_mod) * 1000
            for name, value in modifiers.items():
                region_data[name] = value if value is not None else ""
            logger.info(
                "_read_screen(%d): stat_modifiers %d regions, %.1fms",
                screen_num, len(modifier_defs), modifier_elapsed_ms,
            )

        # ポケモンアイコン識別
        pokemon_data: list[dict[str, Any]] = []
        icon_elapsed_ms = 0.0
        if self._pokemon_matcher is not None:
            icon_defs = self._config.get_pokemon_icons(scene_name)
            if icon_defs:
                from app.data.names import get_id_to_name
                id_to_name = get_id_to_name()

                positions = [
                    {"x": ic["x"], "y": ic["y"], "w": ic["w"], "h": ic["h"]}
                    for ic in icon_defs
                ]
                t_icon = time.perf_counter()
                icon_results = self._pokemon_matcher.identify_team(frame, positions)
                icon_elapsed_ms = (time.perf_counter() - t_icon) * 1000
                logger.info(
                    "_read_screen(%d): pokemon_icons %d positions, %.1fms",
                    screen_num, len(positions), icon_elapsed_ms,
                )

                for i, ic in enumerate(icon_defs):
                    entry: dict[str, Any] = {
                        "position": i + 1,
                        "name_key": ic["name"],
                    }
                    if i < len(icon_results) and icon_results[i].candidates:
                        best = icon_results[i].candidates[0]
                        threshold = icon_results[i].threshold
                        detailed = icon_results[i]
                        if best.confidence >= threshold and not detailed.is_uncertain:
                            entry["pokemon_key"] = best.pokemon_key
                            entry["pokemon_id"] = best.pokemon_key
                            entry["name"] = id_to_name.get(
                                best.pokemon_key, best.pokemon_key,
                            )
                            entry["confidence"] = round(best.confidence, 3)
                        else:
                            entry["pokemon_key"] = None
                            entry["pokemon_id"] = None
                            entry["name"] = None
                            entry["confidence"] = 0.0
                            if detailed.is_uncertain:
                                logger.info(
                                    "_read_screen(%d): pos %d UNCERTAIN "
                                    "margin=%.4f < %.4f, candidates=%s",
                                    screen_num, i + 1,
                                    detailed.margin, detailed.margin_threshold,
                                    [(c.pokemon_key, round(c.confidence, 3))
                                     for c in detailed.candidates[:3]],
                                )
                    else:
                        entry["pokemon_key"] = None
                        entry["pokemon_id"] = None
                        entry["name"] = None
                        entry["confidence"] = 0.0
                    pokemon_data.append(entry)

        read_total_ms = (time.perf_counter() - t_read_start) * 1000
        logger.info(
            "_read_screen(%d): 合計 %.1fms (OCR=%.1fms, stat_mod=%.1fms, icon=%.1fms)",
            screen_num, read_total_ms, ocr_elapsed_ms, modifier_elapsed_ms, icon_elapsed_ms,
        )

        screen_result = ScreenResult(
            screen=screen_num,
            regions=region_data,
            pokemon=pokemon_data,
        )
        self._state.screen_results.append(screen_result)

        # スロット別にグルーピングして送信
        grouped_slots = _group_regions_by_slot(region_data)
        party_name = region_data.get("パーティ名", "").strip() or None
        messages.append({
            "type": "party_register_screen",
            "screen": screen_num,
            "slots": grouped_slots,
            "pokemon": pokemon_data,
            "party_name": party_name,
            "timing": {
                "read_total_ms": round(read_total_ms, 1),
                "ocr_ms": round(ocr_elapsed_ms, 1),
                "ocr_regions": ocr_timing,
                "stat_modifier_ms": round(modifier_elapsed_ms, 1),
                "pokemon_icon_ms": round(icon_elapsed_ms, 1),
            },
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
            # screen 1 からパーティ名を取得
            complete_party_name = None
            for sr in self._state.screen_results:
                if sr.screen == 1:
                    complete_party_name = sr.regions.get("パーティ名", "").strip() or None
                    break
            total_elapsed_ms = (time.perf_counter() - self._registration_start_time) * 1000
            messages.append({
                "type": "party_register_complete",
                "party": party,
                "party_name": complete_party_name,
                "timing": {
                    **self._last_build_timing,
                    "total_elapsed_ms": round(total_elapsed_ms, 1),
                },
            })
            logger.info(
                "パーティ登録完了: %d体, 合計 %.1fms", len(party), total_elapsed_ms,
            )

        return messages

    def _build_party_result(self) -> list[dict[str, Any]]:
        """全画面の結果を統合してパーティ情報を構築する."""
        t_build = time.perf_counter()

        # 各画面のリージョンをスロット別にグルーピング
        merged_fields: dict[int, dict[str, str]] = {}
        for sr in self._state.screen_results:
            grouped = _group_regions_by_slot(sr.regions)
            for pos, fields in grouped.items():
                merged_fields.setdefault(pos, {}).update(fields)

        # ポケモンアイコン識別結果を position でインデックス化
        icon_by_pos: dict[int, dict[str, Any]] = {}
        for sr in self._state.screen_results:
            for p in sr.pokemon:
                pos = p.get("position", 0)
                if pos >= 1:
                    icon_by_pos[pos] = p

        # パーティリスト構築（スロットを並列バリデーション）
        party: list[dict[str, Any]] = []
        sorted_positions = sorted(merged_fields.keys())

        # ThreadPool ワーカー内で get_game_data() が失敗する環境があるため、
        # 呼び出しスレッドで一度だけ取得して各スロットに渡す。
        shared_gd: Any | None = None
        try:
            from app.dependencies import get_game_data
            shared_gd = get_game_data()
        except Exception:
            shared_gd = None

        def _validate_slot(pos: int) -> tuple[int, dict[str, Any], float]:
            raw_fields = merged_fields[pos]
            # pokemon_key を事前解決（文脈バリデーション用）
            slot_pokemon_key: str | None = None
            icon = icon_by_pos.get(pos, {})
            slot_pokemon_key = icon.get("pokemon_key") or icon.get("pokemon_id")
            if slot_pokemon_key is not None:
                slot_pokemon_key = str(slot_pokemon_key)
            if (
                slot_pokemon_key is None
                and "名前" in raw_fields
                and shared_gd is not None
            ):
                try:
                    name_match = shared_gd.fuzzy_match_pokemon_name(raw_fields["名前"])
                    if name_match:
                        pk = name_match.get("pokemon_key")
                        slot_pokemon_key = str(pk) if pk is not None else None
                except Exception:
                    pass
            t_val = time.perf_counter()
            if shared_gd is None:
                validated = {k: _no_match(v) for k, v in raw_fields.items()}
            else:
                validated = _validate_fields(
                    raw_fields,
                    pokemon_key=slot_pokemon_key,
                    game_data=shared_gd,
                )
            val_ms = (time.perf_counter() - t_val) * 1000
            logger.debug(
                "_validate_fields slot %d: %d fields, pokemon_key=%s, %.1fms",
                pos, len(raw_fields), slot_pokemon_key, val_ms,
            )
            return pos, validated, val_ms

        with ThreadPoolExecutor(max_workers=max(1, len(sorted_positions))) as executor:
            slot_results = list(executor.map(
                _validate_slot, sorted_positions,
            ))

        validate_times: dict[int, float] = {}
        validated_map: dict[int, dict[str, Any]] = {}
        for pos, validated, val_ms in slot_results:
            validate_times[pos] = val_ms
            validated_map[pos] = validated

        for pos in sorted_positions:
            validated = validated_map[pos]

            icon = icon_by_pos.get(pos, {})
            pokemon_key = icon.get("pokemon_key") or icon.get("pokemon_id")
            pokemon_name = icon.get("name")

            # アイコンマッチング失敗時、名前照合結果をフォールバック
            if pokemon_key is None:
                name_field = validated.get("名前", {})
                fallback_key = name_field.get("matched_key")
                if fallback_key is None:
                    fallback_key = name_field.get("matched_id")
                if fallback_key is not None:
                    pokemon_key = fallback_key
                    pokemon_name = name_field.get("validated") or pokemon_name

            party.append({
                "position": pos,
                "pokemon_key": pokemon_key,
                "pokemon_id": _coerce_legacy_value(pokemon_key),
                "name": pokemon_name,
                "fields": validated,
            })

        build_elapsed_ms = (time.perf_counter() - t_build) * 1000
        logger.info(
            "_build_party_result: %d slots, %.1fms", len(party), build_elapsed_ms,
        )
        self._last_build_timing = {
            "build_total_ms": round(build_elapsed_ms, 1),
            "validate_per_slot_ms": {
                pos: round(ms, 1) for pos, ms in validate_times.items()
            },
        }

        return party

    def _reset_debounce(self) -> None:
        self._pending_scene = None
        self._pending_count = 0
