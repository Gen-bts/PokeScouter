"""calc-service (Node.js) への非同期 HTTP クライアント."""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_DEFAULT_BASE_URL = "http://localhost:3100"
_TIMEOUT = 5.0  # seconds


class CalcServiceClient:
    """calc-service との通信を管理する非同期 HTTP クライアント."""

    def __init__(
        self,
        base_url: str | None = None,
        timeout: float | None = None,
    ) -> None:
        self._base_url = base_url or os.environ.get(
            "CALC_SERVICE_URL", _DEFAULT_BASE_URL,
        )
        self._timeout = timeout if timeout is not None else _TIMEOUT
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            timeout=self._timeout,
        )

    async def health_check(self) -> bool:
        """calc-service が起動しているか確認する."""
        try:
            resp = await self._client.get("/calc/health")
            return resp.status_code == 200
        except httpx.HTTPError:
            return False

    async def calculate_damage(self, request: dict[str, Any]) -> dict[str, Any]:
        """ダメージ計算リクエストを calc-service に送信する.

        Raises:
            httpx.HTTPError: 通信エラー
            ValueError: calc-service が 4xx/5xx を返した場合
        """
        resp = await self._client.post("/calc/damage", json=request)
        if resp.status_code != 200:
            detail = resp.text[:200]
            raise ValueError(
                f"calc-service returned {resp.status_code}: {detail}",
            )
        return resp.json()

    async def validate_team(self, request: dict[str, Any]) -> dict[str, Any]:
        """チーム検証リクエストを calc-service に送信する."""
        resp = await self._client.post("/calc/validate", json=request)
        if resp.status_code != 200:
            detail = resp.text[:200]
            raise ValueError(
                f"calc-service returned {resp.status_code}: {detail}",
            )
        return resp.json()

    async def optimize_hbd(self, request: dict[str, Any]) -> dict[str, Any]:
        """HBD 耐久指数最適化リクエストを calc-service に送信する."""
        resp = await self._client.post("/optimize/hbd", json=request)
        if resp.status_code != 200:
            detail = resp.text[:200]
            raise ValueError(
                f"calc-service returned {resp.status_code}: {detail}",
            )
        return resp.json()

    async def solve_nash(self, request: dict[str, Any]) -> dict[str, Any]:
        """Nash 選出シミュレーションを calc-service に送信する (重い処理のため長めタイムアウト)."""
        resp = await self._client.post(
            "/nash/solve",
            json=request,
            timeout=30.0,  # Nash 20×20 は最悪ケースで数秒
        )
        if resp.status_code != 200:
            detail = resp.text[:200]
            raise ValueError(
                f"calc-service returned {resp.status_code}: {detail}",
            )
        return resp.json()

    async def close(self) -> None:
        """HTTP クライアントを閉じる."""
        await self._client.aclose()
