"""バトル用 WebSocket ハンドラ.

クライアントから JPEG フレーム（バイナリ）を受信し、
シーン自動判定 → RegionRecognizer で OCR → JSON 結果を返す。
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.data.names import get_id_to_name
from app.dependencies import get_detector, get_game_data, get_pokemon_matcher, get_recognizer, get_settings, ocr_lock
from app.ocr.region import RegionConfig
from app.recognition.battle_log_parser import BattleLogParser, match_against_party
from app.recognition.item_ability_parser import ItemAbilityParser
from app.recognition.party_register import PartyRegistrationMachine
from app.recognition.scene_state import SceneStateMachine
from app.ws.match_logger import BattleMatchLogger

logger = logging.getLogger(__name__)
_audit_logger = logging.getLogger("recognition_audit")
_RECOGNITION_CROP_DIR = Path(__file__).parent.parent.parent.parent / "debug" / "recognition_crops"
_BATTLE_LOG_DIR = Path(__file__).parent.parent.parent.parent / "debug" / "battle_logs"

router = APIRouter()


@dataclass
class BattleSession:
    """WebSocket 接続ごとのセッション状態."""

    scene: str = "battle"
    auto_detect: bool = True
    paused: bool = False
    debug_crops: bool = False
    benchmark: bool = False
    _state_machine: SceneStateMachine = field(default_factory=lambda: SceneStateMachine())
    _party_machine: PartyRegistrationMachine | None = field(default=None, repr=False)
    _last_process_time: float = field(default=0.0, repr=False)
    _last_scene_key: str = field(default="none", repr=False)
    _read_once_cache: dict[str, dict] = field(default_factory=dict, repr=False)
    _pokemon_icon_cache: dict[str, dict] = field(default_factory=dict, repr=False)
    _battle_log_parser: BattleLogParser | None = field(default=None, repr=False)
    _item_ability_parser: ItemAbilityParser | None = field(default=None, repr=False)
    _opponent_party: list[dict] = field(default_factory=list, repr=False)
    _auto_opponent_party: list[dict] = field(default_factory=list, repr=False)
    _manual_opponent_overrides: dict[int, dict] = field(default_factory=dict, repr=False)
    _player_party: list[dict] = field(default_factory=list, repr=False)
    _match_logger: BattleMatchLogger | None = field(default=None, repr=False)

    def _rebuild_opponent_party(self) -> None:
        """自動認識パーティに手動オーバーライドを適用して _opponent_party を再構築."""
        by_pos: dict[int, dict] = {}
        for p in self._auto_opponent_party:
            pos = p.get("position")
            if pos is not None:
                by_pos[pos] = {"pokemon_key": p["pokemon_key"], "name": p["name"]}
        for pos, override in self._manual_opponent_overrides.items():
            by_pos[pos] = {"pokemon_key": override["pokemon_key"], "name": override["name"]}
        self._opponent_party = list(by_pos.values())

    @staticmethod
    def effective_interval_ms(scene_key: str, config: RegionConfig) -> int:
        """現在のシーンに応じた有効インターバル(ms)を返す（regions.json ベース）."""
        return config.get_interval_ms(scene_key)


def _decode_frame(jpeg_bytes: bytes) -> np.ndarray:
    """JPEG バイト列を BGR numpy 配列に変換する."""
    arr = np.frombuffer(jpeg_bytes, dtype=np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError("JPEG フレームのデコードに失敗")
    return frame


def _run_scene_detection(frame: np.ndarray, session: BattleSession) -> dict | None:
    """シーン検出を実行する（同期、to_thread で呼ばれる）.

    Returns:
        シーン変更があった場合は scene_change メッセージ dict、なければ None。
    """
    detector = get_detector()
    sm = session._state_machine

    # 強制遷移クールダウン中は検出をスキップ（スレッド競合防止）
    if sm.is_force_cooldown_active():
        return None

    candidates = sm.candidates()
    detections = detector.detect(frame, candidates) if candidates else {}
    old_state = sm.state
    new_state = sm.update(detections)

    new_key = new_state.scene_key
    if new_key != session._last_scene_key:
        session._last_scene_key = new_key
        return {
            "type": "scene_change",
            "scene": new_key,
            "top_level": new_state.top_level,
            "sub_scene": new_state.sub_scene,
            "confidence": round(new_state.confidence, 3),
        }

    return None


def _save_failed_crop(
    frame: np.ndarray,
    pos: dict[str, int],
    key: str,
) -> None:
    """失敗したポケモン認識のクロップ画像をディスクに保存する."""
    try:
        _RECOGNITION_CROP_DIR.mkdir(parents=True, exist_ok=True)
        x, y, w, h = pos["x"], pos["y"], pos["w"], pos["h"]
        crop = frame[y : y + h, x : x + w]
        if crop.size == 0:
            return
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{timestamp}_{key}.png"
        cv2.imwrite(str(_RECOGNITION_CROP_DIR / filename), crop)
        logger.debug("Failed crop saved: %s", filename)
    except Exception:
        logger.warning("Failed to save crop image for %s", key, exc_info=True)


def _run_pokemon_identification(
    frame: np.ndarray,
    pokemon_icon_cache: dict[str, dict] | None = None,
) -> dict | None:
    """選出画面のポケモン画像認識を実行する（同期、to_thread で呼ばれる）.

    Args:
        frame: BGR フルフレーム画像。
        pokemon_icon_cache: read_once キャッシュ dict（セッション管理）。

    Returns:
        識別結果メッセージ dict。テンプレート未設定時は None。
    """
    matcher = get_pokemon_matcher()
    if matcher.template_count == 0:
        return None

    recognizer = get_recognizer()
    config = recognizer._config

    # regions.json の team_select.pokemon_icons から座標を取得
    scene_def = config._data.get("scenes", {}).get("team_select", {})
    icon_defs = scene_def.get("pokemon_icons", {})

    keys_ordered = sorted(k for k in icon_defs.keys() if not k.startswith("_"))
    if not keys_ordered:
        return None

    # read_once キャッシュ済みアイコンを分離
    to_process_keys: list[str] = []
    to_process_positions: list[dict[str, int]] = []
    cached_results: dict[str, dict] = {}

    for key in keys_ordered:
        pos = icon_defs[key]
        read_once = pos.get("read_once", False)
        if read_once and pokemon_icon_cache is not None and key in pokemon_icon_cache:
            cached_results[key] = pokemon_icon_cache[key]
        else:
            to_process_keys.append(key)
            to_process_positions.append({
                "x": pos["x"], "y": pos["y"],
                "w": pos["w"], "h": pos["h"],
            })

    # 未キャッシュのアイコンのみ識別実行
    t0 = time.perf_counter()
    if to_process_positions:
        results = matcher.identify_team(frame, to_process_positions)
    else:
        results = []
    elapsed = (time.perf_counter() - t0) * 1000

    # 新規結果をキーにマッピング
    fresh_map: dict[str, "DetailedMatchResult"] = {}
    for i, key in enumerate(to_process_keys):
        fresh_map[key] = results[i] if i < len(results) else None

    id_to_name = get_id_to_name()

    # 元の順序で結果リストを構築
    pokemon_list = []
    for idx, key in enumerate(keys_ordered):
        pos = icon_defs[key]
        entry: dict = {
            "position": idx + 1,
            "x": pos["x"],
            "y": pos["y"],
            "w": pos["w"],
            "h": pos["h"],
        }
        if key in cached_results:
            cached = cached_results[key]
            entry["pokemon_key"] = cached.get("pokemon_key", cached["pokemon_id"])
            entry["pokemon_id"] = cached["pokemon_id"]
            entry["name"] = cached["name"]
            entry["confidence"] = cached["confidence"]
            entry["candidates"] = cached.get("candidates", [])
            entry["cached"] = True
        else:
            detailed = fresh_map.get(key)
            if detailed is not None and detailed.candidates:
                best = detailed.candidates[0]
                threshold = detailed.threshold
                if best.confidence >= threshold:
                    entry["pokemon_key"] = best.pokemon_key
                    entry["pokemon_id"] = best.pokemon_key
                    entry["name"] = id_to_name.get(best.pokemon_key, best.pokemon_key)
                    entry["confidence"] = round(best.confidence, 3)
                else:
                    entry["pokemon_key"] = None
                    entry["pokemon_id"] = None
                    entry["name"] = None
                    entry["confidence"] = 0.0
                # 全候補を含める
                entry["candidates"] = [
                    {
                        "pokemon_key": c.pokemon_key,
                        "pokemon_id": c.pokemon_key,
                        "name": id_to_name.get(c.pokemon_key, c.pokemon_key),
                        "confidence": round(c.confidence, 3),
                    }
                    for c in detailed.candidates
                ]
            else:
                entry["pokemon_key"] = None
                entry["pokemon_id"] = None
                entry["name"] = None
                entry["confidence"] = 0.0
                entry["candidates"] = []
            # read_once ならキャッシュに格納
            if pos.get("read_once", False) and pokemon_icon_cache is not None:
                pokemon_icon_cache[key] = {
                    "pokemon_key": entry.get("pokemon_key"),
                    "pokemon_id": entry["pokemon_id"],
                    "name": entry["name"],
                    "confidence": entry["confidence"],
                    "candidates": entry["candidates"],
                }
        # --- ポジション別診断ログ ---
        is_failed = entry["pokemon_id"] is None
        is_cached = entry.get("cached", False)
        confidence = entry.get("confidence", 0.0)

        if is_cached:
            logger.info(
                "  [pos %d] %s CACHED: %s (%.3f)",
                entry["position"], key, entry.get("name", "?"), confidence,
            )
        elif is_failed:
            cands = entry.get("candidates", [])
            best_conf = cands[0]["confidence"] if cands else 0.0
            cands_str = ", ".join(
                f"{c['name']}({c['confidence']:.3f})"
                for c in cands[:3]
            )
            logger.info(
                "  [pos %d] %s FAILED: best=%.3f thr=%.2f candidates=[%s]",
                entry["position"], key, best_conf,
                fresh_map.get(key).threshold if fresh_map.get(key) else 0.60,
                cands_str,
            )
            _save_failed_crop(frame, pos, key)
        else:
            logger.info(
                "  [pos %d] %s OK: %s (%.3f)",
                entry["position"], key, entry["name"], confidence,
            )

        # JSONL 監査レコード
        _audit_logger.info(json.dumps({
            "ts": datetime.now(timezone.utc).isoformat(),
            "event": "pokemon_identify",
            "position": entry["position"],
            "key": key,
            "pokemon_key": entry.get("pokemon_key"),
            "pokemon_id": entry["pokemon_id"],
            "name": entry.get("name"),
            "confidence": confidence,
            "cached": is_cached,
            "failed": is_failed,
            "candidates": entry.get("candidates", []),
        }, ensure_ascii=False))

        pokemon_list.append(entry)

    return {
        "type": "pokemon_identified",
        "pokemon": pokemon_list,
        "elapsed_ms": round(elapsed, 1),
    }


def _extract_player_team(frame: np.ndarray) -> list[dict]:
    """team_select シーンの味方ポケモン1-6 を OCR で読み取る."""
    recognizer = get_recognizer()
    config = recognizer._config
    regions = config.get_regions("team_select")
    team_regions = sorted(
        [r for r in regions if r.name.startswith("味方ポケモン")],
        key=lambda r: r.name,
    )
    results = recognizer.recognize_regions(frame, team_regions)
    return [
        {"position": i + 1, "name": r.text.strip()}
        for i, r in enumerate(results)
    ]


def _extract_team_selection(frame: np.ndarray) -> list[int]:
    """team_confirm シーンの選出判定リージョンを OCR し、選出されたポジションを返す."""
    recognizer = get_recognizer()
    config = recognizer._config
    regions = config.get_regions("team_confirm")
    selection_regions = sorted(
        [r for r in regions if r.name.startswith("ポケモン選出判定")],
        key=lambda r: r.name,
    )
    results = recognizer.recognize_regions(frame, selection_regions)
    return [i + 1 for i, r in enumerate(results) if r.text.strip()]


def _extract_battle_result(frame: np.ndarray) -> str:
    """battle_end の検出リージョン「自分勝敗」を OCR して WIN/LOSE を判定する."""
    recognizer = get_recognizer()
    config = recognizer._config
    detection_regions = config.get_detection_regions("battle_end")
    for dr in detection_regions:
        if dr.name == "自分勝敗":
            cropped = dr.crop(frame)
            pipeline = recognizer._get_pipeline(dr.params.get("engine", "paddle"))
            ocr_results = pipeline.run(cropped)
            text = "".join(r.text for r in ocr_results).upper()
            if "WIN" in text:
                return "win"
            if "LOSE" in text:
                return "lose"
    return "unknown"


def _run_ocr(
    frame: np.ndarray,
    scene: str,
    debug_crops: bool = False,
    read_once_cache: dict[str, dict] | None = None,
) -> dict:
    """同期 OCR 処理（to_thread で呼ばれる）."""
    recognizer = get_recognizer()
    all_regions = recognizer._config.get_regions(scene)
    res = recognizer._config.resolution

    # read_once キャッシュ対応: OCR が必要なリージョンだけ認識する
    to_ocr = []
    for r in all_regions:
        if r.read_once and read_once_cache is not None and r.name in read_once_cache:
            continue  # キャッシュ済み → スキップ
        to_ocr.append(r)

    t0 = time.perf_counter()
    ocr_results_map: dict[str, dict] = {}
    if to_ocr:
        results = recognizer.recognize_regions(frame, to_ocr)
        for r in results:
            avg_confidence = 0.0
            if r.ocr_results:
                avg_confidence = sum(
                    o.confidence for o in r.ocr_results
                ) / len(r.ocr_results)
            region_dict: dict = {
                "name": r.region.name,
                "text": r.text,
                "confidence": round(avg_confidence, 3),
                "elapsed_ms": round(r.elapsed_ms, 1),
                "x": r.region.x,
                "y": r.region.y,
                "w": r.region.w,
                "h": r.region.h,
            }
            if debug_crops:
                cropped = r.region.crop(frame)
                _, buf = cv2.imencode(
                    ".jpg", cropped, [cv2.IMWRITE_JPEG_QUALITY, 80],
                )
                region_dict["crop_b64"] = base64.b64encode(buf).decode("ascii")
            ocr_results_map[r.region.name] = region_dict

            # read_once リージョンの結果をキャッシュに保存
            if r.region.read_once and read_once_cache is not None:
                read_once_cache[r.region.name] = region_dict
    elapsed = (time.perf_counter() - t0) * 1000

    # 元のリージョン順序を維持して結果をマージ
    regions = []
    for r in all_regions:
        if r.name in ocr_results_map:
            regions.append(ocr_results_map[r.name])
        elif read_once_cache is not None and r.name in read_once_cache:
            cached = dict(read_once_cache[r.name])
            cached["elapsed_ms"] = 0.0  # キャッシュヒットなので 0ms
            # debug_crops の場合は現在フレームからクロップ画像を再生成
            if debug_crops:
                cropped = r.crop(frame)
                _, buf = cv2.imencode(
                    ".jpg", cropped, [cv2.IMWRITE_JPEG_QUALITY, 80],
                )
                cached["crop_b64"] = base64.b64encode(buf).decode("ascii")
            regions.append(cached)

    # 検出用リージョンとポケモンアイコン座標をデバッグ用に付加
    detection_regions = [
        {"name": dr.name, "x": dr.x, "y": dr.y, "w": dr.w, "h": dr.h, "method": dr.method}
        for dr in recognizer._config.get_detection_regions(scene)
    ]
    pokemon_icons = recognizer._config.get_pokemon_icons(scene)

    return {
        "type": "ocr_result",
        "scene": scene,
        "elapsed_ms": round(elapsed, 1),
        "resolution": {"width": res[0], "height": res[1]},
        "regions": regions,
        "detection_regions": detection_regions,
        "pokemon_icons": pokemon_icons,
    }


def _run_ocr_benchmark(frame: np.ndarray, scene: str) -> dict:
    """全エンジンで OCR を実行する（ベンチマーク用、to_thread で呼ばれる）."""
    recognizer = get_recognizer()
    t0 = time.perf_counter()
    results = recognizer.recognize_all_engines(frame, scene)
    elapsed = (time.perf_counter() - t0) * 1000

    res = recognizer._config.resolution

    regions = []
    for r in results:
        region = r["region"]
        cropped = region.crop(frame)
        _, buf = cv2.imencode(".jpg", cropped, [cv2.IMWRITE_JPEG_QUALITY, 80])
        regions.append({
            "name": region.name,
            "x": region.x,
            "y": region.y,
            "w": region.w,
            "h": region.h,
            "crop_b64": base64.b64encode(buf).decode("ascii"),
            "engines": {
                e["engine"]: {
                    "text": e["text"],
                    "confidence": e["confidence"],
                    "elapsed_ms": e["elapsed_ms"],
                }
                for e in r["engines"]
            },
        })

    return {
        "type": "benchmark_result",
        "scene": scene,
        "elapsed_ms": round(elapsed, 1),
        "resolution": {"width": res[0], "height": res[1]},
        "regions": regions,
    }


_HP_DIGITS_RE = re.compile(r"\d+")


def _parse_hp_percent(text: str) -> int | None:
    """OCR テキストから HP パーセンテージを解析する.

    "73%", "100", "73％" などの形式に対応。
    """
    cleaned = text.replace("%", "").replace("％", "").strip()
    m = _HP_DIGITS_RE.search(cleaned)
    if m is None:
        return None
    value = int(m.group())
    if 0 <= value <= 100:
        return value
    return None


@router.websocket("/ws/battle")
async def websocket_battle(websocket: WebSocket) -> None:
    """バトル WebSocket エンドポイント."""
    await websocket.accept()
    settings = get_settings()
    session = BattleSession(
        _state_machine=SceneStateMachine(
            scene_state_config=settings.recognition.scene_state,
        ),
        _match_logger=BattleMatchLogger(
            log_dir=_BATTLE_LOG_DIR,
            session_id=uuid.uuid4().hex[:8],
        ),
    )
    frame_queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=2)

    await websocket.send_json({"type": "status", "status": "connected", "message": ""})
    logger.info("WebSocket 接続確立")

    async def receive_loop() -> None:
        """クライアントからのメッセージを受信し振り分ける."""
        while True:
            message = await websocket.receive()

            if message.get("type") == "websocket.disconnect":
                break

            if "bytes" in message and message["bytes"]:
                # バイナリ = JPEG フレーム → キューに積む（古いフレームはドロップ）
                jpeg_data = message["bytes"]
                while not frame_queue.empty():
                    try:
                        frame_queue.get_nowait()
                    except asyncio.QueueEmpty:
                        break
                await frame_queue.put(jpeg_data)

            elif "text" in message and message["text"]:
                # テキスト = JSON 設定メッセージ
                try:
                    data = json.loads(message["text"])
                    if data.get("type") == "config":
                        if "scene" in data:
                            session.scene = data["scene"]
                        if "auto_detect" in data:
                            session.auto_detect = bool(data["auto_detect"])
                        if "paused" in data:
                            session.paused = bool(data["paused"])
                        if "debug_crops" in data:
                            session.debug_crops = bool(data["debug_crops"])
                        if "benchmark" in data:
                            session.benchmark = bool(data["benchmark"])
                        logger.info(
                            "設定更新: scene=%s auto_detect=%s "
                            "paused=%s debug_crops=%s benchmark=%s",
                            session.scene,
                            session.auto_detect,
                            session.paused,
                            session.debug_crops,
                            session.benchmark,
                        )
                    elif data.get("type") == "reset":
                        ml = session._match_logger
                        if ml is not None and ml.is_active:
                            ml.end_match(reason="reset")
                        session._state_machine.reset()
                        session._last_scene_key = "none"
                        session._read_once_cache.clear()
                        session._pokemon_icon_cache.clear()
                        session._opponent_party.clear()
                        session._auto_opponent_party.clear()
                        session._manual_opponent_overrides.clear()
                        session._player_party.clear()
                        if session._battle_log_parser is not None:
                            session._battle_log_parser.reset()
                        if session._item_ability_parser is not None:
                            session._item_ability_parser.reset()
                        logger.info("ステートマシンをリセット")
                        await websocket.send_json({
                            "type": "scene_change",
                            "scene": "none",
                            "top_level": "none",
                            "sub_scene": None,
                            "confidence": 0.0,
                        })
                    elif data.get("type") == "force_scene":
                        target = data.get("scene", "")
                        if not target:
                            logger.warning("空の強制遷移先")
                            continue
                        sub_scenes = set(SceneStateMachine.BATTLE_SUB_SCENES)
                        if target in sub_scenes:
                            top_level, sub_scene = "battle", target
                        else:
                            top_level, sub_scene = target, None
                        new_state = session._state_machine.force_transition(top_level, sub_scene)
                        session._last_scene_key = new_state.scene_key
                        session._read_once_cache.clear()
                        session._pokemon_icon_cache.clear()
                        if session._battle_log_parser is not None:
                            session._battle_log_parser.reset()
                        if session._item_ability_parser is not None:
                            session._item_ability_parser.reset()
                        ml = session._match_logger
                        if ml is not None and ml.is_active and new_state.scene_key == "none":
                            ml.end_match(reason="force_none")
                        logger.info("強制シーン遷移: %s (top=%s, sub=%s)",
                                    new_state.scene_key, top_level, sub_scene)
                        await websocket.send_json({
                            "type": "scene_change",
                            "scene": new_state.scene_key,
                            "top_level": new_state.top_level,
                            "sub_scene": new_state.sub_scene,
                            "confidence": new_state.confidence,
                        })
                    elif data.get("type") == "party_register_start":
                        recognizer = get_recognizer()
                        detector = get_detector()
                        matcher = get_pokemon_matcher()
                        session._party_machine = PartyRegistrationMachine(
                            detector=detector,
                            recognizer=recognizer,
                            config=recognizer._config,
                            pokemon_matcher=matcher,
                            party_register_config=settings.recognition.party_register,
                        )
                        msgs = session._party_machine.start()
                        for m in msgs:
                            await websocket.send_json(m)
                        logger.info("パーティ登録開始")
                    elif data.get("type") == "party_register_cancel":
                        if session._party_machine is not None:
                            msgs = session._party_machine.cancel()
                            for m in msgs:
                                await websocket.send_json(m)
                            session._party_machine = None
                        logger.info("パーティ登録キャンセル")
                    elif data.get("type") == "set_opponent_pokemon":
                        pokemon_key = data.get("pokemon_key", data.get("species_id"))
                        name = data.get("name")
                        position = data.get("position")
                        if pokemon_key is not None and name and position is not None:
                            session._manual_opponent_overrides[position] = {
                                "pokemon_key": pokemon_key,
                                "name": name,
                            }
                            session._rebuild_opponent_party()
                            logger.info(
                                "手動相手ポケモン設定: pos=%s pokemon_key=%s name=%s",
                                position, pokemon_key, name,
                            )
                    elif data.get("type") == "set_player_party":
                        party_list = data.get("party", [])
                        session._player_party = [
                            {
                                "pokemon_key": p.get("pokemon_key", p.get("species_id")),
                                "name": p["name"],
                            }
                            for p in party_list
                            if p.get("pokemon_key", p.get("species_id")) is not None
                        ]
                        logger.info(
                            "プレイヤーパーティ設定: %d体",
                            len(session._player_party),
                        )
                except (json.JSONDecodeError, KeyError, TypeError):
                    logger.warning("不正な設定メッセージを無視")

    async def process_loop() -> None:
        """キューからフレームを取り出してシーン検出 + OCR を実行し結果を返す."""
        while True:
            jpeg_data = await frame_queue.get()

            if session.paused:
                continue

            # インターバル制御（シーン別）
            now = time.monotonic()
            elapsed_since_last = (now - session._last_process_time) * 1000
            # パーティ登録中は高速ポーリング（検出は20-35msで済む）
            if (
                session._party_machine is not None
                and session._party_machine.is_active
            ):
                effective_interval = 100
            else:
                effective_interval = session.effective_interval_ms(
                    session._last_scene_key, get_recognizer()._config,
                )
            if elapsed_since_last < effective_interval:
                continue

            try:
                frame = _decode_frame(jpeg_data)
            except ValueError:
                logger.warning("フレームデコード失敗、スキップ")
                continue

            # パーティ登録処理（バトル処理と並行動作）
            if (
                session._party_machine is not None
                and session._party_machine.is_active
            ):
                party_msgs = await asyncio.to_thread(
                    session._party_machine.process_frame, frame,
                )
                for m in party_msgs:
                    await websocket.send_json(m)
                # 完了またはエラーでマシンを解放
                if not session._party_machine.is_active:
                    session._party_machine = None

            # シーン自動判定
            if session.auto_detect:
                scene_change = await asyncio.to_thread(
                    _run_scene_detection, frame, session,
                )
                if scene_change is not None:
                    session._read_once_cache.clear()
                    session._pokemon_icon_cache.clear()
                    if session._battle_log_parser is not None:
                        # サブシーン切り替え (battle内) ではパーサーをリセットしない
                        # battle ↔ battle_Neutral の頻繁な切り替えで重複排除状態が失われるのを防ぐ
                        if scene_change.get("top_level") != "battle":
                            session._battle_log_parser.reset()
                    if session._item_ability_parser is not None:
                        if scene_change.get("top_level") != "battle":
                            session._item_ability_parser.reset()
                    scene_change["interval_ms"] = session.effective_interval_ms(
                        scene_change["scene"], get_recognizer()._config,
                    )
                    await websocket.send_json(scene_change)
                    logger.info(
                        "シーン変更: %s (confidence=%.3f)",
                        scene_change["scene"],
                        scene_change["confidence"],
                    )

                    # --- 試合ログ: シーン遷移 ---
                    ml = session._match_logger
                    if ml is not None:
                        ml.maybe_start_match(scene_change["scene"])
                        ml.log_scene_change(scene_change)

                    # team_select 遷移時にポケモン画像認識 + 味方チーム OCR を実行
                    if scene_change["scene"] == "team_select":
                        pokemon_result = await asyncio.to_thread(
                            _run_pokemon_identification, frame,
                            session._pokemon_icon_cache,
                        )
                        if pokemon_result is not None:
                            await websocket.send_json(pokemon_result)
                            logger.info(
                                "ポケモン識別完了: %d件 (%.1fms)",
                                len(pokemon_result["pokemon"]),
                                pokemon_result["elapsed_ms"],
                            )
                            if ml is not None:
                                ml.log_pokemon_identified(pokemon_result)

                        # match_teams メッセージ送信（味方 + 相手チーム）
                        player_team = await asyncio.to_thread(
                            _extract_player_team, frame,
                        )
                        opponent_team = (
                            pokemon_result["pokemon"] if pokemon_result else []
                        )
                        # セッションに自動認識パーティを保存し、手動オーバーライドとマージ
                        session._auto_opponent_party = [
                            {"position": p["position"], "pokemon_key": p["pokemon_key"], "name": p["name"]}
                            for p in opponent_team
                            if p.get("pokemon_key") is not None
                        ]
                        session._rebuild_opponent_party()
                        await websocket.send_json({
                            "type": "match_teams",
                            "player_team": player_team,
                            "opponent_team": [
                                {
                                    "position": p.get("position"),
                                    "pokemon_key": p.get("pokemon_key"),
                                    "pokemon_id": p.get("pokemon_id"),
                                    "name": p.get("name"),
                                    "confidence": p.get("confidence", 0.0),
                                }
                                for p in opponent_team
                            ],
                        })
                        logger.info("match_teams 送信: 味方%d体, 相手%d体",
                                    len(player_team), len(opponent_team))
                        if ml is not None:
                            ml.log_match_teams(
                                player_team,
                                [
                                    {
                                        "position": p.get("position"),
                                        "pokemon_key": p.get("pokemon_key"),
                                        "pokemon_id": p.get("pokemon_id"),
                                        "name": p.get("name"),
                                        "confidence": p.get("confidence", 0.0),
                                    }
                                    for p in opponent_team
                                ],
                            )

                    # team_confirm 遷移時に選出ポケモンを読み取り
                    elif scene_change["scene"] == "team_confirm":
                        selected = await asyncio.to_thread(
                            _extract_team_selection, frame,
                        )
                        await websocket.send_json({
                            "type": "team_selection",
                            "selected_positions": selected,
                        })
                        logger.info("team_selection 送信: %s", selected)
                        if ml is not None:
                            ml.log_team_selection(selected)

                    # battle_end 遷移時に勝敗を読み取り
                    elif scene_change["scene"] == "battle_end":
                        result_str = await asyncio.to_thread(
                            _extract_battle_result, frame,
                        )
                        await websocket.send_json({
                            "type": "battle_result",
                            "result": result_str,
                        })
                        logger.info("battle_result 送信: %s", result_str)
                        if ml is not None:
                            ml.log_battle_result(result_str)
                            ml.end_match(reason="battle_end", battle_result=result_str)

            # OCR 実行するシーンを決定
            if session.auto_detect:
                scene_key = session._state_machine.state.scene_key
            else:
                scene_key = session.scene

            # none シーンでは OCR をスキップ
            if scene_key == "none":
                session._last_process_time = time.monotonic()
                continue

            # OCR 実行（GPU ロック付き）
            await websocket.send_json({
                "type": "status", "status": "processing", "message": "",
            })

            async with ocr_lock:
                if session.benchmark:
                    result = await asyncio.to_thread(
                        _run_ocr_benchmark, frame, scene_key,
                    )
                else:
                    debug_crops = session.debug_crops
                    result = await asyncio.to_thread(
                        _run_ocr, frame, scene_key, debug_crops,
                        session._read_once_cache,
                    )

            session._last_process_time = time.monotonic()
            await websocket.send_json(result)

            # --- 試合ログ: OCR 結果 ---
            ml = session._match_logger
            if ml is not None and ml.is_active and not session.benchmark:
                ml.log_ocr_result(result)

            # バトルシーンの OCR 結果を処理
            if scene_key == "battle" and not session.benchmark:
                if session._battle_log_parser is None:
                    session._battle_log_parser = BattleLogParser(get_game_data())
                text1 = ""
                text2 = ""
                opponent_pokemon_name = ""
                opponent_hp_text = ""
                opponent_trait_text1 = ""
                opponent_trait_text2 = ""
                for r in result.get("regions", []):
                    if r["name"] == "メインテキスト１":
                        text1 = r["text"]
                    elif r["name"] == "メインテキスト２":
                        text2 = r["text"]
                    elif r["name"] == "相手ポケモン名":
                        opponent_pokemon_name = r["text"].strip()
                    elif r["name"] == "相手HP":
                        opponent_hp_text = r["text"].strip()
                    elif r["name"] == "相手もちもの・特性１":
                        opponent_trait_text1 = r["text"].strip()
                    elif r["name"] == "相手もちもの・特性２":
                        opponent_trait_text2 = r["text"].strip()

                # トレーナー名はバトルログテキストから取得（専用リージョンは廃止）
                session._battle_log_parser.update_context(
                    opponent_party=session._opponent_party or None,
                    player_party=session._player_party or None,
                )

                # メインテキストをパースして構造化イベントを送信
                battle_events = session._battle_log_parser.parse(text1, text2)
                for ev in battle_events:
                    ev_msg = ev.to_ws_message()
                    await websocket.send_json(ev_msg)
                    logger.info(
                        "battle_event: %s side=%s pokemon=%s",
                        ev.event_type, ev.side, ev.pokemon_name,
                    )
                    if ml is not None:
                        ml.log_battle_event(ev_msg)

                # 相手ポケモン名をパーティ照合 + HP を送信
                if opponent_pokemon_name and session._opponent_party:
                    party_match = match_against_party(
                        opponent_pokemon_name, session._opponent_party,
                    )
                    if party_match is not None:
                        hp_percent = _parse_hp_percent(opponent_hp_text)
                        opponent_active_data = {
                            "pokemon_key": party_match["pokemon_key"],
                            "species_id": party_match["pokemon_key"],
                            "pokemon_name": party_match["matched_name"],
                            "hp_percent": hp_percent,
                            "confidence": party_match["confidence"],
                        }
                        await websocket.send_json({
                            "type": "opponent_active",
                            **opponent_active_data,
                        })
                        logger.debug(
                            "opponent_active: %s (key=%s) HP=%s confidence=%.3f",
                            party_match["matched_name"],
                            party_match["pokemon_key"],
                            hp_percent,
                            party_match["confidence"],
                        )
                        if ml is not None:
                            ml.log_opponent_active(opponent_active_data)

                # 相手もちもの・特性テキストを解析
                if opponent_trait_text1 or opponent_trait_text2:
                    if session._item_ability_parser is None:
                        session._item_ability_parser = ItemAbilityParser(get_game_data())
                    detections = session._item_ability_parser.parse(
                        opponent_trait_text1,
                        opponent_trait_text2,
                        session._opponent_party or [],
                    )
                    for det in detections:
                        await websocket.send_json(det)
                        logger.info(
                            "opponent_%s: %s → %s (id=%d)",
                            det["detection_type"],
                            det["pokemon_name"],
                            det["trait_name"],
                            det["trait_id"],
                        )
                        if ml is not None:
                            ml.log_item_ability(det)

    receive_task = asyncio.create_task(receive_loop())
    process_task = asyncio.create_task(process_loop())

    try:
        # どちらかが終了したら両方キャンセル
        done, pending = await asyncio.wait(
            [receive_task, process_task],
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
    except WebSocketDisconnect:
        logger.info("WebSocket 切断")
    finally:
        receive_task.cancel()
        process_task.cancel()
        if session._match_logger is not None and session._match_logger.is_active:
            session._match_logger.end_match(reason="disconnect")
        logger.info("WebSocket セッション終了")
