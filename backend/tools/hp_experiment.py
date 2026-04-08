"""HP 読み取り精度実験.

3つのアプローチを比較:
  A: 画像前処理のみ（二値化・コントラスト強調）
  B: 後処理パースのみ（生OCR出力から数値を推定）
  C: 前処理 + 後処理の両方

使い方:
    cd backend
    python -m tools.hp_experiment tests/fixtures/images/hp_crop/hp_image.png
    python -m tools.hp_experiment tests/fixtures/images/hp_crop/  # ディレクトリ指定で一括
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import cv2
import numpy as np

# PaddleOCR の遅延初期化用
_engine = None


def _get_engine():
    global _engine
    if _engine is None:
        from app.ocr.paddle_ocr import PaddleOCREngine
        _engine = PaddleOCREngine()
        _engine.load()
    return _engine


# =========================================================
# 前処理パイプライン
# =========================================================

def preprocess_v1_binary(image: np.ndarray) -> np.ndarray:
    """グレースケール → 大津の二値化."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)


def preprocess_v2_adaptive(image: np.ndarray) -> np.ndarray:
    """グレースケール → 適応的二値化."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    binary = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 15, 5
    )
    return cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)


def preprocess_v3_clahe(image: np.ndarray) -> np.ndarray:
    """CLAHE コントラスト強調 → 大津の二値化."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(4, 4))
    enhanced = clahe.apply(gray)
    _, binary = cv2.threshold(enhanced, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)


