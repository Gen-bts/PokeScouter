"""ゲームデータローダー: 3層アーキテクチャで base + patch をマージする.

読込フロー:
    data/base/ (PokeAPI) → champions_override/ でディープマージ → seasons/ でフィルタ
"""

from __future__ import annotations

import json
import logging
import re
from copy import deepcopy
from difflib import SequenceMatcher
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
        self._fuzzy_cache: dict[str, list[tuple[str, str, int]]] = {}
        self._exact_cache: dict[str, dict[str, tuple[str, int]]] = {}
        self._mega_stone_map: dict[str, dict[str, Any]] = {}

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

        self._build_mega_stone_map()
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

    # 除外するタイプ（ゲーム内の通常攻撃タイプではない）
    _EXCLUDED_TYPES = frozenset({"stellar"})

    def calc_type_consistency(self, pokemon_ids: list[int]) -> list[dict]:
        """相手チーム全員に等倍以上が取れる攻撃タイプを算出する（タイプ一貫性）.

        Returns:
            各攻撃タイプについて一貫性の判定結果リスト。
        """
        type_registry = self.types.get("types", {})
        atk_types = [
            t for t in type_registry
            if t not in self._EXCLUDED_TYPES
        ]

        # 各ポケモンの防御タイプを事前取得
        team_types: list[tuple[int, list[str]]] = []
        for pid in pokemon_ids:
            pdata = self.get_pokemon_by_id(pid)
            if pdata:
                team_types.append((pid, pdata.get("types", [])))

        results: list[dict] = []
        for atk in atk_types:
            per_pokemon: list[dict] = []
            min_eff = float("inf")
            for pid, def_types in team_types:
                eff = 1.0
                for dt in def_types:
                    eff *= self.get_type_efficacy(atk, dt)
                per_pokemon.append({"pokemon_id": pid, "effectiveness": eff})
                if eff < min_eff:
                    min_eff = eff

            if not team_types:
                min_eff = 1.0

            results.append({
                "type": atk,
                "name": type_registry[atk].get("name", atk),
                "consistent": min_eff >= 1.0,
                "min_effectiveness": min_eff,
                "per_pokemon": per_pokemon,
            })
        return results

    def get_mega_evolution(self, name: str) -> dict | None:
        """チャンピオンズの新メガシンカデータを取得する。"""
        return self.champions_new.get("mega_evolutions", {}).get(name)

    # --- メガストーン → メガフォーム マッピング ---

    _MEGA_EFFECT_RE = re.compile(
        r"Allows (.+?) to Mega Evolve into (Mega .+?)\.",
    )

    def _build_mega_stone_map(self) -> None:
        """メガストーンの item_id → メガフォームデータのマップを構築する。"""
        # English name → (species_id, pokemon_id) for default forms
        name_to_default: dict[str, tuple[int, str]] = {}
        for pid, pdata in self.pokemon.items():
            if pid == "_meta" or not pdata.get("is_default"):
                continue
            name_to_default[pdata.get("name", "")] = (
                pdata.get("species_id", 0),
                pid,
            )

        # (species_id, suffix) → mega form data in pokemon.json
        mega_forms: dict[tuple[int, str], dict[str, Any]] = {}
        for pid, pdata in self.pokemon.items():
            if pid == "_meta":
                continue
            ident: str = pdata.get("identifier", "")
            if "-mega" not in ident:
                continue
            sid = pdata.get("species_id", 0)
            if ident.endswith("-mega-x"):
                suffix = "X"
            elif ident.endswith("-mega-y"):
                suffix = "Y"
            else:
                suffix = ""
            mega_forms[(sid, suffix)] = {
                "mega_pokemon_id": int(pid),
                "source": "base",
                "types": pdata.get("types", []),
                "base_stats": pdata.get("base_stats", {}),
                "abilities": pdata.get("abilities", {}),
            }

        champions_megas = self.champions_new.get("mega_evolutions", {})

        for item_id, item_data in self.items.items():
            if item_id == "_meta" or item_data.get("category_id") != 44:
                continue
            m = self._MEGA_EFFECT_RE.search(item_data.get("effect", ""))
            if not m:
                continue
            base_name = m.group(1)         # e.g. "Charizard"
            mega_form_name = m.group(2)    # e.g. "Mega Charizard X"

            # Determine suffix from mega form name
            suffix = ""
            if mega_form_name.endswith(" X"):
                suffix = "X"
            elif mega_form_name.endswith(" Y"):
                suffix = "Y"
            elif mega_form_name.endswith(" Z"):
                suffix = "Z"

            # Try base pokemon.json lookup
            default_info = name_to_default.get(base_name)
            if default_info:
                species_id, default_pid = default_info
                key = (species_id, suffix)
                if key in mega_forms:
                    entry = {
                        **mega_forms[key],
                        "mega_form_name": mega_form_name,
                        "base_pokemon_id": int(default_pid),
                    }
                    self._mega_stone_map[item_id] = entry
                    continue

            # Try champions_new mega_evolutions
            if mega_form_name in champions_megas:
                cdata = champions_megas[mega_form_name]
                entry = {
                    "mega_pokemon_id": None,
                    "source": "champions",
                    "types": cdata.get("types", []),
                    "base_stats": cdata.get("base_stats", {}),
                    "abilities": {
                        "normal": [cdata["ability"]] if cdata.get("ability") else [],
                        "hidden": None,
                    },
                    "mega_form_name": mega_form_name,
                    "base_pokemon_id": int(default_info[1]) if default_info else None,
                }
                self._mega_stone_map[item_id] = entry
                continue

            logger.debug(
                "メガストーン '%s' に対応するメガフォームが見つかりません: %s",
                item_data.get("identifier"), mega_form_name,
            )

        logger.info(
            "メガストーンマップ構築完了: %d 件", len(self._mega_stone_map),
        )

    def get_mega_form_for_item(self, item_id: int) -> dict[str, Any] | None:
        """メガストーンの item_id からメガフォームデータを取得する。"""
        return self._mega_stone_map.get(str(item_id))

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

    # --- あいまい検索 ---

    # OCR 誤認識の正規化テーブル: 視覚的に類似する文字の統一
    # ゲーム内で捨て仮名（小文字）が大きく表示されるため、大小を同一視する
    _OCR_NORMALIZE_TABLE = str.maketrans({
        # 漢字 → カタカナ (形状が酷似)
        "三": "ミ",
        "二": "ニ",
        "一": "ー",
        "口": "ロ",
        "力": "カ",
        "夕": "タ",
        "工": "エ",
        "卜": "ト",
        # 捨て仮名 → 通常仮名 (ゲームでは大きく表示されるため OCR が区別できない)
        "ァ": "ア", "ィ": "イ", "ゥ": "ウ", "ェ": "エ", "ォ": "オ",
        "ッ": "ツ",
        "ャ": "ヤ", "ュ": "ユ", "ョ": "ヨ",
        "ぁ": "あ", "ぃ": "い", "ぅ": "う", "ぇ": "え", "ぉ": "お",
        "っ": "つ",
        "ゃ": "や", "ゅ": "ゆ", "ょ": "よ",
    })

    @staticmethod
    def _ocr_normalize(text: str) -> str:
        """OCR 比較用に文字列を正規化する。"""
        return text.translate(GameData._OCR_NORMALIZE_TABLE)

    def _get_fuzzy_list(
        self, category: str, lang: str,
    ) -> list[tuple[str, str, int]]:
        """辞書のキーリストをキャッシュ付きで取得する。

        Returns:
            [(original_name, normalized_name, id), ...]
        """
        cache_key = f"{lang}:{category}"
        if cache_key not in self._fuzzy_cache:
            lang_data = self.names.get(lang, {})
            entries = lang_data.get(category, {})
            fuzzy_list: list[tuple[str, str, int]] = []
            exact_map: dict[str, tuple[str, int]] = {}
            for name, id_ in entries.items():
                norm = self._ocr_normalize(name)
                fuzzy_list.append((name, norm, id_))
                exact_map[norm] = (name, id_)
            self._fuzzy_cache[cache_key] = fuzzy_list
            self._exact_cache[cache_key] = exact_map
        return self._fuzzy_cache[cache_key]

    def _fuzzy_match(
        self,
        category: str,
        id_key: str,
        ocr_text: str,
        lang: str = "ja",
        threshold: float = 0.6,
    ) -> dict[str, Any] | None:
        """OCR テキストを辞書照合する共通ロジック.

        正規化テーブルで OCR 誤認識（三→ミ、捨て仮名の大小）を吸収してから
        SequenceMatcher で類似度を計算する。
        """
        text = ocr_text.strip()
        if not text:
            return None

        candidates = self._get_fuzzy_list(category, lang)
        if not candidates:
            return None

        norm_text = self._ocr_normalize(text)

        # 高速パス: 正規化済み exact match でO(1)辞書引き
        cache_key = f"{lang}:{category}"
        exact = self._exact_cache.get(cache_key, {}).get(norm_text)
        if exact is not None:
            return {
                "matched_name": exact[0],
                id_key: exact[1],
                "confidence": 1.0,
            }

        best_name: str = ""
        best_id: int = 0
        best_ratio: float = 0.0

        for orig_name, norm_name, entry_id in candidates:
            ratio = SequenceMatcher(None, norm_text, norm_name).ratio()
            if ratio > best_ratio:
                best_ratio = ratio
                best_name = orig_name
                best_id = entry_id

        if best_ratio < threshold:
            return None

        return {
            "matched_name": best_name,
            id_key: best_id,
            "confidence": round(best_ratio, 4),
        }

    def fuzzy_match_pokemon_name(
        self,
        ocr_text: str,
        lang: str = "ja",
        threshold: float = 0.6,
    ) -> dict[str, Any] | None:
        """OCR テキストからポケモン名を辞書照合する（あいまい検索）.

        Returns:
            {"matched_name": str, "species_id": int, "confidence": float}
            マッチなしなら None。
        """
        return self._fuzzy_match("pokemon", "species_id", ocr_text, lang, threshold)

    def fuzzy_match_move_name(
        self,
        ocr_text: str,
        lang: str = "ja",
        threshold: float = 0.6,
    ) -> dict[str, Any] | None:
        """OCR テキストからわざ名を辞書照合する（あいまい検索）.

        Returns:
            {"matched_name": str, "move_id": int, "confidence": float}
            マッチなしなら None。
        """
        return self._fuzzy_match("moves", "move_id", ocr_text, lang, threshold)

    def fuzzy_match_ability_name(
        self,
        ocr_text: str,
        lang: str = "ja",
        threshold: float = 0.6,
    ) -> dict[str, Any] | None:
        """OCR テキストからとくせい名を辞書照合する（あいまい検索）.

        Returns:
            {"matched_name": str, "ability_id": int, "confidence": float}
            マッチなしなら None。
        """
        return self._fuzzy_match("abilities", "ability_id", ocr_text, lang, threshold)

    def fuzzy_match_item_name(
        self,
        ocr_text: str,
        lang: str = "ja",
        threshold: float = 0.6,
    ) -> dict[str, Any] | None:
        """OCR テキストからアイテム名を辞書照合する（あいまい検索）.

        Returns:
            {"matched_name": str, "item_id": int, "confidence": float}
            マッチなしなら None。
        """
        return self._fuzzy_match("items", "item_id", ocr_text, lang, threshold)
