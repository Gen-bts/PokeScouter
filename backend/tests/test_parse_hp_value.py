"""_parse_hp_value のテスト."""

from __future__ import annotations

import pytest

from app.ws.battle import _parse_hp_value


class TestParseHpValue:
    """HP 実数値パーサーのテスト."""

    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("156", 156),
            ("210", 210),
            ("1", 1),
            ("999", 999),
            ("73", 73),
        ],
    )
    def test_normal_values(self, text: str, expected: int) -> None:
        assert _parse_hp_value(text) == expected

    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("l56", 156),   # l → 1
            ("I56", 156),   # I → 1
            ("21O", 210),   # O → 0
            ("2lo", 210),   # l → 1, o → 0
        ],
    )
    def test_ocr_correction(self, text: str, expected: int) -> None:
        assert _parse_hp_value(text) == expected

    @pytest.mark.parametrize(
        "text",
        [
            " 156 ",
            "  210  ",
            " 73",
        ],
    )
    def test_whitespace(self, text: str) -> None:
        assert _parse_hp_value(text) is not None

    @pytest.mark.parametrize(
        "text",
        [
            "",
            "abc",
            "---",
            "   ",
        ],
    )
    def test_invalid_returns_none(self, text: str) -> None:
        assert _parse_hp_value(text) is None

    def test_zero_returns_none(self) -> None:
        """0 は有効範囲外 (1-999)."""
        assert _parse_hp_value("0") is None

    def test_over_999_returns_none(self) -> None:
        """1000 以上は有効範囲外."""
        assert _parse_hp_value("1000") is None
