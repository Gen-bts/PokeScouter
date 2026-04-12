"""PokeScouter FastAPI アプリケーション."""

from __future__ import annotations

import logging
import json
from contextlib import asynccontextmanager
from functools import lru_cache
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.damage import router as damage_router
from app.api.health import router as health_router
from app.api.devtools import router as devtools_router
from app.api.parties import router as parties_router
from app.api.pokemon import router as pokemon_router
from app.api.settings import router as settings_router
from app.config import Settings, load_settings
from app.dependencies import (
    init_calc_client,
    init_detector,
    init_game_data,
    init_pokemon_matcher,
    init_recognizer,
    init_settings,
    shutdown_calc_client,
    shutdown_detector,
    shutdown_pokemon_matcher,
    shutdown_recognizer,
)
from app.ws.battle import router as battle_router


def _resolve_log_dir(settings: Settings) -> Path:
    """ログディレクトリの絶対パスを返す."""
    log_dir = Path(settings.server.logging.log_dir)
    if not log_dir.is_absolute():
        log_dir = Path(__file__).parent.parent.parent / log_dir
    return log_dir


def setup_logging(settings: Settings) -> None:
    """ロギングを設定する（コンソール + ファイル + 認識監査 JSONL）."""
    log_cfg = settings.server.logging
    log_dir = _resolve_log_dir(settings)
    log_dir.mkdir(parents=True, exist_ok=True)

    root = logging.getLogger()
    # --reload 時の重複ハンドラを防止
    root.handlers.clear()
    root.setLevel(logging.DEBUG)

    # コンソール: INFO
    console = logging.StreamHandler()
    console.setLevel(logging.INFO)
    console.setFormatter(logging.Formatter(
        "%(asctime)s %(levelname)-5s [%(name)s] %(message)s",
        datefmt="%H:%M:%S",
    ))
    root.addHandler(console)

    # ファイル: DEBUG, ローテーション
    file_handler = RotatingFileHandler(
        log_dir / "pokescouter.log",
        maxBytes=log_cfg.max_bytes,
        backupCount=log_cfg.backup_count,
        encoding="utf-8",
    )
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(logging.Formatter(
        "%(asctime)s %(levelname)-5s [%(name)s:%(lineno)d] %(message)s",
    ))
    root.addHandler(file_handler)

    # 認識監査ログ: JSONL（コンソール/ファイルには流さない）
    audit = logging.getLogger("recognition_audit")
    audit.handlers.clear()
    audit.propagate = False
    audit_handler = RotatingFileHandler(
        log_dir / "recognition.jsonl",
        maxBytes=log_cfg.audit_max_bytes,
        backupCount=log_cfg.audit_backup_count,
        encoding="utf-8",
    )
    audit_handler.setFormatter(logging.Formatter("%(message)s"))
    audit.addHandler(audit_handler)
    audit.setLevel(logging.INFO)


_boot_settings = load_settings()
setup_logging(_boot_settings)

logger = logging.getLogger(__name__)

FRONTEND_DIR = Path(__file__).parent.parent.parent / "frontend" / "dist"
TEMPLATES_DIR = Path(__file__).parent.parent.parent / "templates"
POKEMON_SPRITES_DIR = TEMPLATES_DIR / "pokemon"
POKEMON_SPRITE_MANIFEST = POKEMON_SPRITES_DIR / "manifest.json"
ITEM_SPRITES_DIR = TEMPLATES_DIR / "items"
POKEMON_SNAPSHOT_PATH = (
    Path(__file__).parent.parent.parent / "data" / "showdown" / "champions-bss-reg-ma" / "pokemon.json"
)


def _normalize_asset_key(value: str) -> str:
    return "".join(ch for ch in value.lower() if ch.isalnum())


@lru_cache(maxsize=1)
def _load_pokemon_sprite_manifest() -> dict[str, str]:
    if not POKEMON_SPRITE_MANIFEST.exists():
        return {}
    payload = json.loads(POKEMON_SPRITE_MANIFEST.read_text(encoding="utf-8"))
    if isinstance(payload, dict) and isinstance(payload.get("sprites"), dict):
        return payload["sprites"]
    return payload if isinstance(payload, dict) else {}


