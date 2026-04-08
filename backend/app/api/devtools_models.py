"""DevTools API の Pydantic モデル定義."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class SessionCreate(BaseModel):
    """録画セッション作成リクエスト."""

    description: str = ""


class SessionMetadata(BaseModel):
    """録画セッションのメタデータ."""

    session_id: str
    created_at: str
    frame_count: int
    duration_ms: int
    resolution: tuple[int, int]
    status: str  # "recording" | "completed"
    description: str


class FrameInfo(BaseModel):
    """フレーム情報."""

    index: int
    filename: str
    timestamp_ms: int


# ---------------------------------------------------------------------------
# リージョン（OCR読み取り用クロップ）
# ---------------------------------------------------------------------------


class RegionUpdate(BaseModel):
    """リージョン追加/更新リクエスト（名前を body に含む）."""

    name: str
    x: int
    y: int
    w: int
    h: int
    engine: str = "paddle"


# ---------------------------------------------------------------------------
# 検出クロップ（シーン判定用）
# ---------------------------------------------------------------------------


class DetectionRegionUpdate(BaseModel):
    """検出リージョン追加/更新リクエスト."""

    name: str
    x: int
    y: int
    w: int
    h: int
    method: str = "template"
    params: dict[str, Any] = {}


# ---------------------------------------------------------------------------
# シーン管理
# ---------------------------------------------------------------------------


class SceneCreate(BaseModel):
    """シーン作成リクエスト."""

    key: str
    display_name: str = ""
    description: str = ""


class SceneUpdate(BaseModel):
    """シーンメタデータ更新リクエスト."""

    display_name: str | None = None
    description: str | None = None


class SceneReorder(BaseModel):
    """シーン並び替えリクエスト."""

    keys: list[str]


# ---------------------------------------------------------------------------
# オフラインベンチマーク
# ---------------------------------------------------------------------------


class BenchmarkRequest(BaseModel):
    """オフラインベンチマークリクエスト."""

    scene: str
