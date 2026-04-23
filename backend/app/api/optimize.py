"""HBD 耐久指数最適化 API (calc-service へのプロキシ)."""

from __future__ import annotations

import logging
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.damage.client import CalcServiceClient
from app.dependencies import get_calc_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/optimize", tags=["optimize"])


class ThreatWeights(BaseModel):
    """物理/特殊脅威の重み (合計は 1 に正規化される)."""

    phys: float = Field(ge=0)
    spec: float = Field(ge=0)


class StatPointAllocation(BaseModel):
    """SP 配分 (Champions: 各 0-32, 合計 ≤ 66)."""

    hp: int = 0
    atk: int = 0
    def_: int = Field(default=0, alias="def")
    spa: int = 0
    spd: int = 0
    spe: int = 0

    model_config = {"populate_by_name": True}


class HbdOptimizeRequest(BaseModel):
    """HBD 最適化リクエスト."""

    pokemon_key: str
    nature: str | None = None
    weights: ThreatWeights | None = None
    fixed_sp: dict[str, int] | None = None
    budget: int | None = None
    hp_constraint: Literal["leftovers", "sitrus", "residual"] | None = None


@router.post("/hbd")
async def optimize_hbd(req: HbdOptimizeRequest) -> dict[str, Any]:
    """HBD 耐久指数最適化を calc-service に転送する."""
    calc_client: CalcServiceClient = get_calc_client()

    payload: dict[str, Any] = {"pokemon_key": req.pokemon_key}
    if req.nature is not None:
        payload["nature"] = req.nature
    if req.weights is not None:
        payload["weights"] = req.weights.model_dump()
    if req.fixed_sp is not None:
        payload["fixed_sp"] = req.fixed_sp
    if req.budget is not None:
        payload["budget"] = req.budget
    if req.hp_constraint is not None:
        payload["hp_constraint"] = req.hp_constraint

    try:
        return await calc_client.optimize_hbd(payload)
    except ValueError as e:
        msg = str(e)
        if "404" in msg:
            raise HTTPException(status_code=404, detail=msg) from e
        logger.error("calc-service optimize エラー: %s", msg)
        raise HTTPException(status_code=503, detail="HBD 最適化サービスに接続できません") from e
    except Exception as e:
        logger.error("calc-service optimize 呼び出しエラー: %s", e)
        raise HTTPException(status_code=503, detail="HBD 最適化サービスに接続できません") from e
