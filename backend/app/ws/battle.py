"""バトル用 WebSocket ハンドラ.

クライアントから JPEG フレーム（バイナリ）を受信し、
シーン自動判定 → RegionRecognizer で OCR → JSON 結果を返す。
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import time
from dataclasses import dataclass, field

import cv2
import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.data.names import get_id_to_name
from app.dependencies import get_detector, get_pokemon_matcher, get_recognizer, ocr_lock
from app.ocr.region import RegionConfig
from app.recognition.party_register import PartyRegistrationMachine
from app.recognition.scene_state import SceneStateMachine

logger = logging.getLogger(__name__)

router = APIRouter()


@dataclass
class BattleSession:
    """WebSocket 接続ごとのセッション状態."""

    scene: str = "battle"
    auto_detect: bool = True
    interval_ms: int = 500
    scene_intervals: dict[str, int] = field(default_factory=dict)
    paused: bool = False
    debug_crops: bool = False
    benchmark: bool = False
    _state_machine: SceneStateMachine = field(default_factory=SceneStateMachine)
    _party_machine: PartyRegistrationMachine | None = field(default=None, repr=False)
    _last_process_time: float = field(default=0.0, repr=False)
    _last_scene_key: str = field(default="none", repr=False)
    _read_once_cache: dict[str, dict] = field(default_factory=dict, repr=False)
    _pokemon_icon_cache: dict[str, dict] = field(default_factory=dict, repr=False)

    def effective_interval_ms(self, scene_key: str, config: RegionConfig) -> int:
        """現在のシーンに応じた有効インターバル(ms)を返す.

        優先順位: フロントエンド個別設定 > regions.json シーン設定 > default_interval_ms
        """
        if scene_key in self.scene_intervals:
            return self.scene_intervals[scene_key]
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
                    entry["pokemon_id"] = best.pokemon_id
                    entry["name"] = id_to_name.get(best.pokemon_id, f"#{best.pokemon_id}")
                    entry["confidence"] = round(best.confidence, 3)
                else:
                    entry["pokemon_id"] = None
                    entry["name"] = None
                    entry["confidence"] = 0.0
                # 全候補を含める
                entry["candidates"] = [
                    {
                        "pokemon_id": c.pokemon_id,
                        "name": id_to_name.get(c.pokemon_id, f"#{c.pokemon_id}"),
                        "confidence": round(c.confidence, 3),
                    }
                    for c in detailed.candidates
                ]
            else:
                entry["pokemon_id"] = None
                entry["name"] = None
                entry["confidence"] = 0.0
                entry["candidates"] = []
            # read_once ならキャッシュに格納
            if pos.get("read_once", False) and pokemon_icon_cache is not None:
                pokemon_icon_cache[key] = {
                    "pokemon_id": entry["pokemon_id"],
                    "name": entry["name"],
                    "confidence": entry["confidence"],
                    "candidates": entry["candidates"],
                }
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


@router.websocket("/ws/battle")
async def websocket_battle(websocket: WebSocket) -> None:
    """バトル WebSocket エンドポイント."""
    await websocket.accept()
    session = BattleSession()
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
                        if "interval_ms" in data:
                            session.interval_ms = max(100, int(data["interval_ms"]))
                        if "paused" in data:
                            session.paused = bool(data["paused"])
                        if "debug_crops" in data:
                            session.debug_crops = bool(data["debug_crops"])
                        if "benchmark" in data:
                            session.benchmark = bool(data["benchmark"])
                        if "scene_intervals" in data:
                            raw = data["scene_intervals"]
                            if isinstance(raw, dict):
                                session.scene_intervals = {
                                    k: max(100, int(v))
                                    for k, v in raw.items()
                                }
                        logger.info(
                            "設定更新: scene=%s auto_detect=%s interval=%dms "
                            "paused=%s debug_crops=%s benchmark=%s",
                            session.scene,
                            session.auto_detect,
                            session.interval_ms,
                            session.paused,
                            session.debug_crops,
                            session.benchmark,
                        )
                    elif data.get("type") == "reset":
                        session._state_machine.reset()
                        session._last_scene_key = "none"
                        session._read_once_cache.clear()
                        session._pokemon_icon_cache.clear()
                        logger.info("ステートマシンをリセット")
                        await websocket.send_json({
                            "type": "scene_change",
                            "scene": "none",
                            "top_level": "none",
                            "sub_scene": None,
                            "confidence": 0.0,
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
                    scene_change["interval_ms"] = session.effective_interval_ms(
                        scene_change["scene"], get_recognizer()._config,
                    )
                    await websocket.send_json(scene_change)
                    logger.info(
                        "シーン変更: %s (confidence=%.3f)",
                        scene_change["scene"],
                        scene_change["confidence"],
                    )

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

                        # match_teams メッセージ送信（味方 + 相手チーム）
                        player_team = await asyncio.to_thread(
                            _extract_player_team, frame,
                        )
                        opponent_team = (
                            pokemon_result["pokemon"] if pokemon_result else []
                        )
                        await websocket.send_json({
                            "type": "match_teams",
                            "player_team": player_team,
                            "opponent_team": [
                                {
                                    "position": p.get("position"),
                                    "pokemon_id": p.get("pokemon_id"),
                                    "name": p.get("name"),
                                    "confidence": p.get("confidence", 0.0),
                                }
                                for p in opponent_team
                            ],
                        })
                        logger.info("match_teams 送信: 味方%d体, 相手%d体",
                                    len(player_team), len(opponent_team))

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
        logger.info("WebSocket セッション終了")
