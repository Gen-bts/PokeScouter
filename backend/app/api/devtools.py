"""DevTools API: 録画セッション管理 & リージョン編集."""

from __future__ import annotations

import base64
import json
import logging
import re
import string
import random
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import asyncio
from collections.abc import AsyncGenerator

import cv2
import numpy as np
from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response, StreamingResponse

from app.dependencies import metadata_file_lock, regions_file_lock

from .devtools_models import (
    BenchmarkRequest,
    CropTestRequest,
    DetectionRegionUpdate,
    FrameInfo,
    FullMatchBenchmarkRequest,
    PokemonIconUpdate,
    RegionGroupCreate,
    RegionGroupSlotUpdate,
    RegionGroupTemplateUpdate,
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
    async with metadata_file_lock:
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

    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="Empty body")

    async with metadata_file_lock:
        meta = _read_metadata(session_dir)
        if meta["status"] != "recording":
            raise HTTPException(status_code=400, detail="Session is not recording")
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
    async with metadata_file_lock:
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
async def get_scenes() -> dict[str, dict[str, Any]]:
    """全シーンのメタデータ一覧を取得する."""
    data = _ensure_scenes(_read_regions())
    default_interval = data.get("default_interval_ms", 500)
    result: dict[str, dict[str, Any]] = {}
    for key, scene in data["scenes"].items():
        result[key] = {
            "display_name": scene.get("display_name", key),
            "description": scene.get("description", ""),
            "interval_ms": scene.get("interval_ms", default_interval),
        }
    return result


@router.post("/scenes")
async def create_scene(body: SceneCreate) -> dict[str, Any]:
    """新しいシーンを作成する."""
    async with regions_file_lock:
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
    async with regions_file_lock:
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
    async with regions_file_lock:
        data = _ensure_scenes(_read_regions())

        if scene not in data["scenes"]:
            raise HTTPException(status_code=404, detail=f"シーン '{scene}' が見つかりません")

        if body.display_name is not None:
            data["scenes"][scene]["display_name"] = body.display_name
        if body.description is not None:
            data["scenes"][scene]["description"] = body.description
        if body.interval_ms is not None:
            data["scenes"][scene]["interval_ms"] = max(100, body.interval_ms)
        _write_regions(data)
    return data


@router.delete("/scenes/{scene}")
async def delete_scene(scene: str) -> dict[str, Any]:
    """シーンを削除する."""
    async with regions_file_lock:
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
    async with regions_file_lock:
        data = _ensure_scenes(_read_regions())

        if scene not in data["scenes"]:
            raise HTTPException(status_code=404, detail=f"シーン '{scene}' が見つかりません")

        region_data: dict[str, Any] = {
            "x": body.x,
            "y": body.y,
            "w": body.w,
            "h": body.h,
            "engine": body.engine,
        }
        if body.read_once:
            region_data["read_once"] = True
        data["scenes"][scene]["regions"][body.name] = region_data
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
    async with regions_file_lock:
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
    async with regions_file_lock:
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
    async with regions_file_lock:
        data = _ensure_scenes(_read_regions())

        if scene in data["scenes"] and name in data["scenes"][scene].get("detection", {}):
            del data["scenes"][scene]["detection"][name]
            _write_regions(data)
    return data


# ---------------------------------------------------------------------------
# ポケモンアイコン（画像認識用クロップ）API
# ---------------------------------------------------------------------------


@router.post("/pokemon-icons/{scene}")
async def upsert_pokemon_icon(scene: str, body: PokemonIconUpdate) -> dict[str, Any]:
    """ポケモンアイコンを追加/更新する."""
    async with regions_file_lock:
        data = _ensure_scenes(_read_regions())

        if scene not in data["scenes"]:
            raise HTTPException(status_code=404, detail=f"シーン '{scene}' が見つかりません")

        if "pokemon_icons" not in data["scenes"][scene]:
            data["scenes"][scene]["pokemon_icons"] = {}

        icon_data: dict[str, Any] = {
            "x": body.x,
            "y": body.y,
            "w": body.w,
            "h": body.h,
        }
        if body.read_once:
            icon_data["read_once"] = True
        data["scenes"][scene]["pokemon_icons"][body.name] = icon_data
        _write_regions(data)
    return data


