"""DevTools API: 録画セッション管理 & リージョン編集."""

from __future__ import annotations

import json
import logging
import re
import string
import random
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import asyncio
from collections.abc import AsyncGenerator

import cv2
import numpy as np
from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response, StreamingResponse

from .devtools_models import (
    BenchmarkRequest,
    DetectionRegionUpdate,
    FrameInfo,
    RegionUpdate,
    SceneCreate,
    SceneReorder,
    SceneUpdate,
    SessionCreate,
    SessionMetadata,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/devtools", tags=["devtools"])

DATA_DIR = Path(__file__).parent.parent.parent / "data" / "recordings"
CONFIG_DIR = Path(__file__).parent.parent.parent / "config"
REGIONS_FILE = CONFIG_DIR / "regions.json"


def _generate_session_id() -> str:
    now = datetime.now(timezone.utc)
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=4))
    return now.strftime("%Y%m%d_%H%M%S") + "_" + suffix


def _read_metadata(session_dir: Path) -> dict[str, Any]:
    meta_path = session_dir / "metadata.json"
    if not meta_path.exists():
        raise HTTPException(status_code=404, detail="Session not found")
    return json.loads(meta_path.read_text(encoding="utf-8"))


def _write_metadata(session_dir: Path, meta: dict[str, Any]) -> None:
    meta_path = session_dir / "metadata.json"
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


# ---------------------------------------------------------------------------
# 録画セッション API
# ---------------------------------------------------------------------------


@router.post("/recordings", response_model=SessionMetadata)
async def create_session(body: SessionCreate) -> SessionMetadata:
    """新しい録画セッションを作成する."""
    session_id = _generate_session_id()
    session_dir = DATA_DIR / session_id / "frames"
    session_dir.mkdir(parents=True, exist_ok=True)

    meta = {
        "session_id": session_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "frame_count": 0,
        "duration_ms": 0,
        "resolution": [1920, 1080],
        "status": "recording",
        "description": body.description,
    }
    _write_metadata(DATA_DIR / session_id, meta)
    return SessionMetadata(**meta)


@router.get("/recordings", response_model=list[SessionMetadata])
async def list_sessions() -> list[SessionMetadata]:
    """全セッション一覧を取得する."""
    if not DATA_DIR.exists():
        return []

    sessions: list[SessionMetadata] = []
    for d in sorted(DATA_DIR.iterdir(), reverse=True):
        if d.is_dir() and (d / "metadata.json").exists():
            meta = _read_metadata(d)
            sessions.append(SessionMetadata(**meta))
    return sessions


@router.get("/recordings/{session_id}", response_model=SessionMetadata)
async def get_session(session_id: str) -> SessionMetadata:
    """セッション詳細を取得する."""
    meta = _read_metadata(DATA_DIR / session_id)
    return SessionMetadata(**meta)


@router.delete("/recordings/{session_id}")
async def delete_session(session_id: str) -> dict[str, str]:
    """セッションを削除する."""
    session_dir = DATA_DIR / session_id
    if not session_dir.exists():
        raise HTTPException(status_code=404, detail="Session not found")

    import shutil
    shutil.rmtree(session_dir)
    return {"status": "deleted"}


@router.post("/recordings/{session_id}/frames", response_model=FrameInfo)
async def upload_frame(
    session_id: str,
    request: Request,
    x_timestamp_ms: int = Header(default=0),
) -> FrameInfo:
    """フレームを追加する (JPEG binary body)."""
    session_dir = DATA_DIR / session_id
    meta = _read_metadata(session_dir)

    if meta["status"] != "recording":
        raise HTTPException(status_code=400, detail="Session is not recording")

    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="Empty body")

    frame_index = meta["frame_count"] + 1
    filename = f"{frame_index:06d}_{x_timestamp_ms:07d}.jpg"
    frame_path = session_dir / "frames" / filename
    frame_path.write_bytes(body)

    meta["frame_count"] = frame_index
    meta["duration_ms"] = max(meta["duration_ms"], x_timestamp_ms)
    _write_metadata(session_dir, meta)

    return FrameInfo(index=frame_index, filename=filename, timestamp_ms=x_timestamp_ms)


@router.post("/recordings/{session_id}/complete", response_model=SessionMetadata)
async def complete_session(session_id: str) -> SessionMetadata:
    """録画を完了する."""
    session_dir = DATA_DIR / session_id
    meta = _read_metadata(session_dir)
    meta["status"] = "completed"

    # フレーム数を実際のファイル数で確定
    frames_dir = session_dir / "frames"
    if frames_dir.exists():
        actual_count = len(list(frames_dir.glob("*.jpg")))
        meta["frame_count"] = actual_count

    _write_metadata(session_dir, meta)
    return SessionMetadata(**meta)


