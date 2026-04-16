"""ポケモンアイコン識別の回帰テスト."""

from __future__ import annotations

import sys
from types import ModuleType, SimpleNamespace

if "torch" not in sys.modules:
    torch_stub = ModuleType("torch")
    torch_stub.cuda = SimpleNamespace(is_available=lambda: False)
    torch_stub.nn = SimpleNamespace(Module=object)
    sys.modules["torch"] = torch_stub

if "torchvision" not in sys.modules:
    torchvision_stub = ModuleType("torchvision")
    transforms_stub = ModuleType("torchvision.transforms")
    transforms_stub.Compose = object
    torchvision_stub.transforms = transforms_stub
    sys.modules["torchvision"] = torchvision_stub
    sys.modules["torchvision.transforms"] = transforms_stub

import numpy as np

from app.recognition.pokemon_matcher import DetailedMatchResult, MatchResult, PokemonMatcher
from app.ws import battle


def test_pokemon_matcher_identify_accepts_uncertain_top1() -> None:
    """margin が狭くても threshold 超えなら top-1 を返す."""
    matcher = object.__new__(PokemonMatcher)
    matcher._threshold = 0.60
    matcher._margin_threshold = 0.03
    matcher.identify_detailed = lambda _img, k=2: DetailedMatchResult(  # type: ignore[method-assign]
        candidates=[
            MatchResult("gengar", 0.868),
            MatchResult("banette", 0.846),
        ],
        threshold=0.60,
        margin_threshold=0.03,
    )

    result = matcher.identify(np.zeros((8, 8, 3), dtype=np.uint8))

    assert result is not None
    assert result.pokemon_key == "gengar"
    assert result.confidence == 0.868


def test_run_pokemon_identification_returns_uncertain_top1(monkeypatch) -> None:
    """team_select でも uncertain な top-1 を未識別に落とさない."""
    frame = np.zeros((32, 32, 3), dtype=np.uint8)
    detailed = DetailedMatchResult(
        candidates=[
            MatchResult("gengar", 0.868),
            MatchResult("banette", 0.846),
            MatchResult("tinkaton", 0.797),
        ],
        threshold=0.60,
        margin_threshold=0.03,
    )

    fake_matcher = SimpleNamespace(
        template_count=1,
        identify_team=lambda _frame, _positions: [detailed],
    )
    fake_recognizer = SimpleNamespace(
        _config=SimpleNamespace(
            _data={
                "scenes": {
                    "team_select": {
                        "pokemon_icons": {
                            "opponent_pokemon_1": {"x": 0, "y": 0, "w": 8, "h": 8},
                        },
                    },
                },
            },
        ),
    )
    fake_settings = SimpleNamespace(
        recognition=SimpleNamespace(
            pokemon_matcher=SimpleNamespace(
                fallback_threshold=0.50,
                fallback_margin_min=0.01,
            ),
        ),
    )

    monkeypatch.setattr(battle, "get_pokemon_matcher", lambda: fake_matcher)
    monkeypatch.setattr(battle, "get_recognizer", lambda: fake_recognizer)
    monkeypatch.setattr(battle, "get_settings", lambda: fake_settings)
    monkeypatch.setattr(battle, "get_id_to_name", lambda: {"gengar": "ゲンガー", "banette": "ジュペッタ"})

    result = battle._run_pokemon_identification(frame, pokemon_icon_cache={})

    assert result is not None
    assert result["type"] == "pokemon_identified"
    assert "crop_images" not in result
    first = result["pokemon"][0]
    assert first["pokemon_key"] == "gengar"
    assert first["pokemon_id"] == "gengar"
    assert first["name"] == "ゲンガー"
    assert first["confidence"] == 0.868
    assert first["uncertain"] is True
