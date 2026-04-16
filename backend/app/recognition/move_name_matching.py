"""わざ名 OCR 文字列の正規化・照合（設定駆動）.

パーティ登録では `config/move_ocr_rules.json` のパイプラインを適用し、
複数経路のうち辞書上の正式名との類似度が最大のもので learnset / グローバル照合を行う。
"""

from __future__ import annotations

import json
import logging
import re
import unicodedata
from functools import lru_cache
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_CONFIG_PATH = Path(__file__).resolve().parents[2] / "config" / "move_ocr_rules.json"


@lru_cache(maxsize=1)
def _load_rules() -> dict[str, Any]:
    raw = _CONFIG_PATH.read_text(encoding="utf-8")
    data = json.loads(raw)
    steps = data.get("steps", {})
    compiled: dict[str, Any] = {}
    for sid, spec in steps.items():
        t = spec.get("type")
        if t == "regex_sub":
            pat = spec.get("pattern", "")
            try:
                compiled[sid] = ("regex_sub", re.compile(pat), spec.get("replacement", ""))
            except re.error as e:
                raise ValueError(f"move_ocr_rules: steps.{sid}.pattern 不正: {e}") from e
        elif t in ("nfkc_strip", "game_normalize"):
            compiled[sid] = (t,)
        else:
            raise ValueError(f"move_ocr_rules: 未知の type {t!r} (step {sid})")
    pipelines = data.get("pipelines", [])
    for i, pl in enumerate(pipelines):
        for sid in pl:
            if sid not in compiled:
                raise ValueError(f"move_ocr_rules: pipelines[{i}] が未定義の step {sid!r} を参照")
    return {"compiled_steps": compiled, "pipelines": pipelines, "matching": data.get("matching", {})}


def _apply_step(step_id: str, text: str, compiled: dict[str, Any]) -> str:
    spec = compiled[step_id]
    kind = spec[0]
    if kind == "nfkc_strip":
        return unicodedata.normalize("NFKC", text.strip())
    if kind == "game_normalize":
        from app.data.game_data import GameData

        return GameData._ocr_normalize(text)
    if kind == "regex_sub":
        _, rx, repl = spec
        return rx.sub(repl, text)
    raise RuntimeError(f"unknown step kind {kind}")


def run_move_ocr_pipeline(step_ids: list[str], raw: str, compiled: dict[str, Any]) -> str:
    """単一パイプラインを末尾まで適用した文字列を返す."""
    t = raw
    for sid in step_ids:
        t = _apply_step(sid, t, compiled)
    return t


def iter_normalized_move_ocr_forms(raw_ocr: str) -> list[str]:
    """設定された全パイプラインの正規化結果（重複除去・空除外）."""
    data = _load_rules()
    compiled = data["compiled_steps"]
    seen: set[str] = set()
    out: list[str] = []
    for pl in data["pipelines"]:
        s = run_move_ocr_pipeline(pl, raw_ocr, compiled)
        if s and s not in seen:
            seen.add(s)
            out.append(s)
    return out


def best_ratio_to_target(forms: list[str], target_norm: str) -> float:
    from difflib import SequenceMatcher

    if not target_norm or not forms:
        return 0.0
    best = 0.0
    for f in forms:
        r = SequenceMatcher(None, f, target_norm).ratio()
        if r > best:
            best = r
    return best


def match_move_in_learnset(
    ocr_text: str,
    pokemon_key: str,
    game_data: Any,
    threshold: float | None = None,
) -> dict[str, Any] | None:
    """learnset 内のわざと照合。複数パイプラインの最大類似度でスコアする."""
    from app.data.game_data import GameData

    rules = _load_rules()
    match_cfg = rules.get("matching", {})
    th = threshold if threshold is not None else float(match_cfg.get("learnset_min_ratio", 0.6))
    min_margin = float(match_cfg.get("learnset_min_margin", 0.04))
    margin_requires_second = bool(match_cfg.get("learnset_margin_requires_second", True))

    forms = iter_normalized_move_ocr_forms(ocr_text)
    if not any(forms):
        return None

    learnset_keys = game_data.get_learnset(pokemon_key)
    if not learnset_keys:
        return None

    moves_dict = game_data.names.get("ja", {}).get("moves", {})
    key_to_name: dict[str, str] = {
        str(move_key): name for name, move_key in moves_dict.items()
    }

    norm = GameData._ocr_normalize
    scored: list[tuple[float, str, str, str]] = []

    for move_key in learnset_keys:
        name = key_to_name.get(move_key)
        if name is None:
            continue
        norm_name = norm(name)
        if not norm_name:
            continue
        for f in forms:
            if f == norm_name:
                return {
                    "matched_name": name,
                    "move_key": move_key,
                    "matched_key": move_key,
                    "move_id": GameData.legacy_value(move_key),
                    "confidence": 1.0,
                }
        br = best_ratio_to_target(forms, norm_name)
        scored.append((br, move_key, name, norm_name))

    if not scored:
        return None

    scored.sort(key=lambda x: x[0], reverse=True)
    best_ratio, best_key, best_name, _ = scored[0]
    second_ratio = scored[1][0] if len(scored) > 1 else 0.0

    if best_ratio < th:
        return None
    if margin_requires_second and len(scored) > 1 and second_ratio > 0:
        if best_ratio - second_ratio < min_margin:
            return None

    return {
        "matched_name": best_name,
        "move_key": best_key,
        "matched_key": best_key,
        "move_id": GameData.legacy_value(best_key),
        "confidence": round(best_ratio, 4),
    }


def pick_best_forms_for_global_fuzzy(ocr_text: str) -> list[str]:
    """グローバル fuzzy_match_move_name に渡す文字列候補（パイプライン結果の順序維持）."""
    return iter_normalized_move_ocr_forms(ocr_text)