@router.get("/recordings/{session_id}/frames", response_model=list[FrameInfo])
async def list_frames(session_id: str) -> list[FrameInfo]:
    """セッション内のフレーム一覧を取得する."""
    frames_dir = DATA_DIR / session_id / "frames"
    if not frames_dir.exists():
        raise HTTPException(status_code=404, detail="Session not found")

    frames: list[FrameInfo] = []
    pattern = re.compile(r"^(\d{6})_(\d{7})\.jpg$")
    for f in sorted(frames_dir.iterdir()):
        m = pattern.match(f.name)
        if m:
            frames.append(
                FrameInfo(
                    index=int(m.group(1)),
                    filename=f.name,
                    timestamp_ms=int(m.group(2)),
                )
            )
    return frames


@router.get("/recordings/{session_id}/frames/{filename}")
async def get_frame(session_id: str, filename: str) -> FileResponse:
    """フレーム画像を配信する."""
    frame_path = DATA_DIR / session_id / "frames" / filename
    if not frame_path.exists():
        raise HTTPException(status_code=404, detail="Frame not found")
    return FileResponse(frame_path, media_type="image/jpeg")


@router.get("/recordings/{session_id}/frames/{filename}/thumbnail")
async def get_thumbnail(session_id: str, filename: str) -> Response:
    """サムネイル画像を配信する (256px 幅)."""
    frame_path = DATA_DIR / session_id / "frames" / filename
    if not frame_path.exists():
        raise HTTPException(status_code=404, detail="Frame not found")

    img = cv2.imread(str(frame_path))
    if img is None:
        raise HTTPException(status_code=500, detail="Failed to read image")

    h, w = img.shape[:2]
    new_w = 256
    new_h = int(h * new_w / w)
    thumb = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)

    _, buf = cv2.imencode(".jpg", thumb, [cv2.IMWRITE_JPEG_QUALITY, 80])
    return Response(content=buf.tobytes(), media_type="image/jpeg")


# ---------------------------------------------------------------------------
# regions.json 読み書きヘルパー
# ---------------------------------------------------------------------------


def _read_regions() -> dict[str, Any]:
    if not REGIONS_FILE.exists():
        return {"resolution": {"width": 1920, "height": 1080}, "scenes": {}}
    return json.loads(REGIONS_FILE.read_text(encoding="utf-8"))


def _write_regions(data: dict[str, Any]) -> None:
    REGIONS_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def _ensure_scenes(data: dict[str, Any]) -> dict[str, Any]:
    """scenes キーが存在することを保証する."""
    if "scenes" not in data:
        data["scenes"] = {}
    return data


# ---------------------------------------------------------------------------
# シーン管理 API
# ---------------------------------------------------------------------------


@router.get("/scenes")
async def get_scenes() -> dict[str, dict[str, str]]:
    """全シーンのメタデータ一覧を取得する."""
    data = _ensure_scenes(_read_regions())
    result: dict[str, dict[str, str]] = {}
    for key, scene in data["scenes"].items():
        result[key] = {
            "display_name": scene.get("display_name", key),
            "description": scene.get("description", ""),
        }
    return result


@router.post("/scenes")
async def create_scene(body: SceneCreate) -> dict[str, Any]:
    """新しいシーンを作成する."""
    data = _ensure_scenes(_read_regions())

    if body.key in data["scenes"]:
        raise HTTPException(status_code=409, detail=f"シーン '{body.key}' は既に存在します")

    data["scenes"][body.key] = {
        "display_name": body.display_name or body.key,
        "description": body.description,
        "detection": {},
        "regions": {},
    }
    _write_regions(data)
    return data


@router.post("/scenes/reorder")
async def reorder_scenes(body: SceneReorder) -> dict[str, Any]:
    """シーンの順序を並び替える."""
    data = _ensure_scenes(_read_regions())
    old_scenes = data["scenes"]

    # 指定されたキーの順序で新しい dict を構築
    new_scenes: dict[str, Any] = {}
    for key in body.keys:
        if key in old_scenes:
            new_scenes[key] = old_scenes[key]
    # 指定されなかったキーがあれば末尾に追加
    for key in old_scenes:
        if key not in new_scenes:
            new_scenes[key] = old_scenes[key]

    data["scenes"] = new_scenes
    _write_regions(data)
    return data


@router.put("/scenes/{scene}")
async def update_scene(scene: str, body: SceneUpdate) -> dict[str, Any]:
    """シーンのメタデータを更新する."""
    data = _ensure_scenes(_read_regions())

    if scene not in data["scenes"]:
        raise HTTPException(status_code=404, detail=f"シーン '{scene}' が見つかりません")

    if body.display_name is not None:
        data["scenes"][scene]["display_name"] = body.display_name
    if body.description is not None:
        data["scenes"][scene]["description"] = body.description
    _write_regions(data)
    return data


@router.delete("/scenes/{scene}")
async def delete_scene(scene: str) -> dict[str, Any]:
    """シーンを削除する."""
    data = _ensure_scenes(_read_regions())

    if scene not in data["scenes"]:
        raise HTTPException(status_code=404, detail=f"シーン '{scene}' が見つかりません")

    del data["scenes"][scene]
    _write_regions(data)
    return data


