"""ゲームデータローダー: 3層アーキテクチャで base + patch をマージする.

読込フロー:
    data/base/ (PokeAPI) → champions_override/ でディープマージ → seasons/ でフィルタ
"""

from __future__ import annotations

import json
import logging
from copy import deepcopy
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# プロジェクトルートからの相対パス
DATA_DIR = Path(__file__).resolve().parent.parent.parent.parent / "data"


def _load_json(path: Path) -> dict:
    """JSON ファイルを読み込む。存在しない場合は空辞書を返す。"""
    if not path.exists():
        logger.warning("ファイルが見つかりません: %s", path)
        return {}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _deep_merge(base: dict, patch: dict) -> dict:
    """patch の値で base をディープマージする。_meta キーはスキップ。"""
    result = deepcopy(base)
    for key, value in patch.items():
        if key == "_meta":
            continue
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = deepcopy(value)
    return result


class GameData:
    """ポケモンのゲームデータを3層アーキテクチャで管理するクラス.

    Attributes:
        pokemon: ポケモンデータ (pokemon_id -> data)
        moves: 技データ (move_id -> data)
        abilities: とくせいデータ (ability_id -> data)
        types: タイプデータ (タイプ一覧 + 相性表)
        items: アイテムデータ (item_id -> data)
        natures: 性格データ (nature_id -> data)
        names: 多言語名辞書 (lang -> {pokemon: {name->id}, moves: {name->id}})
        season: 現在のシーズン設定
        champions_new: チャンピオンズ新規エントリ（メガシンカ/技/とくせい）
    """

    def __init__(self, data_dir: Path | None = None) -> None:
        self._data_dir = data_dir or DATA_DIR
        self.pokemon: dict[str, Any] = {}
        self.moves: dict[str, Any] = {}
        self.abilities: dict[str, Any] = {}
        self.types: dict[str, Any] = {}
        self.items: dict[str, Any] = {}
        self.natures: dict[str, Any] = {}
        self.names: dict[str, dict] = {}
        self.season: dict[str, Any] = {}
        self.champions_new: dict[str, Any] = {}
        self.learnsets: dict[str, Any] = {}

    def load(self) -> None:
        """全データを読み込み・マージする。"""
        base = self._data_dir / "base"
        override = self._data_dir / "champions_override"
        seasons = self._data_dir / "seasons"
        names_dir = self._data_dir / "names"

        # --- Layer 1: Base ---
        logger.info("Layer 1: base データ読み込み...")
        self.pokemon = _load_json(base / "pokemon.json")
        self.moves = _load_json(base / "moves.json")
        self.abilities = _load_json(base / "abilities.json")
        self.types = _load_json(base / "types.json")
        self.items = _load_json(base / "items.json")
        self.natures = _load_json(base / "natures.json")

        # --- Layer 2: Champions Override ---
        logger.info("Layer 2: champions_override パッチ適用...")
        pokemon_patch = _load_json(override / "pokemon_patch.json")
        moves_patch = _load_json(override / "moves_patch.json")
        new_entries = _load_json(override / "new_entries.json")

        # pokemon_patch: 名前ベースのパッチを pokemon_id ベースに変換して適用
        self._apply_pokemon_patch(pokemon_patch)

        # moves_patch: 名前ベースのパッチを move_id ベースに変換して適用
        self._apply_moves_patch(moves_patch)

        # new_entries: 新メガシンカ・新技・新とくせいを保持
        self.champions_new = new_entries

        # learnsets: ポケモン毎の覚える技リスト
        self.learnsets = _load_json(override / "learnsets.json")

        # 新とくせいを abilities に追加
        for aid, adata in new_entries.get("new_abilities", {}).items():
            self.abilities[aid] = {
                "identifier": aid,
                "name": adata.get("name", aid),
                "effect": adata.get("effect", ""),
                "generation": 0,  # Champions 固有
            }

        # --- Layer 3: Season ---
        logger.info("Layer 3: シーズン設定読み込み...")
        current = _load_json(seasons / "current.json")
        season_id = current.get("current_season", "")
        if season_id:
            self.season = _load_json(seasons / f"{season_id}.json")

        # --- 名前辞書 ---
        logger.info("名前辞書読み込み...")
        for lang_file in names_dir.glob("*.json"):
            lang = lang_file.stem
            self.names[lang] = _load_json(lang_file)

        self._log_stats()

    def _apply_pokemon_patch(self, patch: dict) -> None:
        """名前ベースの pokemon_patch を pokemon データに適用する。"""
        # 名前 → pokemon_id マッピングを構築
        name_to_id: dict[str, str] = {}
        for pid, pdata in self.pokemon.items():
            if pid == "_meta":
                continue
            # identifier (e.g. "meditite") と name (e.g. "Meditite") の両方でマッチ
            name_to_id[pdata.get("name", "")] = pid
            name_to_id[pdata.get("identifier", "")] = pid

        applied = 0
        for name, changes in patch.items():
            if name == "_meta":
                continue
            pid = name_to_id.get(name)
            if pid is None:
                # identifier 形式でも試す
                pid = name_to_id.get(name.lower().replace(" ", "-"))
            if pid and pid in self.pokemon:
                self.pokemon[pid] = _deep_merge(self.pokemon[pid], changes)
                applied += 1
            else:
                logger.debug("pokemon_patch: '%s' が base に見つかりません", name)

        logger.info("pokemon_patch: %d 件適用", applied)

    def _apply_moves_patch(self, patch: dict) -> None:
        """名前ベースの moves_patch を moves データに適用する。"""
        name_to_id: dict[str, str] = {}
        for mid, mdata in self.moves.items():
            if mid == "_meta":
                continue
            name_to_id[mdata.get("name", "")] = mid
            name_to_id[mdata.get("identifier", "")] = mid

        applied = 0
        for name, changes in patch.items():
            if name == "_meta":
                continue
            mid = name_to_id.get(name)
            if mid is None:
                mid = name_to_id.get(name.lower().replace(" ", "-").replace("'", ""))
            if mid and mid in self.moves:
                self.moves[mid] = _deep_merge(self.moves[mid], changes)
                applied += 1

        logger.info("moves_patch: %d 件適用", applied)

    def _log_stats(self) -> None:
        """読み込み結果のサマリーをログに出力する。"""
        pokemon_count = sum(1 for k in self.pokemon if k != "_meta")
        moves_count = sum(1 for k in self.moves if k != "_meta")
        abilities_count = sum(1 for k in self.abilities if k != "_meta")
        mega_count = len(self.champions_new.get("mega_evolutions", {}))
        lang_count = len(self.names)
        season_name = self.season.get("_meta", {}).get("name", "なし")
        legal_count = len(self.season.get("legal_pokemon", []))

        logger.info(
            "GameData 読み込み完了: %d pokemon, %d moves, %d abilities, "
            "%d 新メガシンカ, %d 言語, シーズン=%s (%d species)",
            pokemon_count, moves_count, abilities_count,
            mega_count, lang_count, season_name, legal_count,
        )

    # --- 検索ヘルパー ---

    def get_pokemon_by_id(self, pokemon_id: int) -> dict | None:
        """pokemon_id でポケモンデータを取得する。"""
        return self.pokemon.get(str(pokemon_id))

    def get_pokemon_by_name(self, name: str, lang: str = "ja") -> dict | None:
        """名前からポケモンデータを取得する。OCR 照合用。"""
        lang_data = self.names.get(lang, {})
        pokemon_names = lang_data.get("pokemon", {})
        species_id = pokemon_names.get(name)
        if species_id is None:
            return None
        # species_id → pokemon_id（デフォルトフォーム）を検索
        for pid, pdata in self.pokemon.items():
            if pid == "_meta":
                continue
            if pdata.get("species_id") == species_id and pdata.get("is_default"):
                return pdata
        return None

    def get_move_by_id(self, move_id: int) -> dict | None:
        """move_id で技データを取得する。"""
        return self.moves.get(str(move_id))

    def get_move_by_name(self, name: str, lang: str = "ja") -> dict | None:
        """名前から技データを取得する。OCR 照合用。"""
        lang_data = self.names.get(lang, {})
        move_names = lang_data.get("moves", {})
        move_id = move_names.get(name)
        if move_id is None:
            return None
        return self.moves.get(str(move_id))

    def get_type_efficacy(self, atk_type: str, def_type: str) -> float:
        """攻撃タイプ → 防御タイプの倍率を取得する。"""
        efficacy = self.types.get("efficacy", {})
        return efficacy.get(atk_type, {}).get(def_type, 1.0)

    def get_mega_evolution(self, name: str) -> dict | None:
        """チャンピオンズの新メガシンカデータを取得する。"""
        return self.champions_new.get("mega_evolutions", {}).get(name)

    def get_learnset(self, species_id: int, form: str = "default") -> list[int]:
        """ポケモンが覚える技の move_id リストを取得する。"""
        entry = self.learnsets.get(str(species_id), {})
        if isinstance(entry, dict):
            return entry.get(form, entry.get("default", []))
        return []

    def is_legal(self, species_id: int) -> bool:
        """現在のシーズンでそのポケモンが使用可能かを判定する。"""
        legal = self.season.get("legal_pokemon", [])
        if not legal:
            return True  # リストが空なら全ポケモン使用可
        return species_id in legal
