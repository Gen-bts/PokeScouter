"""move_name_matching: 設定駆動のわざ名照合."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from app.recognition.move_name_matching import (
    _load_rules,
    iter_normalized_move_ocr_forms,
    match_move_in_learnset,
)


def test_move_ocr_rules_json_validates_at_import() -> None:
    """steps / pipelines の整合性（正規表現コンパイル・参照解決）."""
    _load_rules.cache_clear()
    data = _load_rules()
    assert data["pipelines"]
    assert "latin_u_to_ji_prefix" in data["compiled_steps"]


def test_below_threshold_returns_none() -> None:
    """類似度が閾値未満ならマッチしない."""
    mock_gd = MagicMock()
    mock_gd.get_learnset.return_value = ["hyper-beam"]
    mock_gd.names = {
        "ja": {
            "moves": {
                "はかいこうせん": "hyper-beam",
            },
        },
    }
    _load_rules.cache_clear()
    result = match_move_in_learnset("x", "x", mock_gd, threshold=0.99)
    assert result is None


@pytest.mark.parametrize(
    "raw,expected_substr",
    [
        ("Uしh", "じしん"),
        ("UUん", "じしん"),
        ("UUh", "じしん"),
        ("uuん", "じしん"),
        ("ハパーポス", "ハイパ"),
    ],
)
def test_normalized_forms_contain_expected(raw: str, expected_substr: str) -> None:
    forms = iter_normalized_move_ocr_forms(raw)
    assert any(expected_substr in f for f in forms)