# ---------------------------------------------------------------------------
# リージョン（OCR読み取り用クロップ）API
# ---------------------------------------------------------------------------


@router.get("/regions")
async def get_regions() -> dict[str, Any]:
    """regions.json の内容を取得する."""
    return _read_regions()


@router.post("/regions/{scene}")
async def upsert_region(scene: str, body: RegionUpdate) -> dict[str, Any]:
    """リージョンを追加/更新する."""
    data = _ensure_scenes(_read_regions())

    if scene not in data["scenes"]:
        raise HTTPException(status_code=404, detail=f"シーン '{scene}' が見つかりません")

    data["scenes"][scene]["regions"][body.name] = {
        "x": body.x,
        "y": body.y,
        "w": body.w,
        "h": body.h,
        "engine": body.engine,
    }
    _write_regions(data)

    # メモリ上の RegionConfig を再読み込みして即座に反映
    from app.dependencies import get_recognizer

    try:
        get_recognizer()._config.reload()
    except RuntimeError:
        pass  # アプリ起動前（テスト等）は無視

    return data


@router.delete("/regions/{scene}")
async def delete_region(scene: str, name: str = Query(...)) -> dict[str, Any]:
    """リージョンを削除する."""
    data = _ensure_scenes(_read_regions())

    if scene in data["scenes"] and name in data["scenes"][scene].get("regions", {}):
        del data["scenes"][scene]["regions"][name]
        _write_regions(data)
    return data


# ---------------------------------------------------------------------------
# 検出クロップ（シーン判定用）API
# ---------------------------------------------------------------------------


@router.post("/detection/{scene}")
async def upsert_detection_region(scene: str, body: DetectionRegionUpdate) -> dict[str, Any]:
    """検出リージョンを追加/更新する."""
    data = _ensure_scenes(_read_regions())

    if scene not in data["scenes"]:
        raise HTTPException(status_code=404, detail=f"シーン '{scene}' が見つかりません")

    region_def: dict[str, Any] = {
        "x": body.x,
        "y": body.y,
        "w": body.w,
        "h": body.h,
        "method": body.method,
    }
    region_def.update(body.params)
    data["scenes"][scene]["detection"][body.name] = region_def
    _write_regions(data)
    return data


@router.delete("/detection/{scene}")
async def delete_detection_region(scene: str, name: str = Query(...)) -> dict[str, Any]:
    """検出リージョンを削除する."""
    data = _ensure_scenes(_read_regions())

    if scene in data["scenes"] and name in data["scenes"][scene].get("detection", {}):
        del data["scenes"][scene]["detection"][name]
        _write_regions(data)
    return data


# ---------------------------------------------------------------------------
# オフラインベンチマーク（SSE ストリーミング）
# ---------------------------------------------------------------------------


def _run_benchmark_frame(frame: np.ndarray, scene: str) -> dict[str, Any]:
    """1フレームを全エンジンでベンチマークする（同期、to_thread で呼ばれる）."""
    from app.ws.battle import _run_ocr_benchmark

    return _run_ocr_benchmark(frame, scene)


async def _benchmark_stream(
    session_id: str, scene: str,
) -> AsyncGenerator[str, None]:
    """録画セッションのフレームを順次処理し SSE イベントを生成する."""
    from app.dependencies import ocr_lock

    frames_dir = DATA_DIR / session_id / "frames"
    frame_files = sorted(frames_dir.glob("*.jpg"))
    total = len(frame_files)

    yield f"event: start\ndata: {json.dumps({'total_frames': total, 'scene': scene})}\n\n"

    for frame_path in frame_files:
        img = cv2.imread(str(frame_path))
        if img is None:
            logger.warning("フレーム読み込み失敗: %s", frame_path)
            continue

        async with ocr_lock:
            result = await asyncio.to_thread(_run_benchmark_frame, img, scene)

        yield f"event: frame\ndata: {json.dumps(result, ensure_ascii=False)}\n\n"

    yield f"event: done\ndata: {json.dumps({'total_frames': total})}\n\n"


@router.post("/benchmark/{session_id}")
async def run_offline_benchmark(
    session_id: str, body: BenchmarkRequest,
) -> StreamingResponse:
    """録画セッションで全 OCR エンジンのベンチマークを実行する（SSE）."""
    session_dir = DATA_DIR / session_id
    meta = _read_metadata(session_dir)

    if meta["status"] != "completed":
        raise HTTPException(
            status_code=400, detail="セッションが完了していません",
        )

    frames_dir = session_dir / "frames"
    if not frames_dir.exists() or not any(frames_dir.glob("*.jpg")):
        raise HTTPException(status_code=400, detail="フレームが見つかりません")

    return StreamingResponse(
        _benchmark_stream(session_id, body.scene),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
