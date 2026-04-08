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

from app.dependencies import get_detector, get_pokemon_matcher, get_recognizer, ocr_lock
from app.recognition.scene_state import SceneStateMachine

logger = logging.getLogger(__name__)

router = APIRouter()


@dataclass
class BattleSession:
    """WebSocket 接続ごとのセッション状態."""

    scene: str = "battle"
    auto_detect: bool = True
    interval_ms: int = 500
    paused: bool = False
    debug_crops: bool = False
    benchmark: bool = False
    _state_machine: SceneStateMachine = field(default_factory=SceneStateMachine)
    _last_process_time: float = field(default=0.0, repr=False)
    _last_scene_key: str = field(default="pre_match", repr=False)


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
    if not candidates:
        return None

    detections = detector.detect(frame, candidates)
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


def _run_pokemon_identification(frame: np.ndarray) -> dict | None:
    """選出画面のポケモン画像認識を実行する（同期、to_thread で呼ばれる）.

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

    positions: list[dict[str, int]] = []
    for key in sorted(icon_defs.keys()):
        if key.startswith("_"):
            continue
        pos = icon_defs[key]
        positions.append({
            "x": pos["x"], "y": pos["y"],
            "w": pos["w"], "h": pos["h"],
        })

    if not positions:
        return None

    t0 = time.perf_counter()
    results = matcher.identify_team(frame, positions)
    elapsed = (time.perf_counter() - t0) * 1000

    pokemon_list = []
    for i, result in enumerate(results):
        entry: dict = {"position": i + 1}
        if result is not None:
            entry["pokemon_id"] = result.pokemon_id
            entry["confidence"] = round(result.confidence, 3)
        else:
            entry["pokemon_id"] = None
            entry["confidence"] = 0.0
        pokemon_list.append(entry)

    return {
        "type": "pokemon_identified",
        "pokemon": pokemon_list,
        "elapsed_ms": round(elapsed, 1),
    }


def _run_ocr(frame: np.ndarray, scene: str, debug_crops: bool = False) -> dict:
    """同期 OCR 処理（to_thread で呼ばれる）."""
    recognizer = get_recognizer()
    t0 = time.perf_counter()
    results = recognizer.recognize(frame, scene)
    elapsed = (time.perf_counter() - t0) * 1000

    res = recognizer._config.resolution

    regions = []
    for r in results:
        avg_confidence = 0.0
        if r.ocr_results:
            avg_confidence = sum(o.confidence for o in r.ocr_results) / len(r.ocr_results)
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
            _, buf = cv2.imencode(".jpg", cropped, [cv2.IMWRITE_JPEG_QUALITY, 80])
            region_dict["crop_b64"] = base64.b64encode(buf).decode("ascii")
        regions.append(region_dict)

    return {
        "type": "ocr_result",
        "scene": scene,
        "elapsed_ms": round(elapsed, 1),
        "resolution": {"width": res[0], "height": res[1]},
        "regions": regions,
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
            "engines": r["engines"],
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
                        session._last_scene_key = "pre_match"
                        logger.info("ステートマシンをリセット")
                        await websocket.send_json({
                            "type": "scene_change",
                            "scene": "pre_match",
                            "top_level": "pre_match",
                            "sub_scene": None,
                            "confidence": 0.0,
                        })
                except (json.JSONDecodeError, KeyError, TypeError):
                    logger.warning("不正な設定メッセージを無視")

    async def process_loop() -> None:
        """キューからフレームを取り出してシーン検出 + OCR を実行し結果を返す."""
        while True:
            jpeg_data = await frame_queue.get()

            if session.paused:
                continue

            # インターバル制御
            now = time.monotonic()
            elapsed_since_last = (now - session._last_process_time) * 1000
            if elapsed_since_last < session.interval_ms:
                continue

            try:
                frame = _decode_frame(jpeg_data)
            except ValueError:
                logger.warning("フレームデコード失敗、スキップ")
                continue

            # シーン自動判定
            if session.auto_detect:
                scene_change = await asyncio.to_thread(
                    _run_scene_detection, frame, session,
                )
                if scene_change is not None:
                    await websocket.send_json(scene_change)
                    logger.info(
                        "シーン変更: %s (confidence=%.3f)",
                        scene_change["scene"],
                        scene_change["confidence"],
                    )

                    # team_select 遷移時にポケモン画像認識を実行
                    if scene_change["scene"] == "team_select":
                        pokemon_result = await asyncio.to_thread(
                            _run_pokemon_identification, frame,
                        )
                        if pokemon_result is not None:
                            await websocket.send_json(pokemon_result)
                            logger.info(
                                "ポケモン識別完了: %d件 (%.1fms)",
                                len(pokemon_result["pokemon"]),
                                pokemon_result["elapsed_ms"],
                            )

            # OCR 実行するシーンを決定
            if session.auto_detect:
                scene_key = session._state_machine.state.scene_key
            else:
                scene_key = session.scene

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
