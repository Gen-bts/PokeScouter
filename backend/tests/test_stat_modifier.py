"""stat_modifier モジュールのユニットテスト.

合成画像を使って HSV 色分析のロジックを検証する。GPU 不要。
実ゲーム画面の構成: 紫背景 (H≈124) + 白縁取り + 赤/シアン矢羽
"""

from __future__ import annotations

import numpy as np
import pytest

from app.recognition.stat_modifier import (
    detect_nature_modifier,
    detect_nature_modifiers_batch,
)

# 実測に近い色定義 (BGR)
_PURPLE_BG = (190, 140, 170)   # ゲーム紫背景: H≈124, S≈105, V≈200
_WHITE = (255, 255, 255)       # 矢羽の白縁取り
_RED_ARROW = (80, 80, 220)     # 上昇矢羽の赤/ピンク: H≈0, magenta寄り
_CYAN_ARROW = (200, 180, 120)  # 下降矢羽のシアン: H≈90


def _make_solid_bgr(b: int, g: int, r: int, w: int = 26, h: int = 26) -> np.ndarray:
    """指定 BGR 色のべた塗り画像を生成."""
    img = np.zeros((h, w, 3), dtype=np.uint8)
    img[:, :] = (b, g, r)
    return img


def _make_arrow_image(
    arrow_color: tuple[int, int, int],
    w: int = 26, h: int = 26,
) -> np.ndarray:
    """紫背景 + 白縁 + 色付き矢羽 のシミュレーション画像を生成."""
    img = np.zeros((h, w, 3), dtype=np.uint8)
    img[:, :] = _PURPLE_BG  # 紫背景
    # 白縁取り（外側のシェブロン形状を簡易的にシミュレート）
    img[4:8, 8:18] = _WHITE
    img[14:18, 8:18] = _WHITE
    # 矢羽の色部分
    img[8:14, 6:20] = arrow_color
    return img


class TestDetectNatureModifier:
    """detect_nature_modifier の単体テスト."""

    def test_purple_background_returns_none(self) -> None:
        """紫背景のみ（矢羽なし）→ None."""
        img = _make_solid_bgr(*_PURPLE_BG)
        assert detect_nature_modifier(img) is None

    def test_red_arrow_returns_up(self) -> None:
        """紫背景 + 白縁 + 赤矢羽 → 'up'."""
        img = _make_arrow_image(_RED_ARROW)
        assert detect_nature_modifier(img) == "up"

    def test_cyan_arrow_returns_down(self) -> None:
        """紫背景 + 白縁 + シアン矢羽 → 'down'."""
        img = _make_arrow_image(_CYAN_ARROW)
        assert detect_nature_modifier(img) == "down"

    def test_white_only_returns_none(self) -> None:
        """白のみ → None（白は矢羽存在の証拠だが色情報がない）."""
        img = _make_solid_bgr(240, 240, 240)
        # 白だけだと赤もシアンも0 → None
        assert detect_nature_modifier(img) is None

    def test_dark_returns_none(self) -> None:
        """暗い画像 → None."""
        img = _make_solid_bgr(10, 10, 10)
        assert detect_nature_modifier(img) is None

    def test_game_like_neutral(self) -> None:
        """実ゲーム風のニュートラル: 紫背景べた塗り（S=93-120）."""
        # 実測: H=122-128, S=93-120, V=180-220 → 白ピクセルなし → None
        img = _make_solid_bgr(b=200, g=150, r=180)
        assert detect_nature_modifier(img) is None


class TestDetectNatureModifiersBatch:
    """detect_nature_modifiers_batch のテスト."""

    def test_batch_detection(self) -> None:
        """複数領域を一括検出できる."""
        frame = np.zeros((200, 200, 3), dtype=np.uint8)
        frame[:, :] = _PURPLE_BG

        # 赤矢羽領域 (0,0)-(26,26): 白縁 + 赤
        frame[4:8, 8:18] = _WHITE
        frame[8:14, 6:20] = _RED_ARROW

        # シアン矢羽領域 (0,50)-(26,76): 白縁 + シアン
        frame[4:8, 58:68] = _WHITE
        frame[8:14, 56:70] = _CYAN_ARROW

        # 紫背景領域 (0,100)-(26,126) はそのまま

        regions = [
            {"name": "こうげき性格補正", "x": 0, "y": 0, "w": 26, "h": 26},
            {"name": "ぼうぎょ性格補正", "x": 50, "y": 0, "w": 26, "h": 26},
            {"name": "とくこう性格補正", "x": 100, "y": 0, "w": 26, "h": 26},
        ]

        results = detect_nature_modifiers_batch(frame, regions)
        assert results["こうげき性格補正"] == "up"
        assert results["ぼうぎょ性格補正"] == "down"
        assert results["とくこう性格補正"] is None

    def test_empty_regions(self) -> None:
        """空のリージョンリスト → 空の結果."""
        frame = np.zeros((100, 100, 3), dtype=np.uint8)
        assert detect_nature_modifiers_batch(frame, []) == {}
