"""共有依存オブジェクト."""

from __future__ import annotations

import asyncio

from app.damage.client import CalcServiceClient
from app.data.game_data import GameData
from app.ocr.region import RegionRecognizer
from app.recognition.pokemon_matcher import PokemonMatcher
from app.recognition.scene_detector import SceneDetector

# OCR の同時実行を防ぐグローバルロック（GPU 直列化）
ocr_lock = asyncio.Lock()

_game_data: GameData | None = None
_recognizer: RegionRecognizer | None = None
_detector: SceneDetector | None = None
_pokemon_matcher: PokemonMatcher | None = None
_calc_client: CalcServiceClient | None = None


def init_recognizer() -> RegionRecognizer:
    """RegionRecognizer を初期化してシングルトンとして保持する."""
    global _recognizer  # noqa: PLW0603
    _recognizer = RegionRecognizer()
    return _recognizer


def init_detector() -> SceneDetector:
    """SceneDetector を初期化してシングルトンとして保持する.

    RegionRecognizer の RegionConfig を共有する。
    init_recognizer() の後に呼ぶこと。
    """
    global _detector  # noqa: PLW0603
    recognizer = get_recognizer()
    _detector = SceneDetector(recognizer._config, recognizer=recognizer)
    return _detector


def shutdown_recognizer() -> None:
    """全 OCR エンジンを解放する."""
    global _recognizer  # noqa: PLW0603
    if _recognizer is not None:
        _recognizer.unload_all()
        _recognizer = None


def init_pokemon_matcher() -> PokemonMatcher:
    """PokemonMatcher を初期化してシングルトンとして保持する."""
    global _pokemon_matcher  # noqa: PLW0603
    _pokemon_matcher = PokemonMatcher()
    return _pokemon_matcher


def shutdown_detector() -> None:
    """SceneDetector を解放する."""
    global _detector  # noqa: PLW0603
    if _detector is not None:
        _detector.clear_cache()
        _detector = None


def shutdown_pokemon_matcher() -> None:
    """PokemonMatcher を解放する (DINOv2 モデル・FAISS インデックスも解放)."""
    global _pokemon_matcher  # noqa: PLW0603
    if _pokemon_matcher is not None:
        _pokemon_matcher.unload()
        _pokemon_matcher = None


def get_recognizer() -> RegionRecognizer:
    """現在の RegionRecognizer を取得する."""
    if _recognizer is None:
        raise RuntimeError("RegionRecognizer が初期化されていません")
    return _recognizer


def get_detector() -> SceneDetector:
    """現在の SceneDetector を取得する."""
    if _detector is None:
        raise RuntimeError("SceneDetector が初期化されていません")
    return _detector


def get_pokemon_matcher() -> PokemonMatcher:
    """現在の PokemonMatcher を取得する."""
    if _pokemon_matcher is None:
        raise RuntimeError("PokemonMatcher が初期化されていません")
    return _pokemon_matcher


# --- GameData ---


def init_game_data() -> GameData:
    """GameData を初期化してシングルトンとして保持する."""
    global _game_data  # noqa: PLW0603
    _game_data = GameData()
    _game_data.load()
    return _game_data


def get_game_data() -> GameData:
    """現在の GameData を取得する."""
    if _game_data is None:
        raise RuntimeError("GameData が初期化されていません")
    return _game_data


# --- CalcServiceClient ---


def init_calc_client() -> CalcServiceClient:
    """CalcServiceClient を初期化してシングルトンとして保持する."""
    global _calc_client  # noqa: PLW0603
    _calc_client = CalcServiceClient()
    return _calc_client


async def shutdown_calc_client() -> None:
    """CalcServiceClient を閉じる."""
    global _calc_client  # noqa: PLW0603
    if _calc_client is not None:
        await _calc_client.close()
        _calc_client = None


def get_calc_client() -> CalcServiceClient:
    """現在の CalcServiceClient を取得する."""
    if _calc_client is None:
        raise RuntimeError("CalcServiceClient が初期化されていません")
    return _calc_client