@router.delete("/pokemon-icons/{scene}")
async def delete_pokemon_icon(scene: str, name: str = Query(...)) -> dict[str, Any]:
    """ポケモンアイコンを削除する."""
    async with regions_file_lock:
        data = _ensure_scenes(_read_regions())

        if scene in data["scenes"] and name in data["scenes"][scene].get("pokemon_icons", {}):
            del data["scenes"][scene]["pokemon_icons"][name]
            _write_regions(data)
    return data


# ---------------------------------------------------------------------------
# リージョングループ API
# ---------------------------------------------------------------------------


def _reload_config() -> None:
    """メモリ上の RegionConfig を再読み込み."""
    from app.dependencies import get_recognizer

    try:
        get_recognizer()._config.reload()
    except RuntimeError:
        pass


def _get_scene_or_404(data: dict[str, Any], scene: str) -> dict[str, Any]:
    if scene not in data["scenes"]:
        raise HTTPException(status_code=404, detail=f"シーン '{scene}' が見つかりません")
    return data["scenes"][scene]


def _get_group_or_404(
    scene_data: dict[str, Any], group_name: str,
) -> dict[str, Any]:
    groups = scene_data.get("region_groups", {})
    if group_name not in groups:
        raise HTTPException(
            status_code=404, detail=f"グループ '{group_name}' が見つかりません",
        )
    return groups[group_name]


@router.post("/region-groups/{scene}")
async def create_region_group(scene: str, body: RegionGroupCreate) -> dict[str, Any]:
    """リージョングループを作成する."""
    async with regions_file_lock:
        data = _ensure_scenes(_read_regions())
        scene_data = _get_scene_or_404(data, scene)

        if "region_groups" not in scene_data:
            scene_data["region_groups"] = {}

        if body.group_name in scene_data["region_groups"]:
            raise HTTPException(
                status_code=409, detail=f"グループ '{body.group_name}' は既に存在します",
            )

        scene_data["region_groups"][body.group_name] = {
            "template": {
                name: entry.model_dump() for name, entry in body.template.items()
            },
            "slots": [s.model_dump() for s in body.slots],
        }
        _write_regions(data)
    _reload_config()
    return data


@router.delete("/region-groups/{scene}")
async def delete_region_group(
    scene: str, group_name: str = Query(...),
) -> dict[str, Any]:
    """リージョングループを削除する."""
    async with regions_file_lock:
        data = _ensure_scenes(_read_regions())
        scene_data = _get_scene_or_404(data, scene)

        groups = scene_data.get("region_groups", {})
        if group_name in groups:
            del groups[group_name]
            _write_regions(data)
    _reload_config()
    return data


@router.post("/region-groups/{scene}/{group_name}/template")
async def upsert_group_template(
    scene: str, group_name: str, body: RegionGroupTemplateUpdate,
) -> dict[str, Any]:
    """テンプレートサブリージョンを追加/更新する."""
    async with regions_file_lock:
        data = _ensure_scenes(_read_regions())
        scene_data = _get_scene_or_404(data, scene)
        group = _get_group_or_404(scene_data, group_name)

        entry: dict[str, Any] = {
            "dx": body.dx,
            "dy": body.dy,
            "w": body.w,
            "h": body.h,
            "type": body.type,
        }
        if body.type == "region":
            entry["engine"] = body.engine
        if body.read_once:
            entry["read_once"] = True

        group["template"][body.sub_name] = entry
        _write_regions(data)
    _reload_config()
    return data


@router.delete("/region-groups/{scene}/{group_name}/template")
async def delete_group_template(
    scene: str, group_name: str, sub_name: str = Query(...),
) -> dict[str, Any]:
    """テンプレートサブリージョンを削除する."""
    async with regions_file_lock:
        data = _ensure_scenes(_read_regions())
        scene_data = _get_scene_or_404(data, scene)
        group = _get_group_or_404(scene_data, group_name)

        if sub_name in group["template"]:
            del group["template"][sub_name]
            _write_regions(data)
    _reload_config()
    return data