@lru_cache(maxsize=1)
def _load_pokemon_sprite_fallbacks() -> dict[str, str]:
    if not POKEMON_SNAPSHOT_PATH.exists():
        return {}

    payload = json.loads(POKEMON_SNAPSHOT_PATH.read_text(encoding="utf-8"))
    manifest = _load_pokemon_sprite_manifest()
    fallbacks: dict[str, str] = {}

    for pokemon_key, pdata in payload.items():
        if not isinstance(pdata, dict):
            continue

        candidates: list[str] = []
        num = pdata.get("num")
        if isinstance(num, int):
            candidates.append(f"{num}.png")

        sprite_id = pdata.get("sprite_id")
        if isinstance(sprite_id, str) and sprite_id:
            candidates.append(f"{sprite_id}.png")

        base_species_key = pdata.get("base_species_key")
        if isinstance(base_species_key, str):
            mapped = manifest.get(base_species_key)
            if mapped:
                candidates.append(mapped)

        for candidate in candidates:
            candidate_path = POKEMON_SPRITES_DIR / candidate
            if candidate_path.exists():
                fallbacks[pokemon_key] = candidate
                break

    return fallbacks


def _resolve_pokemon_sprite_path(pokemon_key: str) -> Path | None:
    direct = POKEMON_SPRITES_DIR / f"{pokemon_key}.png"
    if direct.exists():
        return direct

    mapped_name = _load_pokemon_sprite_manifest().get(pokemon_key)
    if not mapped_name:
        mapped_name = _load_pokemon_sprite_fallbacks().get(pokemon_key)
    if mapped_name:
        mapped_path = POKEMON_SPRITES_DIR / mapped_name
        if mapped_path.exists():
            return mapped_path

    if pokemon_key.isdigit():
        numeric_path = POKEMON_SPRITES_DIR / f"{pokemon_key}.png"
        if numeric_path.exists():
            return numeric_path
    return None


@lru_cache(maxsize=1)
def _load_item_sprite_index() -> dict[str, str]:
    if not ITEM_SPRITES_DIR.is_dir():
        return {}

    index: dict[str, str] = {}
    for path in ITEM_SPRITES_DIR.glob("*.png"):
        index[_normalize_asset_key(path.stem)] = path.name
    return index


def _resolve_item_sprite_path(item_ref: str) -> Path | None:
    direct = ITEM_SPRITES_DIR / f"{item_ref}.png"
    if direct.exists():
        return direct

    normalized = _normalize_asset_key(item_ref)
    mapped_name = _load_item_sprite_index().get(normalized)
    if not mapped_name:
        return None

    mapped_path = ITEM_SPRITES_DIR / mapped_name
    if mapped_path.exists():
        return mapped_path
    return None


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """起動時に RegionRecognizer を初期化、終了時に解放する."""
    logger.info("Settings を読み込み中...")
    init_settings()
    logger.info("Settings 読み込み完了")
    logger.info("GameData を読み込み中...")
    init_game_data()
    logger.info("GameData 読み込み完了")
    logger.info("RegionRecognizer を初期化中...")
    init_recognizer()
    logger.info("RegionRecognizer 初期化完了")
    logger.info("SceneDetector を初期化中...")
    init_detector()
    logger.info("SceneDetector 初期化完了")
    logger.info("PokemonMatcher を初期化中...")
    init_pokemon_matcher()
    logger.info("PokemonMatcher 初期化完了")
    logger.info("CalcServiceClient を初期化中...")
    calc_client = init_calc_client()
    if await calc_client.health_check():
        logger.info("CalcServiceClient 初期化完了 (calc-service 接続OK)")
    else:
        logger.warning("calc-service に接続できません (ダメージ計算は無効)")
    yield
    logger.info("リソースを解放中...")
    await shutdown_calc_client()
    shutdown_pokemon_matcher()
    shutdown_detector()
    shutdown_recognizer()
    logger.info("シャットダウン完了")


app = FastAPI(title="PokeScouter", version="0.1.0", lifespan=lifespan)

# CORS（設定ファイルから読み込み）
app.add_middleware(
    CORSMiddleware,
    allow_origins=_boot_settings.server.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ルーター登録
app.include_router(health_router)
app.include_router(damage_router)
app.include_router(devtools_router)
app.include_router(parties_router)
app.include_router(pokemon_router)
app.include_router(settings_router)
app.include_router(battle_router)

# スプライト画像配信
@app.get("/sprites/{pokemon_key}.png")
async def get_pokemon_sprite(pokemon_key: str) -> FileResponse:
    sprite_path = _resolve_pokemon_sprite_path(pokemon_key)
    if sprite_path is None:
        raise HTTPException(status_code=404, detail="Pokemon sprite not found")
    return FileResponse(sprite_path, media_type="image/png")

@app.get("/item-sprites/{item_ref}.png")
async def get_item_sprite(item_ref: str) -> FileResponse:
    sprite_path = _resolve_item_sprite_path(item_ref)
    if sprite_path is None:
        raise HTTPException(status_code=404, detail="Item sprite not found")
    return FileResponse(sprite_path, media_type="image/png")

# フロントエンド静的ファイル配信（最後にマウント）
if FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=_boot_settings.server.host,
        port=_boot_settings.server.port,
        reload=True,
    )
