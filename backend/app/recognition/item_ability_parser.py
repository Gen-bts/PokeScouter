"""Parse opponent item/ability text from battle OCR lines."""

from __future__ import annotations

import logging
import time
from collections import OrderedDict
from typing import Any

from app.data.game_data import GameData
from app.recognition.battle_log_parser import match_against_party

logger = logging.getLogger(__name__)


class ItemAbilityParser:
    """Parse a single opponent item/ability detection from OCR text."""

    def __init__(
        self,
        game_data: GameData,
        *,
        dedup_ttl_s: float = 10.0,
        max_dedup_entries: int = 30,
    ) -> None:
        self._game_data = game_data
        self._dedup_ttl_s = dedup_ttl_s
        self._max_dedup_entries = max_dedup_entries
        self._recent: OrderedDict[str, float] = OrderedDict()
        self._last_raw: str = ""

    def parse(
        self,
        text1: str,
        text2: str,
        opponent_party: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        t1 = text1.strip()
        t2 = text2.strip()
        if not t1 and not t2:
            return []

        combined = f"{t1}{t2}"
        if combined == self._last_raw:
            return []
        self._last_raw = combined

        split = self._split_pokemon_and_trait(combined, opponent_party)
        if split is None:
            return []

        pokemon_name, pokemon_key, trait_text = split
        detection = self._match_trait(trait_text, pokemon_name, pokemon_key)
        if detection is None:
            return []

        now = time.monotonic()
        fp = f"{pokemon_key}:{detection['detection_type']}:{detection['trait_key']}"
        if fp in self._recent and now - self._recent[fp] < self._dedup_ttl_s:
            return []
        self._recent[fp] = now
        self._recent.move_to_end(fp)
        while len(self._recent) > self._max_dedup_entries:
            self._recent.popitem(last=False)

        detection["raw_text"] = combined
        logger.info(
            "opponent_%s: %s trait=%s (id=%s, conf=%.3f)",
            detection["detection_type"],
            pokemon_name,
            detection["trait_name"],
            detection["trait_key"],
            detection["confidence"],
        )
        return [detection]

    def _split_pokemon_and_trait(
        self,
        combined: str,
        opponent_party: list[dict[str, Any]],
    ) -> tuple[str, str | None, str] | None:
        positions: list[int] = []
        start = 0
        while True:
            idx = combined.find("の", start)
            if idx == -1:
                break
            positions.append(idx)
            start = idx + 1

        if not positions:
            return None

        best_result: tuple[str, str | None, str, float] | None = None
        for pos in positions:
            pokemon_part = combined[:pos]
            trait_part = combined[pos + 1 :]
            if len(pokemon_part) < 2 or len(trait_part) < 2:
                continue

            if opponent_party:
                match = match_against_party(pokemon_part, opponent_party)
                if match is not None:
                    conf = match["confidence"]
                    if best_result is None or conf > best_result[3]:
                        best_result = (
                            match["matched_name"],
                            match["pokemon_key"],
                            trait_part,
                            conf,
                        )

        if best_result is None:
            return None
        return best_result[0], best_result[1], best_result[2]

    def _match_trait(
        self,
        trait_text: str,
        pokemon_name: str,
        pokemon_key: str | None,
    ) -> dict[str, Any] | None:
        ability_result = self._game_data.fuzzy_match_ability_name(trait_text)
        item_result = self._game_data.fuzzy_match_item_name(trait_text)

        ability_conf = ability_result["confidence"] if ability_result else 0.0
        item_conf = item_result["confidence"] if item_result else 0.0

        if ability_conf == 0.0 and item_conf == 0.0:
            return None

        if ability_conf >= item_conf and ability_result:
            ability_key = ability_result["ability_key"]
            return {
                "type": "opponent_item_ability",
                "detection_type": "ability",
                "pokemon_name": pokemon_name,
                "pokemon_key": pokemon_key,
                "species_id": pokemon_key,
                "trait_name": ability_result["matched_name"],
                "trait_key": ability_key,
                "trait_id": ability_key,
                "confidence": ability_conf,
                "item_identifier": None,
            }

        if item_result:
            item_key = item_result["item_key"]
            item_data = self._game_data.items.get(str(item_key), {})
            return {
                "type": "opponent_item_ability",
                "detection_type": "item",
                "pokemon_name": pokemon_name,
                "pokemon_key": pokemon_key,
                "species_id": pokemon_key,
                "trait_name": item_result["matched_name"],
                "trait_key": item_key,
                "trait_id": item_key,
                "confidence": item_conf,
                "item_identifier": item_data.get("identifier") or item_key,
            }

        return None

    def reset(self) -> None:
        self._recent.clear()
        self._last_raw = ""