@router.post("/region-groups/{scene}/{group_name}/slots")
async def upsert_group_slot(
    scene: str, group_name: str, body: RegionGroupSlotUpdate,
) -> dict[str, Any]:
    """スロットを追加/更新する."""
    async with regions_file_lock:
        data = _ensure_scenes(_read_regions())
        scene_data = _get_scene_or_404(data, scene)
        group = _get_group_or_404(scene_data, group_name)

        # 既存スロットを名前で検索し更新、なければ追加
        for slot in group["slots"]:
            if slot["name"] == body.name:
                slot["x"] = body.x
                slot["y"] = body.y
                break
        else:
            group["slots"].append(body.model_dump())

        _write_regions(data)
    _reload_config()
    return data


@router.delete("/region-groups/{scene}/{group_name}/slots")
async def delete_group_slot(
    scene: str, group_name: str, name: str = Query(...),
) -> dict[str, Any]:
    """スロットを削除する."""
    async with regions_file_lock:
        data = _ensure_scenes(_read_regions())
        scene_data = _get_scene_or_404(data, scene)
        group = _get_group_or_404(scene_data, group_name)

        group["slots"] = [s for s in group["slots"] if s["name"] != name]
        _write_regions(data)
    _reload_config()
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


# ---------------------------------------------------------------------------
# 1試合通しベンチマーク（フルパイプライン再生）
# ---------------------------------------------------------------------------

_FRAME_PATTERN = re.compile(r"^(\d{6})_(\d{7})\.jpg$")


@dataclass
class _OfflineReplaySession:
    """オフライン再生用の軽量セッション（BattleSession とダックタイプ互換）."""

    _state_machine: "SceneStateMachine" = field(default=None)  # type: ignore[assignment]
    _last_scene_key: str = "pre_match"
    _last_ocr_timestamp_ms: int = field(default=0, repr=False)
    _read_once_cache: dict[str, dict] = field(default_factory=dict, repr=False)

    def __post_init__(self) -> None:
        if self._state_machine is None:
            from app.dependencies import get_settings
            from app.recognition.scene_state import SceneStateMachine
            settings = get_settings()
            self._state_machine = SceneStateMachine(
                scene_state_config=settings.recognition.scene_state,
            )


def _run_full_match_frame(
    frame: np.ndarray,
    session: _OfflineReplaySession,
    ocr_mode: str,
) -> list[dict[str, Any]]:
    """1フレームをフルパイプラインで処理する（同期、to_thread で呼ばれる）."""
    from app.ws.battle import (
        _run_ocr,
        _run_ocr_benchmark,
        _run_pokemon_identification,
        _run_scene_detection,
    )

    events: list[dict[str, Any]] = []
    detection_ms = 0.0
    ocr_ms = 0.0

    # 1. シーン検出
    t0 = time.perf_counter()
    scene_change = _run_scene_detection(frame, session)  # type: ignore[arg-type]
    detection_ms = (time.perf_counter() - t0) * 1000

    if scene_change is not None:
        events.append(scene_change)

        # シーン変更時に read_once キャッシュをクリア（通常運用と同じ動作）
        if ocr_mode == "normal":
            session._read_once_cache.clear()

        # 2. team_select 遷移時にポケモン識別
        if scene_change["scene"] == "team_select":
            pokemon_result = _run_pokemon_identification(frame)
            if pokemon_result is not None:
                events.append(pokemon_result)

    # 3. OCR 実行
    scene_key = session._state_machine.state.scene_key
    t0 = time.perf_counter()
    if ocr_mode == "all":
        ocr_result = _run_ocr_benchmark(frame, scene_key)
    elif ocr_mode == "normal":
        ocr_result = _run_ocr(
            frame, scene_key,
            read_once_cache=session._read_once_cache,
        )
    else:
        ocr_result = _run_ocr(frame, scene_key)
    ocr_ms = (time.perf_counter() - t0) * 1000

    events.append(ocr_result)

    # 4. フレームサマリー（タイミング情報）
    events.append({
        "type": "frame_summary",
        "scene_key": scene_key,
        "detection_ms": round(detection_ms, 1),
        "ocr_ms": round(ocr_ms, 1),
        "total_ms": round(detection_ms + ocr_ms, 1),
    })

    return events


