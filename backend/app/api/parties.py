"""パーティ保存 CRUD API."""

from __future__ import annotations

import json
import uuid
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

_DATA_DIR = Path(__file__).parent.parent.parent.parent / "data" / "parties"
_PARTIES_FILE = _DATA_DIR / "parties.json"

router = APIRouter(prefix="/api/parties", tags=["parties"])


def _read_parties() -> list[dict[str, Any]]:
    """parties.json を読み込む."""
    if not _PARTIES_FILE.exists():
        return []
    return json.loads(_PARTIES_FILE.read_text(encoding="utf-8"))


def _write_parties(parties: list[dict[str, Any]]) -> None:
    """parties.json に書き込む."""
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    _PARTIES_FILE.write_text(
        json.dumps(parties, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


class PartySlotBody(BaseModel):
    position: int
    pokemonId: int | None = None
    name: str | None = None
    fields: dict[str, Any] = {}
    megaForm: dict[str, Any] | None = None


class PartySaveBody(BaseModel):
    name: str
    slots: list[PartySlotBody]


class PartyUpdateBody(BaseModel):
    name: str | None = None
    slots: list[PartySlotBody] | None = None


@router.get("")
def list_parties() -> list[dict[str, Any]]:
    """保存済みパーティ一覧を返す."""
    return _read_parties()


@router.post("", status_code=201)
def create_party(body: PartySaveBody) -> dict[str, Any]:
    """新規パーティを保存する."""
    parties = _read_parties()
    entry: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "name": body.name,
        "slots": [s.model_dump() for s in body.slots],
        "savedAt": int(time.time() * 1000),
    }
    parties.append(entry)
    _write_parties(parties)
    return entry


@router.put("/{party_id}")
def update_party(party_id: str, body: PartyUpdateBody) -> dict[str, Any]:
    """既存パーティを上書き更新する."""
    parties = _read_parties()
    for i, p in enumerate(parties):
        if p["id"] == party_id:
            if body.name is not None:
                parties[i]["name"] = body.name
            if body.slots is not None:
                parties[i]["slots"] = [s.model_dump() for s in body.slots]
            parties[i]["savedAt"] = int(time.time() * 1000)
            _write_parties(parties)
            return parties[i]
    raise HTTPException(status_code=404, detail="Party not found")


@router.delete("/{party_id}", status_code=204)
def delete_party(party_id: str) -> None:
    """パーティを削除する."""
    parties = _read_parties()
    new_parties = [p for p in parties if p["id"] != party_id]
    if len(new_parties) == len(parties):
        raise HTTPException(status_code=404, detail="Party not found")
    _write_parties(new_parties)