def preprocess_v4_invert(image: np.ndarray) -> np.ndarray:
    """白文字を黒背景に反転 → 二値化."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    inverted = cv2.bitwise_not(binary)
    return cv2.cvtColor(inverted, cv2.COLOR_GRAY2BGR)


def preprocess_v5_upscale_binary(image: np.ndarray) -> np.ndarray:
    """2倍拡大 → CLAHE → 大津の二値化."""
    upscaled = cv2.resize(image, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    gray = cv2.cvtColor(upscaled, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    _, binary = cv2.threshold(enhanced, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)


PREPROCESS_METHODS = {
    "binary": preprocess_v1_binary,
    "adaptive": preprocess_v2_adaptive,
    "clahe": preprocess_v3_clahe,
    "invert": preprocess_v4_invert,
    "upscale": preprocess_v5_upscale_binary,
}

# =========================================================
# 後処理パース
# =========================================================

def postprocess_hp(raw_text: str) -> str:
    """OCR 生出力から HP 文字列を推定する.

    対応パターン:
      - "215/215" → そのまま
      - "2151215" → "215/215" (スラッシュ欠落)
      - "215:215" → "215/215"
      - "100%" → そのまま
      - "100" → "100%"（%領域の場合）
    """
    text = raw_text.strip()

    # 既に正しい HP/HP 形式
    if re.match(r"^\d{1,3}/\d{1,3}$", text):
        return text

    # パーセント形式
    if re.match(r"^\d{1,3}%$", text):
        return text

    # 全角→半角変換
    text = text.translate(str.maketrans(
        "０１２３４５６７８９／：％",
        "0123456789/:%",
    ))

    # 変換後に正しい形式になった場合
    if re.match(r"^\d{1,3}/\d{1,3}$", text):
        return text
    if re.match(r"^\d{1,3}%$", text):
        return text

    # : を / に置換
    text = text.replace(":", "/")
    if re.match(r"^\d{1,3}/\d{1,3}$", text):
        return text

    # 数字のみの場合 → スラッシュ欠落を補完
    digits_only = re.sub(r"[^\d]", "", text)
    if digits_only and len(digits_only) >= 2:
        result = _guess_hp_split(digits_only)
        if result:
            return result

    # "/" が "1" に誤認識されるパターン（例: "2151215" → "215/215"）
    # 各 "1" の位置を "/" に置き換えて HP として成立するか試す
    digits_and_ones = re.sub(r"[^\d]", "", text)
    if digits_and_ones and len(digits_and_ones) >= 3:
        result = _guess_slash_as_one(digits_and_ones)
        if result:
            return result

    # パースできなかった場合は元テキストを返す
    return raw_text


def _guess_hp_split(digits: str) -> str | None:
    """連続数字を current/max に分割する.

    制約: current <= max, 両方 1-3桁
    """
    n = len(digits)
    candidates: list[tuple[str, int]] = []

    for split_pos in range(1, n):
        current_str = digits[:split_pos]
        max_str = digits[split_pos:]

        if len(current_str) > 3 or len(max_str) > 3:
            continue
        if not max_str or max_str[0] == "0":
            continue

        current = int(current_str)
        max_hp = int(max_str)

        if current <= 0 or max_hp <= 0:
            continue
        if current > max_hp:
            continue

        # current と max の桁数が近いほうが自然
        digit_diff = abs(len(current_str) - len(max_str))
        candidates.append((f"{current}/{max_hp}", digit_diff))

    if not candidates:
        return None

    # 桁数差が最小のものを優先
    candidates.sort(key=lambda x: x[1])
    return candidates[0][0]


def _guess_slash_as_one(digits: str) -> str | None:
    """'/' が '1' に誤認識された場合を補正する.

    "2151215" の各 "1" を "/" に置き換えて HP 形式になるか試す。
    ポケモンの HP は 1–714 の範囲。
    """
    candidates: list[tuple[str, int]] = []

    for i, ch in enumerate(digits):
        if ch != "1":
            continue
        # この "1" を "/" に置き換え
        left = digits[:i]
        right = digits[i + 1 :]

        if not left or not right:
            continue
        if len(left) > 3 or len(right) > 3:
            continue
        if right[0] == "0":
            continue

        current = int(left)
        max_hp = int(right)

        if current <= 0 or max_hp <= 0 or max_hp > 714:
            continue
        if current > max_hp:
            continue

        # current と max の桁数が同じものを優先
        digit_diff = abs(len(left) - len(right))
        candidates.append((f"{current}/{max_hp}", digit_diff))

    if not candidates:
        return None

    candidates.sort(key=lambda x: x[1])
    return candidates[0][0]


# =========================================================
# 実験実行
# =========================================================

def run_ocr(image: np.ndarray) -> str:
    """PaddleOCR で認識してテキストを結合して返す."""
    engine = _get_engine()
    results = engine.recognize(image)
    return "".join(r.text for r in results)


def experiment_single(image_path: Path) -> None:
    """1枚の画像に対して 3 アプローチを比較."""
    original = cv2.imread(str(image_path))
    if original is None:
        print(f"エラー: 画像を読み込めません: {image_path}")
        return

    print(f"\n{'=' * 70}")
    print(f"画像: {image_path.name}")
    print(f"{'=' * 70}")

    # 元画像での認識（ベースライン）
    raw_baseline = run_ocr(original)
    print(f"\n  ベースライン（無加工）: \"{raw_baseline}\"")

    # --- アプローチ B: 後処理のみ ---
    parsed_baseline = postprocess_hp(raw_baseline)
    print(f"\n  [B] 後処理のみ: \"{raw_baseline}\" → \"{parsed_baseline}\"")

    # --- アプローチ A: 前処理のみ ---
    print(f"\n  [A] 前処理のみ:")
    preprocess_results: dict[str, str] = {}
    for name, func in PREPROCESS_METHODS.items():
        processed = func(original)
        raw = run_ocr(processed)
        preprocess_results[name] = raw
        print(f"      {name:12s}: \"{raw}\"")

    # --- アプローチ C: 前処理 + 後処理 ---
    print(f"\n  [C] 前処理 + 後処理:")
    for name, raw in preprocess_results.items():
        parsed = postprocess_hp(raw)
        marker = " ✓" if "/" in parsed or "%" in parsed else ""
        print(f"      {name:12s}: \"{raw}\" → \"{parsed}\"{marker}")

    # ベースライン + 後処理
    marker = " ✓" if "/" in parsed_baseline or "%" in parsed_baseline else ""
    print(f"      {'(raw+parse)':12s}: \"{raw_baseline}\" → \"{parsed_baseline}\"{marker}")


def main() -> None:
    parser = argparse.ArgumentParser(description="HP 読み取り精度実験 (3アプローチ比較)")
    parser.add_argument("path", help="画像ファイルまたはディレクトリ")
    args = parser.parse_args()

    path = Path(args.path)
    if path.is_dir():
        images = sorted(path.glob("*.png"))
        if not images:
            print(f"エラー: {path} に PNG ファイルがありません")
            sys.exit(1)
        for img_path in images:
            experiment_single(img_path)
    else:
        experiment_single(path)

    print()


if __name__ == "__main__":
    main()