async def _full_match_stream(
    session_id: str, ocr_mode: str,
) -> AsyncGenerator[str, None]:
    """録画セッションをフルパイプラインで再生し SSE イベントを生成する."""
    from app.dependencies import get_recognizer, ocr_lock

    frames_dir = DATA_DIR / session_id / "frames"
    frame_files = sorted(frames_dir.glob("*.jpg"))
    total = len(frame_files)

    yield f"event: start\ndata: {json.dumps({'total_frames': total, 'mode': 'full_match', 'ocr_mode': ocr_mode})}\n\n"

    session = _OfflineReplaySession()
    scene_timeline: list[dict[str, Any]] = []
    scene_counts: dict[str, int] = {}
    skipped_frames = 0
    processed_frames = 0
    t_start = time.perf_counter()

    for frame_path in frame_files:
        # フレームインデックスとタイムスタンプを抽出
        m = _FRAME_PATTERN.match(frame_path.name)
        if not m:
            continue
        frame_index = int(m.group(1))
        timestamp_ms = int(m.group(2))

        # normal モード: インターバルスロットリング（リアルタイムと同じ動作）
        if ocr_mode == "normal":
            config = get_recognizer()._config
            effective_interval = config.get_interval_ms(session._last_scene_key)
            elapsed_since_last = timestamp_ms - session._last_ocr_timestamp_ms
            if elapsed_since_last < effective_interval:
                skipped_frames += 1
                yield f"event: frame_skipped\ndata: {json.dumps({'frame_index': frame_index, 'timestamp_ms': timestamp_ms, 'scene_key': session._last_scene_key})}\n\n"
                continue

        img = cv2.imread(str(frame_path))
        if img is None:
            logger.warning("フレーム読み込み失敗: %s", frame_path)
            continue

        async with ocr_lock:
            events = await asyncio.to_thread(
                _run_full_match_frame, img, session, ocr_mode,
            )

        if ocr_mode == "normal":
            session._last_ocr_timestamp_ms = timestamp_ms
        processed_frames += 1

        # フレーム情報を各イベントに付与して送信
        for event in events:
            event["frame_index"] = frame_index
            event["timestamp_ms"] = timestamp_ms
            event_type = event["type"]

            # シーンタイムライン収集
            if event_type == "scene_change":
                scene_timeline.append({
                    "frame_index": frame_index,
                    "timestamp_ms": timestamp_ms,
                    "scene": event["scene"],
                    "confidence": event["confidence"],
                })

            # シーン別フレーム数カウント
            if event_type == "frame_summary":
                sk = event["scene_key"]
                scene_counts[sk] = scene_counts.get(sk, 0) + 1

            yield f"event: {event_type}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"

    total_elapsed_ms = (time.perf_counter() - t_start) * 1000

    done_data = {
        "total_frames": total,
        "processed_frames": processed_frames,
        "skipped_frames": skipped_frames,
        "total_elapsed_ms": round(total_elapsed_ms, 1),
        "scene_timeline": scene_timeline,
        "scene_counts": scene_counts,
    }
    yield f"event: done\ndata: {json.dumps(done_data, ensure_ascii=False)}\n\n"


