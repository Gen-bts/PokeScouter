"""アプリケーション設定の定義・読み込み・書き出し."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

from pydantic import BaseModel

_DEFAULT_CONFIG_PATH = Path(__file__).parent.parent / "config" / "settings.toml"


# ---------------------------------------------------------------------------
# サーバー設定
# ---------------------------------------------------------------------------

class LoggingConfig(BaseModel):
    """ログ設定."""

    log_dir: str = "debug"
    max_bytes: int = 5 * 1024 * 1024
    backup_count: int = 3
    audit_max_bytes: int = 2 * 1024 * 1024
    audit_backup_count: int = 5


class ServerConfig(BaseModel):
    """サーバー設定（再起動必要）."""

    host: str = "0.0.0.0"
    port: int = 8000
    cors_origins: list[str] = ["*"]
    logging: LoggingConfig = LoggingConfig()


# ---------------------------------------------------------------------------
# calc-service 設定
# ---------------------------------------------------------------------------

class CalcServiceConfig(BaseModel):
    """calc-service 接続設定."""

    base_url: str = "http://localhost:3100"
    timeout: float = 5.0


# ---------------------------------------------------------------------------
# OCR エンジン設定（再起動必要）
# ---------------------------------------------------------------------------

class GlmConfig(BaseModel):
    """GLM-OCR エンジン設定."""

    model_id: str = "zai-org/GLM-OCR"
    max_new_tokens: int = 512


class PaddleConfig(BaseModel):
    """PaddleOCR エンジン設定."""

    det_model: str = "PP-OCRv5_mobile_det"
    rec_model: str = "PP-OCRv5_mobile_rec"
    device: str = "gpu:0"


class OcrConfig(BaseModel):
    """OCR 全体設定."""

    glm: GlmConfig = GlmConfig()
    paddle: PaddleConfig = PaddleConfig()


# ---------------------------------------------------------------------------
# 認識設定
# ---------------------------------------------------------------------------

class SceneDetectorConfig(BaseModel):
    """シーン検出の閾値設定."""

    template_threshold: float = 0.80
    ocr_threshold: float = 0.5


class PokemonMatcherConfig(BaseModel):
    """ポケモン識別設定."""

    threshold: float = 0.60
    model: str = "dinov2_vits14"


class PartyRegisterConfig(BaseModel):
    """パーティ登録の検出設定."""

    detection_debounce: int = 3
    detection_debounce_high_conf: int = 2
    high_confidence_threshold: float = 0.95
    detection_timeout_s: float = 60.0


class SceneStateConfig(BaseModel):
    """シーンステートマシンのデバウンス設定."""

    top_debounce: int = 3
    sub_debounce: int = 2
    sub_revert_count: int = 3
    force_cooldown_seconds: float = 2.0


class RecognitionConfig(BaseModel):
    """認識全体設定."""

    scene_detector: SceneDetectorConfig = SceneDetectorConfig()
    pokemon_matcher: PokemonMatcherConfig = PokemonMatcherConfig()
    party_register: PartyRegisterConfig = PartyRegisterConfig()
    scene_state: SceneStateConfig = SceneStateConfig()


# ---------------------------------------------------------------------------
# ルート設定
# ---------------------------------------------------------------------------

class Settings(BaseModel):
    """アプリケーション全体の設定."""

    server: ServerConfig = ServerConfig()
    calc_service: CalcServiceConfig = CalcServiceConfig()
    ocr: OcrConfig = OcrConfig()
    recognition: RecognitionConfig = RecognitionConfig()


# ---------------------------------------------------------------------------
# 読み込み / 書き出し
# ---------------------------------------------------------------------------

def load_settings(path: Path | None = None) -> Settings:
    """TOML ファイルから設定を読み込む.

    ファイルが存在しない場合は全デフォルト値で生成する。
    環境変数 ``CALC_SERVICE_URL`` が設定されている場合は上書きする（後方互換）。
    """
    config_path = path or _DEFAULT_CONFIG_PATH

    if sys.version_info >= (3, 11):
        import tomllib
    else:
        import tomli as tomllib  # type: ignore[import-untyped]

    if config_path.exists():
        with open(config_path, "rb") as f:
            data: dict[str, Any] = tomllib.load(f)
    else:
        data = {}

    # 環境変数による上書き（後方互換）
    calc_url = os.environ.get("CALC_SERVICE_URL")
    if calc_url:
        data.setdefault("calc_service", {})["base_url"] = calc_url

    return Settings.model_validate(data)


def save_settings(settings: Settings, path: Path | None = None) -> None:
    """設定を TOML ファイルに書き出す."""
    import tomli_w

    config_path = path or _DEFAULT_CONFIG_PATH
    config_path.parent.mkdir(parents=True, exist_ok=True)

    data = settings.model_dump()
    with open(config_path, "wb") as f:
        tomli_w.dump(data, f)
