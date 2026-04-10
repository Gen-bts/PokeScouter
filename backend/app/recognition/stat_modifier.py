"""性格補正（ステータス上昇/下降）の画像認識.

パーティ登録画面2のステータス横に表示される矢羽インジケータを
HSV色分析で検出する。

- 赤い上矢羽（白い縁取り、紫背景）→ "up"（上昇補正）
- 青い下矢羽（白い縁取り、紫背景）→ "down"（下降補正）
- 矢羽なし（紫背景のみ）→ None（補正なし）
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import cv2
import numpy as np

logger = logging.getLogger(__name__)

_DEBUG_DIR = Path(__file__).parent.parent.parent.parent / "debug" / "stat_modifier"

# HSV 閾値
# OpenCV の HSV: H=0-179, S=0-255, V=0-255
#
# ゲーム画面の実測値:
#   紫背景: H≈122-128, S≈93-120, V≈180-220
#   白縁取り: S<50, V>150（矢羽が存在する証拠）
#   赤矢羽: H>160 or H<15（マゼンタ〜赤）
#   青矢羽: H≈75-110（シアン〜青、背景紫より低い H）

# 白ピクセル検出（矢羽の縁取り）
_WHITE_LOWER = np.array([0, 0, 150], dtype=np.uint8)
_WHITE_UPPER = np.array([179, 50, 255], dtype=np.uint8)
_WHITE_MIN_RATIO = 0.03

# 赤ピクセル検出（上昇矢羽の色）
_RED_LOWER1 = np.array([0, 30, 100], dtype=np.uint8)
_RED_UPPER1 = np.array([15, 255, 255], dtype=np.uint8)
_RED_LOWER2 = np.array([160, 30, 100], dtype=np.uint8)
_RED_UPPER2 = np.array([179, 255, 255], dtype=np.uint8)

# 青/シアンピクセル検出（下降矢羽の色、背景紫 H≈120 より低い帯域）
_CYAN_LOWER = np.array([75, 30, 100], dtype=np.uint8)
_CYAN_UPPER = np.array([110, 255, 255], dtype=np.uint8)


def detect_nature_modifier(bgr_image: np.ndarray) -> str | None:
    """クロップ済み画像から性格補正を検出する.

    Args:
        bgr_image: BGR フォーマットのクロップ画像（約26x26px）。

    Returns:
        "up"（上昇補正）、"down"（下降補正）、または None（補正なし）。
    """
    hsv = cv2.cvtColor(bgr_image, cv2.COLOR_BGR2HSV)
    total_pixels = hsv.shape[0] * hsv.shape[1]

    # Step 1: 白ピクセル（矢羽の縁取り）の有無で矢羽の存在を判定
    white_mask = cv2.inRange(hsv, _WHITE_LOWER, _WHITE_UPPER)
    white_count = cv2.countNonZero(white_mask)
    if white_count < total_pixels * _WHITE_MIN_RATIO:
        return None  # 矢羽なし（紫背景のみ）

    # Step 2: 矢羽あり → 赤 vs 青/シアンで上昇/下降を判別
    red_mask1 = cv2.inRange(hsv, _RED_LOWER1, _RED_UPPER1)
    red_mask2 = cv2.inRange(hsv, _RED_LOWER2, _RED_UPPER2)
    red_count = cv2.countNonZero(red_mask1) + cv2.countNonZero(red_mask2)

    cyan_mask = cv2.inRange(hsv, _CYAN_LOWER, _CYAN_UPPER)
    cyan_count = cv2.countNonZero(cyan_mask)

    if red_count > cyan_count:
        return "up"
    if cyan_count > red_count:
        return "down"
    return None


def detect_nature_modifiers_batch(
    frame: np.ndarray,
    regions: list[dict[str, Any]],
) -> dict[str, str | None]:
    """フレーム内の複数領域から性格補正をバッチ検出する.

    Args:
        frame: BGR フルフレーム画像。
        regions: get_stat_modifiers() の戻り値（name, x, y, w, h を含む dict のリスト）。

    Returns:
        リージョン名 → "up" / "down" / None の辞書。
    """
    results: dict[str, str | None] = {}
    # TODO: デバッグ完了後に削除
    _DEBUG_DIR.mkdir(parents=True, exist_ok=True)

    for region in regions:
        x, y, w, h = region["x"], region["y"], region["w"], region["h"]
        crop = frame[y : y + h, x : x + w]
        value = detect_nature_modifier(crop)
        results[region["name"]] = value
        _log_hsv_debug(region["name"], crop, value)

    return results


def _log_hsv_debug(name: str, bgr_image: np.ndarray, result: str | None) -> None:
    """デバッグ: クロップ画像を保存し HSV 分布をログ出力."""
    # 画像保存
    safe_name = name.replace("/", "_").replace("\\", "_")
    cv2.imwrite(str(_DEBUG_DIR / f"{safe_name}.png"), bgr_image)

    # HSV 分布分析
    hsv = cv2.cvtColor(bgr_image, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    total = hsv.shape[0] * hsv.shape[1]

    white_mask = cv2.inRange(hsv, _WHITE_LOWER, _WHITE_UPPER)
    white_count = cv2.countNonZero(white_mask)

    red_mask1 = cv2.inRange(hsv, _RED_LOWER1, _RED_UPPER1)
    red_mask2 = cv2.inRange(hsv, _RED_LOWER2, _RED_UPPER2)
    red_count = cv2.countNonZero(red_mask1) + cv2.countNonZero(red_mask2)

    cyan_mask = cv2.inRange(hsv, _CYAN_LOWER, _CYAN_UPPER)
    cyan_count = cv2.countNonZero(cyan_mask)

    logger.info(
        "性格補正DEBUG [%s] result=%s | "
        "H: min=%d max=%d mean=%.1f | "
        "S: min=%d max=%d mean=%.1f | "
        "V: min=%d max=%d mean=%.1f | "
        "white=%d(%.1f%%) red=%d(%.1f%%) cyan=%d(%.1f%%) total=%d",
        name, result or "neutral",
        h.min(), h.max(), h.mean(),
        s.min(), s.max(), s.mean(),
        v.min(), v.max(), v.mean(),
        white_count, white_count / total * 100,
        red_count, red_count / total * 100,
        cyan_count, cyan_count / total * 100,
        total,
    )
