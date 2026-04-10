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
    read_once: bool = False


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
# ポケモンアイコン（画像認識用クロップ）
# ---------------------------------------------------------------------------


class PokemonIconUpdate(BaseModel):
    """ポケモンアイコン追加/更新リクエスト."""

    name: str
    x: int
    y: int
    w: int
    h: int
    read_once: bool = False


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
    interval_ms: int | None = None


class SceneReorder(BaseModel):
    """シーン並び替えリクエスト."""

    keys: list[str]


# ---------------------------------------------------------------------------
# オフラインベンチマーク
# ---------------------------------------------------------------------------


class BenchmarkRequest(BaseModel):
    """オフラインベンチマークリクエスト."""

    scene: str


class FullMatchBenchmarkRequest(BaseModel):
    """1試合通しベンチマークリクエスト."""

    ocr_mode: str = "default"  # "default" = 設定エンジンのみ, "all" = 全エンジン比較


# ---------------------------------------------------------------------------
# アドホックテスト（フレームビューワー用）
# ---------------------------------------------------------------------------


class CropTestRequest(BaseModel):
    """任意矩形のOCR/認識テストリクエスト."""

    x: int
    y: int
    w: int
    h: int


# ---------------------------------------------------------------------------
# リージョングループ（テンプレート + スロットによる一括定義）
# ---------------------------------------------------------------------------


class RegionGroupTemplateEntry(BaseModel):
    """リージョングループのテンプレートサブリージョン."""

    dx: int
    dy: int
    w: int
    h: int
    type: str = "region"  # "region" | "pokemon_icon"
    engine: str = "paddle"
    read_once: bool = False


class RegionGroupSlot(BaseModel):
    """リージョングループのスロット（アンカー位置）."""

    name: str
    x: int
    y: int


class RegionGroupCreate(BaseModel):
    """リージョングループ作成リクエスト."""

    group_name: str
    template: dict[str, RegionGroupTemplateEntry] = {}
    slots: list[RegionGroupSlot] = []


class RegionGroupTemplateUpdate(BaseModel):
    """テンプレートサブリージョン追加/更新リクエスト."""

    sub_name: str
    dx: int
    dy: int
    w: int
    h: int
    type: str = "region"
    engine: str = "paddle"
    read_once: bool = False


class RegionGroupSlotUpdate(BaseModel):
    """スロットアンカー追加/更新リクエスト."""

    name: str
    x: int
    y: int