@router.post("/benchmark/{session_id}/full-match")
async def run_full_match_benchmark(
    session_id: str, body: FullMatchBenchmarkRequest,
) -> StreamingResponse:
    """録画セッションで1試合通しベンチマークを実行する（SSE）."""
    session_dir = DATA_DIR / session_id
    meta = _read_metadata(session_dir)

    if meta["status"] != "completed":
        raise HTTPException(
            status_code=400, detail="セッションが完了していません",
        )

    frames_dir = session_dir / "frames"
    if not frames_dir.exists() or not any(frames_dir.glob("*.jpg")):
        raise HTTPException(status_code=400, detail="フレームが見つかりません")

    if body.ocr_mode not in ("default", "all", "normal"):
        raise HTTPException(status_code=400, detail="ocr_mode は 'default', 'all', または 'normal' を指定してください")

    return StreamingResponse(
        _full_match_stream(session_id, body.ocr_mode),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# アドホックテスト（フレームビューワー用）
# ---------------------------------------------------------------------------


def _read_frame_image(session_id: str, filename: str) -> np.ndarray:
    """フレーム画像を読み込む."""
    frame_path = DATA_DIR / session_id / "frames" / filename
    if not frame_path.exists():
        raise HTTPException(status_code=404, detail="Frame not found")
    img = cv2.imread(str(frame_path))
    if img is None:
        raise HTTPException(status_code=500, detail="Failed to read image")
    return img


def _run_ocr_test(image: np.ndarray, crop: CropTestRequest) -> dict[str, Any]:
    """クロップ領域を全OCRエンジンでテストする（同期）."""
    from app.dependencies import get_recognizer
    from app.ocr.region import ALL_ENGINES

    recognizer = get_recognizer()
    cropped = image[crop.y : crop.y + crop.h, crop.x : crop.x + crop.w]

    engines: dict[str, Any] = {}
    for engine_name in ALL_ENGINES:
        pipeline = recognizer._get_pipeline(engine_name)
        t0 = time.perf_counter()
        ocr_results = pipeline.run(cropped)
        elapsed = (time.perf_counter() - t0) * 1000
        text = "".join(r.text for r in ocr_results)
        conf = ocr_results[0].confidence if ocr_results else 0.0
        engines[engine_name] = {
            "text": text,
            "confidence": round(conf, 4),
            "elapsed_ms": round(elapsed, 1),
        }

    return {
        "crop": {"x": crop.x, "y": crop.y, "w": crop.w, "h": crop.h},
        "engines": engines,
    }


from app.data.names import get_id_to_name as _get_id_to_name


def _run_pokemon_test(image: np.ndarray, crop: CropTestRequest) -> dict[str, Any]:
    """クロップ領域でポケモン画像認識テストを実行する（同期・詳細版）."""
    from app.dependencies import get_pokemon_matcher

    matcher = get_pokemon_matcher()
    cropped = image[crop.y : crop.y + crop.h, crop.x : crop.x + crop.w]

    t0 = time.perf_counter()
    detailed = matcher.identify_detailed(cropped, k=5)
    elapsed = (time.perf_counter() - t0) * 1000

    id_to_name = _get_id_to_name()

    # クロップ画像を base64 エンコード
    _, buf = cv2.imencode(".jpg", cropped, [cv2.IMWRITE_JPEG_QUALITY, 80])
    crop_b64 = base64.b64encode(buf).decode("ascii")

    # ベストマッチのテンプレート画像を base64 エンコード
    template_b64: str | None = None
    if detailed.candidates:
        best_key = detailed.candidates[0].pokemon_key
        template_path = matcher.resolve_template_path(best_key)
        if template_path.exists():
            template_img = cv2.imread(str(template_path))
            if template_img is not None:
                _, tbuf = cv2.imencode(".jpg", template_img, [cv2.IMWRITE_JPEG_QUALITY, 80])
                template_b64 = base64.b64encode(tbuf).decode("ascii")

    # 後方互換: 閾値以上の最上位候補を result に入れる
    top_result = None
    if detailed.candidates and detailed.candidates[0].confidence >= detailed.threshold:
        c = detailed.candidates[0]
        top_result = {
            "pokemon_key": c.pokemon_key,
            "pokemon_id": c.pokemon_key,
            "confidence": round(c.confidence, 4),
        }

    return {
        "crop": {"x": crop.x, "y": crop.y, "w": crop.w, "h": crop.h},
        "candidates": [
            {
                "pokemon_key": c.pokemon_key,
                "pokemon_id": c.pokemon_key,
                "name": id_to_name.get(c.pokemon_key, c.pokemon_key),
                "confidence": round(c.confidence, 4),
            }
            for c in detailed.candidates
        ],
        "threshold": detailed.threshold,
        "result": top_result,
        "crop_b64": crop_b64,
        "template_b64": template_b64,
        "elapsed_ms": round(elapsed, 1),
    }


@router.post("/recordings/{session_id}/frames/{filename}/ocr-test")
async def run_ocr_test(
    session_id: str, filename: str, body: CropTestRequest,
) -> dict[str, Any]:
    """任意矩形でOCRテストを実行する（全3エンジン比較）."""
    from app.dependencies import ocr_lock

    img = _read_frame_image(session_id, filename)

    async with ocr_lock:
        return await asyncio.to_thread(_run_ocr_test, img, body)


@router.post("/recordings/{session_id}/frames/{filename}/pokemon-test")
async def run_pokemon_test(
    session_id: str, filename: str, body: CropTestRequest,
) -> dict[str, Any]:
    """任意矩形でポケモン画像認識テストを実行する."""
    from app.dependencies import ocr_lock

    img = _read_frame_image(session_id, filename)

    async with ocr_lock:
        return await asyncio.to_thread(_run_pokemon_test, img, body)
