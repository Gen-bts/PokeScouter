"""設定の読み取り・更新 API."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter

from app.config import Settings, save_settings
from app.dependencies import (
    get_calc_client,
    get_detector,
    get_pokemon_matcher,
    get_settings,
    settings_file_lock,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings", tags=["settings"])

# ランタイム反映不可（再起動必要）なセクション
_RESTART_REQUIRED_PATHS: set[str] = {
    "server",
    "ocr",
    "recognition.pokemon_matcher.model",
}


def _needs_restart(dotted_path: str) -> bool:
    """指定パスの変更に再起動が必要か判定する."""
    for prefix in _RESTART_REQUIRED_PATHS:
        if dotted_path == prefix or dotted_path.startswith(prefix + "."):
            return True
    return False


@router.get("")
async def get_all_settings() -> dict[str, Any]:
    """全設定を返す."""
    settings = get_settings()
    data = settings.model_dump()
    return data


@router.patch("")
async def patch_settings(body: dict[str, Any]) -> dict[str, Any]:
    """設定を部分更新し、TOML に永続化する.

    リクエストボディはネストした辞書で、変更したいキーのみを含む。
    例: {"recognition": {"scene_detector": {"template_threshold": 0.85}}}

    ランタイム反映可能な項目は即時反映する。
    再起動が必要な項目は restart_required=true で通知する。
    """
    settings = get_settings()
    current = settings.model_dump()

    changed_paths: list[str] = []
    _deep_merge(current, body, changed_paths, prefix="")

    # バリデーション: マージ結果を Settings として検証
    updated = Settings.model_validate(current)

    # TOML に書き出し
    async with settings_file_lock:
        save_settings(updated)

    # シングルトンの内部状態を更新
    _apply_to_singleton(settings, updated)

    # ランタイム反映
    restart_required = _apply_runtime_changes(updated, changed_paths)

    return {
        "settings": updated.model_dump(),
        "restart_required": restart_required,
    }


def _deep_merge(
    base: dict[str, Any],
    patch: dict[str, Any],
    changed: list[str],
    prefix: str,
) -> None:
    """patch の値で base を再帰的にマージする."""
    for key, value in patch.items():
        dotted = f"{prefix}{key}" if not prefix else f"{prefix}.{key}"
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _deep_merge(base[key], value, changed, dotted)
        else:
            if base.get(key) != value:
                changed.append(dotted)
            base[key] = value


def _apply_to_singleton(current: Settings, updated: Settings) -> None:
    """get_settings() が返すシングルトンの内容を新しい値で上書きする."""
    # pydantic v2: モデルの __dict__ を直接更新
    for field_name in updated.model_fields:
        setattr(current, field_name, getattr(updated, field_name))


def _apply_runtime_changes(
    settings: Settings,
    changed_paths: list[str],
) -> bool:
    """変更されたパスに基づいてランタイムのシングルトンを更新する.

    Returns:
        再起動が必要な変更が含まれていれば True。
    """
    restart_needed = False

    for path in changed_paths:
        if _needs_restart(path):
            restart_needed = True
            logger.info("設定変更 (再起動必要): %s", path)
            continue

        logger.info("設定変更 (即時反映): %s", path)

    # scene_detector の閾値を即時反映
    if any(p.startswith("recognition.scene_detector") for p in changed_paths):
        try:
            detector = get_detector()
            cfg = settings.recognition.scene_detector
            detector._default_threshold = cfg.template_threshold
            detector._default_ocr_threshold = cfg.ocr_threshold
        except RuntimeError:
            pass

    # pokemon_matcher の閾値を即時反映
    if any(
        p == "recognition.pokemon_matcher.threshold" for p in changed_paths
    ):
        try:
            matcher = get_pokemon_matcher()
            matcher._threshold = settings.recognition.pokemon_matcher.threshold
        except RuntimeError:
            pass

    # calc_service を即時反映（URL/timeout 変更時はクライアント再生成）
    if any(p.startswith("calc_service") for p in changed_paths):
        try:
            client = get_calc_client()
            cfg = settings.calc_service
            # URL が変わった場合はログだけ出す（クライアント再生成は再起動で）
            if client._base_url != cfg.base_url:
                logger.warning(
                    "calc_service.base_url が変更されました (%s → %s)。"
                    "反映には再起動が必要です。",
                    client._base_url, cfg.base_url,
                )
                restart_needed = True
        except RuntimeError:
            pass

    return restart_needed
