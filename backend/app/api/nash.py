"""Nash 選出シミュレーション API (calc-service へのプロキシ)."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.damage.client import CalcServiceClient
from app.dependencies import get_calc_client, get_game_data
from app.damage.stat_estimator import calc_opponent_defense_stats

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/nash", tags=["nash"])


class NashPokemonSpec(BaseModel):
    """Nash 用ポケモン仕様 (実数値まで解決済み)."""

    pokemon_key: str
    stats: dict[str, int]
    ability_key: str | None = None
    item_key: str | None = None
    move_keys: list[str] = Field(default_factory=list)


class NashFieldInput(BaseModel):
    weather: str | None = None
    terrain: str | None = None
    is_doubles: bool = False


class NashSolveRequest(BaseModel):
    """Nash 選出シミュレーションリクエスト.

    フロントエンドから見た「自軍 (OCR 検出済み実数値) vs 相手 (推定)」の対戦を
    team_a / team_b として投げる。相手 team は使用率から最頻技をあらかじめ
    フロントが解決してくる (species_key のみは受け付けない)。
    """

    team_a: list[NashPokemonSpec] = Field(min_length=6, max_length=6)
    team_b: list[NashPokemonSpec] = Field(min_length=6, max_length=6)
    pick_size: int = 3
    field: NashFieldInput | None = None
    prior_a: list[float] | None = None
    prior_alpha_a: float | None = None
    prior_b: list[float] | None = None
    prior_alpha_b: float | None = None
    max_iterations: int = 1000
    tolerance: float = 1e-6


@router.post("/solve")
async def solve_nash(req: NashSolveRequest) -> dict[str, Any]:
    """Nash 選出シミュレーションを calc-service に転送する."""
    calc_client: CalcServiceClient = get_calc_client()
    game_data = get_game_data()

    # 相手側の不完全仕様 (stats 全 0 / move_keys 空) を使用率データで補完する
    def _resolve_opponent(spec: NashPokemonSpec) -> NashPokemonSpec:
        stats_missing = sum(spec.stats.values()) == 0 or all(
            spec.stats.get(k, 0) == 0 for k in ("hp", "atk", "def", "spa", "spd", "spe")
        )
        moves_missing = len(spec.move_keys) == 0
        if not stats_missing and not moves_missing:
            return spec

        pdata = game_data.get_pokemon_by_key(spec.pokemon_key)
        if pdata is None:
            return spec
        base_stats = pdata.get("base_stats", {})

        resolved_stats = spec.stats
        if stats_missing:
            # "balanced_offense" 相当のプリセットで仮の実数値を計算
            resolved_stats = calc_opponent_defense_stats(base_stats, "none", None)

        resolved_moves = spec.move_keys
        if moves_missing:
            usage_entry = game_data.get_usage_data(spec.pokemon_key)
            if usage_entry:
                usage_moves = usage_entry.get("moves", [])
                # 使用率上位 4 技
                top_moves = sorted(usage_moves, key=lambda m: -m.get("usage_percent", 0))[:4]
                resolved_moves = [m["move_key"] for m in top_moves if m.get("move_key")]

        return spec.model_copy(update={"stats": resolved_stats, "move_keys": resolved_moves})

    team_a = [_resolve_opponent(p) for p in req.team_a]
    team_b = [_resolve_opponent(p) for p in req.team_b]

    payload: dict[str, Any] = {
        "team_a": [p.model_dump() for p in team_a],
        "team_b": [p.model_dump() for p in team_b],
        "pick_size": req.pick_size,
        "max_iterations": req.max_iterations,
        "tolerance": req.tolerance,
    }
    if req.field is not None:
        payload["field"] = req.field.model_dump()
    if req.prior_a is not None:
        payload["prior_a"] = req.prior_a
    if req.prior_alpha_a is not None:
        payload["prior_alpha_a"] = req.prior_alpha_a
    if req.prior_b is not None:
        payload["prior_b"] = req.prior_b
    if req.prior_alpha_b is not None:
        payload["prior_alpha_b"] = req.prior_alpha_b

    try:
        return await calc_client.solve_nash(payload)
    except ValueError as e:
        msg = str(e)
        logger.error("calc-service nash エラー: %s", msg)
        raise HTTPException(status_code=503, detail=f"Nash solver service error: {msg}") from e
    except Exception as e:
        logger.error("calc-service nash 呼び出しエラー: %s", e)
        raise HTTPException(status_code=503, detail="Nash solver service connection error") from e
