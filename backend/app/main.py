"""PokeScouter FastAPI アプリケーション."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.health import router as health_router
from app.api.devtools import router as devtools_router
from app.api.pokemon import router as pokemon_router
from app.dependencies import (
    init_detector,
    init_game_data,
    init_pokemon_matcher,
    init_recognizer,
    shutdown_detector,
    shutdown_pokemon_matcher,
    shutdown_recognizer,
)
from app.ws.battle import router as battle_router

logger = logging.getLogger(__name__)

FRONTEND_DIR = Path(__file__).parent.parent.parent / "frontend" / "dist"
TEMPLATES_DIR = Path(__file__).parent.parent.parent / "templates"


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """起動時に RegionRecognizer を初期化、終了時に解放する."""
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
    yield
    logger.info("リソースを解放中...")
    shutdown_pokemon_matcher()
    shutdown_detector()
    shutdown_recognizer()
    logger.info("シャットダウン完了")


app = FastAPI(title="PokeScouter", version="0.1.0", lifespan=lifespan)

# CORS（ローカル開発用）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ルーター登録
app.include_router(health_router)
app.include_router(devtools_router)
app.include_router(pokemon_router)
app.include_router(battle_router)

# スプライト画像配信
if (TEMPLATES_DIR / "pokemon").is_dir():
    app.mount("/sprites", StaticFiles(directory=str(TEMPLATES_DIR / "pokemon")), name="sprites")

# フロントエンド静的ファイル配信（最後にマウント）
if FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
