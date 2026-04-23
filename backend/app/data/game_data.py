"""Showdown snapshot ベースのゲームデータローダー."""

from __future__ import annotations

import json
import logging
from difflib import SequenceMatcher
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from app.config import UsagePriorityConfig

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent.parent.parent / "data"
SNAPSHOT_DIR = DATA_DIR / "showdown" / "champions-bss-reg-ma"

# 使用率データソースのレジストリ: ソース名 → data/ からの相対パス
_USAGE_SOURCES: dict[str, str] = {
    "pokechamdb": "pokechamdb/single.json",
    "pikalytics": "pikalytics/championspreview.json",
    "champions_stats": "champions_stats/single.json",
    "yakkun": "yakkun/single.json",
}

_POKEMON_FORM_NAME_OVERRIDES_JA: dict[str, str] = {
    "rotomheat": "ヒート{base}",
    "rotomwash": "ウォッシュ{base}",
    "rotomfrost": "フロスト{base}",
    "rotomfan": "スピン{base}",
    "rotommow": "カット{base}",
    "palafinhero": "{base}(マイティフォルム)",
}

_POKEMON_FORM_TEMPLATES_JA: dict[str, str] = {
    "Alola": "{base}(アローラのすがた)",
    "Antique": "{base}(しんさく)",
    "Bond": "{base}(きずなへんげ)",
    "Dusk": "{base}(たそがれのすがた)",
    "Eternal": "{base}(えいえんのはな)",
    "F": "{base}♀",
    "Galar": "{base}(ガラルのすがた)",
    "Gmax": "{base}(キョダイマックス)",
    "Hisui": "{base}(ヒスイのすがた)",
    "Large": "{base}(おおきいサイズ)",
    "Masterpiece": "{base}(けっさく)",
    "Mega": "メガ{base}",
    "Mega-X": "メガ{base}X",
    "Mega-Y": "メガ{base}Y",
    "Midnight": "{base}(まよなかのすがた)",
    "Paldea-Aqua": "{base}(パルデアのすがた・アクア)",
    "Paldea-Blaze": "{base}(パルデアのすがた・ブレイズ)",
    "Paldea-Combat": "{base}(パルデアのすがた・コンバット)",
    "Small": "{base}(ちいさいサイズ)",
    "Super": "{base}(とくだいサイズ)",
    "Totem": "{base}(ぬしポケモン)",
}


def _load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        logger.warning("ファイルが見つかりません: %s", path)
        return {}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


class GameData:
    """Showdown snapshot と多言語名辞書を扱う."""

    def __init__(self, data_dir: Path | None = None) -> None:
        self._data_dir = data_dir or DATA_DIR
        self._snapshot_dir = self._data_dir / "showdown" / "champions-bss-reg-ma"
        self.pokemon: dict[str, Any] = {}
        self.moves: dict[str, Any] = {}
        self.abilities: dict[str, Any] = {}
        self.items: dict[str, Any] = {}
        self.types: dict[str, Any] = {}
        self.natures: dict[str, Any] = {}
        self.learnsets: dict[str, Any] = {}
        self.format: dict[str, Any] = {}
        self.season: dict[str, Any] = {}
        self.names: dict[str, dict[str, Any]] = {}
        self.usage: dict[str, Any] = {}
        self._fuzzy_cache: dict[str, list[tuple[str, str, str, str]]] = {}
        self._exact_cache: dict[str, dict[str, tuple[str, str]]] = {}
        self._mega_stone_map: dict[str, dict[str, Any]] = {}
        self._pokemon_mega_forms: dict[str, list[dict[str, Any]]] = {}
        self._base_species_to_pokemon_keys: dict[str, list[str]] | None = None
        self._localized_pokemon_name_cache: dict[str, dict[str, str]] = {}
        self._pokemon_key_to_name_cache: dict[tuple[str, bool], dict[str, str]] = {}
        self._pokemon_name_choices_cache: dict[tuple[str, bool], dict[str, str]] = {}
        self._ability_desc_ja: dict[str, str] | None = None
        self._move_desc_ja: dict[str, str] | None = None

    @staticmethod
    def legacy_value(value: str | int | None) -> Any:
        if value is None:
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return value

    def load(self, *, usage_priority: UsagePriorityConfig | None = None) -> None:
        self._load_static_data()
        self.reload_usage(usage_priority)

    def _load_static_data(self) -> None:
        """静的データ（Showdown snapshot・名前辞書・パッチ）を読み込む."""
        names_dir = self._data_dir / "names"

        logger.info("Showdown snapshot 読み込み中...")
        self.pokemon = _load_json(self._snapshot_dir / "pokemon.json")
        self.moves = _load_json(self._snapshot_dir / "moves.json")
        self.abilities = _load_json(self._snapshot_dir / "abilities.json")
        self.items = _load_json(self._snapshot_dir / "items.json")
        self.types = _load_json(self._snapshot_dir / "types.json")
        self.natures = _load_json(self._snapshot_dir / "natures.json")
        self.learnsets = _load_json(self._snapshot_dir / "learnsets.json")
        self.format = _load_json(self._snapshot_dir / "format.json")
        self.season = {
            "legal_pokemon": self.format.get("legal_base_species_keys", []),
        }

        if not self.pokemon:
            self._load_legacy_data()

        logger.info("名前辞書読み込み中...")
        for lang_file in names_dir.glob("*.json"):
            self.names[lang_file.stem] = _load_json(lang_file)

        self._merge_champions_move_names_ja()
        self._merge_champions_ability_names_ja()

        self._build_mega_stone_map()
        self._log_stats()

    def reload_usage(self, priority: UsagePriorityConfig | None = None) -> None:
        """使用率データを（再）読み込みする.

        静的データとは独立して呼び出し可能。
        """
        from app.config import UsagePriorityConfig

        effective = priority or UsagePriorityConfig()
        all_sources = self._load_all_usage_sources()
        self.usage = self._merge_usage_data(all_sources, effective)

    def _load_all_usage_sources(self) -> dict[str, dict[str, Any]]:
        """_USAGE_SOURCES に登録された全ソースを読み込む."""
        all_sources: dict[str, dict[str, Any]] = {}
        for name, rel_path in _USAGE_SOURCES.items():
            raw = _load_json(self._data_dir / rel_path)
            pokemon_data = raw.get("pokemon", {}) if raw else {}
            if pokemon_data:
                all_sources[name] = pokemon_data
                logger.info(
                    "使用率データ読み込み: source=%s, %d 件",
                    name,
                    len(pokemon_data),
                )
        return all_sources

    def _merge_usage_data(
        self,
        all_sources: dict[str, dict[str, Any]],
        priority: UsagePriorityConfig,
    ) -> dict[str, Any]:
        """全ソースからフィールドごとに優先度マージした使用率辞書を構築する."""
        all_keys: set[str] = set()
        for src in all_sources.values():
            all_keys.update(src.keys())

        merged: dict[str, Any] = {}
        list_fields = ("moves", "items", "abilities", "teammates",
                       "natures", "ev_spreads")
        # スカラー/辞書系フィールド: default 優先順で最初に見つかった値を採用する
        scalar_fields = ("usage_percent", "base_stats", "actual_stats",
                         "rank", "dex_no", "types")

        for pokemon_key in all_keys:
            entry: dict[str, Any] = {}

            # スカラー/辞書フィールド: default 優先順に従う
            for field in scalar_fields:
                for source_name in priority.default:
                    val = (
                        all_sources.get(source_name, {})
                        .get(pokemon_key, {})
                        .get(field)
                    )
                    if val is not None:
                        entry[field] = val
                        break

            # リストフィールドはフィールドごとの優先順位
            for field in list_fields:
                for source_name in priority.for_field(field):
                    val = (
                        all_sources.get(source_name, {})
                        .get(pokemon_key, {})
                        .get(field)
                    )
                    if val:  # None や [] はスキップ → 次ソースへフォールバック
                        entry[field] = val
                        break

            if entry:
                merged[pokemon_key] = entry

        logger.info(
            "使用率データマージ完了: %d 件 (sources: %s)",
            len(merged),
            ", ".join(all_sources.keys()),
        )
        return merged

    def get_usage_moves(
        self,
        pokemon_key: str,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        """ポケモンの使用率上位技を返す.

        Args:
            pokemon_key: Showdown key
            limit: 返す技の最大数

        Returns:
            [{"move_key": str, "usage_percent": float}, ...] (使用率降順)
        """
        entry = self.usage.get(pokemon_key)
        # base_species_key でフォールバック
        if entry is None:
            pdata = self.get_pokemon_by_key(pokemon_key)
            if pdata:
                base_key = pdata.get("base_species_key", pokemon_key)
                entry = self.usage.get(base_key)
        if entry is None:
            return []

        moves: list[dict[str, Any]] = []
        for m in entry.get("moves", []):
            move_key = m.get("move_key", "")
            if self.moves.get(move_key):
                moves.append(m)
        return moves[:limit]

    def get_usage_data(self, pokemon_key: str) -> dict[str, Any] | None:
        """ポケモンの使用率データ全体を返す."""
        entry = self.usage.get(pokemon_key)
        if entry is None:
            pdata = self.get_pokemon_by_key(pokemon_key)
            if pdata:
                base_key = pdata.get("base_species_key", pokemon_key)
                entry = self.usage.get(base_key)
        return entry

    def _merge_champions_move_names_ja(self) -> None:
        """PokeAPI CSV 由来の不足分を names/ja.json の moves にマージする.

        learnset 照合では ja 辞書に無い move_key はスキップされ、
        「ハパーポス」→「ハイパーボイス」のようなマッチが成立しない。
        """
        path = self._data_dir / "champions_override" / "move_names_ja.json"
        extra = _load_json(path)
        moves_patch = extra.get("moves")
        if not moves_patch:
            return
        ja = self.names.setdefault("ja", {})
        target = ja.setdefault("moves", {})
        target.update(moves_patch)
        logger.info(
            "champions_override/move_names_ja.json から moves を %d 件マージしました",
            len(moves_patch),
        )
        self._fuzzy_cache.clear()
        self._exact_cache.clear()

    def _merge_champions_ability_names_ja(self) -> None:
        """PokeAPI CSV 由来の不足分を names/ja.json の abilities にマージする."""
        path = self._data_dir / "champions_override" / "ability_names_ja.json"
        extra = _load_json(path)
        abilities_patch = extra.get("abilities")
        if not abilities_patch:
            return
        ja = self.names.setdefault("ja", {})
        target = ja.setdefault("abilities", {})
        target.update(abilities_patch)
        logger.info(
            "champions_override/ability_names_ja.json から abilities を %d 件マージしました",
            len(abilities_patch),
        )
        self._fuzzy_cache.clear()
        self._exact_cache.clear()

    def _build_ability_desc_ja(self) -> dict[str, str]:
        """showdown_key -> 日本語特性説明文の辞書を構築する."""
        result: dict[str, str] = {}

        # Layer 1: base/abilities.json の flavor_text_ja
        base_abilities = _load_json(self._data_dir / "base" / "abilities.json")
        for aid, adata in base_abilities.items():
            if not isinstance(adata, dict) or "identifier" not in adata:
                continue
            flavor = adata.get("flavor_text_ja", "")
            if flavor:
                showdown_key = adata["identifier"].replace("-", "")
                result[showdown_key] = flavor

        # Layer 2: champions_override/ability_descs_ja.json（Layer 1 を上書き）
        override = _load_json(
            self._data_dir / "champions_override" / "ability_descs_ja.json",
        )
        result.update(override.get("ability_descs", {}))

        return result

    def get_ability_desc_ja(self, ability_key: str) -> str:
        """指定された ability_key の日本語説明文を返す。無ければ空文字列。"""
        if self._ability_desc_ja is None:
            self._ability_desc_ja = self._build_ability_desc_ja()
        return self._ability_desc_ja.get(ability_key, "")

    def _build_move_desc_ja(self) -> dict[str, str]:
        """showdown_key -> 日本語技説明文の辞書を構築する."""
        result: dict[str, str] = {}

        # Layer 1: base/moves.json の flavor_text_ja（存在する場合）
        base_moves = _load_json(self._data_dir / "base" / "moves.json")
        for mid, mdata in base_moves.items():
            if not isinstance(mdata, dict) or "identifier" not in mdata:
                continue
            flavor = mdata.get("flavor_text_ja", "")
            if flavor:
                showdown_key = mdata["identifier"].replace("-", "")
                result[showdown_key] = flavor

        # Layer 2: champions_override/move_descs_ja.json（Layer 1 を上書き）
        override = _load_json(
            self._data_dir / "champions_override" / "move_descs_ja.json",
        )
        result.update(override.get("move_descs", {}))

        return result

    def get_move_desc_ja(self, move_key: str) -> str:
        """指定された move_key の日本語説明文を返す。無ければ空文字列。"""
        if self._move_desc_ja is None:
            self._move_desc_ja = self._build_move_desc_ja()
        return self._move_desc_ja.get(move_key, "")

    def _load_legacy_data(self) -> None:
        base_dir = self._data_dir / "base"
        override_dir = self._data_dir / "champions_override"
        if not (base_dir / "pokemon.json").exists():
            return

        logger.info("Showdown snapshot が無いため legacy data layout を読み込みます")
        self.pokemon = _load_json(base_dir / "pokemon.json")
        self.moves = _load_json(base_dir / "moves.json")
        self.abilities = _load_json(base_dir / "abilities.json")
        self.items = _load_json(base_dir / "items.json")
        self.types = _load_json(base_dir / "types.json")
        self.natures = _load_json(base_dir / "natures.json")

        legacy_learnsets = _load_json(override_dir / "learnsets.json")
        if legacy_learnsets:
            self.learnsets = legacy_learnsets

    def _log_stats(self) -> None:
        pokemon_count = sum(1 for key in self.pokemon if not key.startswith("_"))
        moves_count = sum(1 for key in self.moves if not key.startswith("_"))
        item_count = sum(1 for key in self.items if not key.startswith("_"))
        ability_count = sum(1 for key in self.abilities if not key.startswith("_"))
        legal_count = len(self.format.get("legal_base_species_keys", []))
        logger.info(
            "GameData 読み込み完了: %d pokemon, %d moves, %d items, %d abilities, legal=%d",
            pokemon_count,
            moves_count,
            item_count,
            ability_count,
            legal_count,
        )

    def get_pokemon_by_key(self, pokemon_key: str) -> dict[str, Any] | None:
        return self.pokemon.get(pokemon_key)

    def get_pokemon_by_id(self, pokemon_id: int | str) -> dict[str, Any] | None:
        pokemon_id_str = str(pokemon_id)
        direct = self.pokemon.get(pokemon_id_str)
        if direct is not None:
            return direct
        try:
            numeric_id = int(pokemon_id_str)
        except ValueError:
            return None
        for pdata in self.pokemon.values():
            if isinstance(pdata, dict) and pdata.get("num") == numeric_id:
                return pdata
        return None

    def get_move_by_key(self, move_key: str) -> dict[str, Any] | None:
        return self.moves.get(move_key)

    def get_item_by_key(self, item_key: str) -> dict[str, Any] | None:
        return self.items.get(item_key)

    def get_ability_by_key(self, ability_key: str) -> dict[str, Any] | None:
        return self.abilities.get(ability_key)

    def get_type_efficacy(self, atk_type: str, def_type: str) -> float:
        efficacy = self.types.get("efficacy", {})
        return efficacy.get(atk_type, {}).get(def_type, 1.0)

    _EXCLUDED_TYPES = frozenset({"stellar"})

    def calc_type_consistency(self, pokemon_keys: list[str | int]) -> list[dict[str, Any]]:
        type_registry = self.types.get("types", {})
        atk_types = [t for t in type_registry if t not in self._EXCLUDED_TYPES]

        team_types: list[tuple[str, list[str]]] = []
        for pokemon_key in pokemon_keys:
            lookup_key = str(pokemon_key)
            pdata = self.get_pokemon_by_key(lookup_key)
            if pdata is None:
                pdata = self.get_pokemon_by_id(lookup_key)
            if pdata:
                team_types.append((lookup_key, pdata.get("types", [])))

        results: list[dict[str, Any]] = []
        for atk in atk_types:
            per_pokemon: list[dict[str, Any]] = []
            min_eff = float("inf")
            for pokemon_key, def_types in team_types:
                eff = 1.0
                for def_type in def_types:
                    eff *= self.get_type_efficacy(atk, def_type)
                per_pokemon.append({
                    "pokemon_key": pokemon_key,
                    "pokemon_id": self.legacy_value(pokemon_key),
                    "effectiveness": eff,
                })
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

    def _build_mega_stone_map(self) -> None:
        self._mega_stone_map.clear()
        self._pokemon_mega_forms.clear()

        # Step 1: required_item → mega pokemon key の逆引きマップ構築
        # is_mega フィルタで Silvally/Genesect/ゲンシカイキ等を除外
        item_to_mega: dict[str, str] = {}
        for pokemon_key, pdata in self.pokemon.items():
            if pokemon_key.startswith("_"):
                continue
            if pdata.get("is_mega") and pdata.get("required_item"):
                item_to_mega.setdefault(pdata["required_item"], pokemon_key)

        # Step 2: メガストーンアイテムから逆引きでマップ構築
        for item_key, item_data in self.items.items():
            if item_key.startswith("_"):
                continue
            if item_data.get("mega_stone") is None:
                continue
            mega_key = item_to_mega.get(item_key)
            if mega_key is None:
                continue
            mega_pokemon = self.pokemon.get(mega_key)
            if mega_pokemon is None:
                continue
            base_species_key = mega_pokemon.get("base_species_key")
            entry = {
                "item_key": item_key,
                "mega_pokemon_key": mega_key,
                "mega_form_name": mega_pokemon.get("name", mega_key),
                "base_species_key": base_species_key,
                "types": mega_pokemon.get("types", []),
                "base_stats": mega_pokemon.get("base_stats", {}),
                "abilities": mega_pokemon.get("abilities", {}),
            }
            self._mega_stone_map[item_key] = entry
            if base_species_key:
                self._pokemon_mega_forms.setdefault(base_species_key, []).append(entry)

        for forms in self._pokemon_mega_forms.values():
            forms.sort(key=lambda entry: entry.get("mega_form_name", ""))

    def get_mega_form_for_item(self, item_key: str) -> dict[str, Any] | None:
        return self._mega_stone_map.get(item_key)

    def get_mega_forms_for_pokemon(self, pokemon_key: str) -> list[dict[str, Any]]:
        pdata = self.get_pokemon_by_key(pokemon_key)
        if pdata is None:
            return []
        base_species_key = pdata.get("base_species_key", pokemon_key)
        return self._pokemon_mega_forms.get(base_species_key, [])

    def resolve_mega_pokemon_key(
        self, base_pokemon_key: str, mega_name_ja: str,
    ) -> str | None:
        """ベースポケモンキーと日本語メガ名からメガフォームの pokemon_key を解決する."""
        forms = self.get_mega_forms_for_pokemon(base_pokemon_key)
        if not forms:
            return None
        if len(forms) == 1:
            return forms[0]["mega_pokemon_key"]
        # 複数フォーム（X/Y）: 日本語名で照合
        for form in forms:
            localized = self.localize_pokemon_name(form["mega_pokemon_key"], "ja")
            if localized == mega_name_ja:
                return form["mega_pokemon_key"]
        # fallback: 先頭を返す
        return forms[0]["mega_pokemon_key"]

    def _build_base_species_to_pokemon_keys(self) -> dict[str, list[str]]:
        mapping: dict[str, list[str]] = {}
        for pokemon_key, pdata in self.pokemon.items():
            if pokemon_key.startswith("_"):
                continue
            base_species_key = str(
                pdata.get("base_species_key", pdata.get("species_id", pokemon_key)),
            )
            mapping.setdefault(base_species_key, []).append(pokemon_key)
        for keys in mapping.values():
            keys.sort()
        return mapping

    def expand_base_species_to_pokemon_keys(self, base_species_keys: list[str]) -> list[str]:
        if self._base_species_to_pokemon_keys is None:
            self._base_species_to_pokemon_keys = self._build_base_species_to_pokemon_keys()

        result: list[str] = []
        for base_species_key in base_species_keys:
            pokemon_keys = self._base_species_to_pokemon_keys.get(base_species_key)
            if pokemon_keys:
                result.extend([
                    pokemon_key for pokemon_key in pokemon_keys
                    if self.pokemon.get(pokemon_key, {}).get("is_preview_form", False)
                ])
            else:
                result.append(base_species_key)
        return result

    def expand_species_to_pokemon_ids(self, species_ids: list[int | str]) -> list[Any]:
        if self._base_species_to_pokemon_keys is None:
            self._base_species_to_pokemon_keys = self._build_base_species_to_pokemon_keys()

        base_species_keys: list[str] = []
        for species_id in species_ids:
            pokemon = self.get_pokemon_by_id(species_id)
            if pokemon is None:
                base_species_keys.append(str(species_id))
                continue
            base_species_keys.append(str(pokemon.get("base_species_key", species_id)))

        result: list[Any] = []
        for base_species_key in base_species_keys:
            pokemon_keys = self._base_species_to_pokemon_keys.get(base_species_key)
            if pokemon_keys:
                result.extend(self.legacy_value(pokemon_key) for pokemon_key in pokemon_keys)
            else:
                result.append(self.legacy_value(base_species_key))
        return result

    def get_learnset(self, pokemon_key: str) -> list[str]:
        if pokemon_key in self.learnsets:
            return self.learnsets[pokemon_key]
        pdata = self.get_pokemon_by_key(pokemon_key)
        if pdata is None:
            return []
        base_species_key = pdata.get("base_species_key", pokemon_key)
        return self.learnsets.get(base_species_key, [])

    def is_legal(self, pokemon_key: str) -> bool:
        pdata = self.get_pokemon_by_key(pokemon_key)
        if pdata is None:
            return False
        base_species_key = pdata.get("base_species_key", pokemon_key)
        legal = set(self.format.get("legal_base_species_keys", []))
        return not legal or base_species_key in legal

    _OCR_NORMALIZE_TABLE = str.maketrans({
        "三": "ミ",
        "二": "ニ",
        "一": "ー",
        "口": "ロ",
        "力": "カ",
        "夕": "タ",
        "工": "エ",
        "卜": "ト",
        "ァ": "ア", "ィ": "イ", "ゥ": "ウ", "ェ": "エ", "ォ": "オ",
        "ッ": "ツ",
        "ャ": "ヤ", "ュ": "ユ", "ョ": "ヨ",
        "ぁ": "あ", "ぃ": "い", "ぅ": "う", "ぇ": "え", "ぉ": "お",
        "っ": "つ",
        "ゃ": "や", "ゅ": "ゆ", "ょ": "よ",
    })

    _DAKUTEN_TABLE = str.maketrans({
        # カタカナ濁音
        "ガ": "カ", "ギ": "キ", "グ": "ク", "ゲ": "ケ", "ゴ": "コ",
        "ザ": "サ", "ジ": "シ", "ズ": "ス", "ゼ": "セ", "ゾ": "ソ",
        "ダ": "タ", "ヂ": "チ", "ヅ": "ツ", "デ": "テ", "ド": "ト",
        "バ": "ハ", "ビ": "ヒ", "ブ": "フ", "ベ": "ヘ", "ボ": "ホ",
        "ヴ": "ウ",
        # カタカナ半濁音
        "パ": "ハ", "ピ": "ヒ", "プ": "フ", "ペ": "ヘ", "ポ": "ホ",
        # ひらがな濁音
        "が": "か", "ぎ": "き", "ぐ": "く", "げ": "け", "ご": "こ",
        "ざ": "さ", "じ": "し", "ず": "す", "ぜ": "せ", "ぞ": "そ",
        "だ": "た", "ぢ": "ち", "づ": "つ", "で": "て", "ど": "と",
        "ば": "は", "び": "ひ", "ぶ": "ふ", "べ": "へ", "ぼ": "ほ",
        # ひらがな半濁音
        "ぱ": "は", "ぴ": "ひ", "ぷ": "ふ", "ぺ": "へ", "ぽ": "ほ",
    })

    _DAKUTEN_TIEBREAK_MARGIN = 0.05

    @staticmethod
    def _ocr_normalize(text: str) -> str:
        return text.translate(GameData._OCR_NORMALIZE_TABLE)

    @staticmethod
    def _strip_dakuten(text: str) -> str:
        return text.translate(GameData._DAKUTEN_TABLE)

    def _get_fuzzy_list(
        self, category: str, lang: str,
    ) -> list[tuple[str, str, str, str]]:
        cache_key = f"{lang}:{category}"
        if cache_key not in self._fuzzy_cache:
            lang_data = self.names.get(lang, {})
            entries = lang_data.get(category, {})
            fuzzy_list: list[tuple[str, str, str, str]] = []
            exact_map: dict[str, tuple[str, str]] = {}
            for name, entry_key in entries.items():
                key_str = str(entry_key)
                norm = self._ocr_normalize(name)
                dak_norm = self._strip_dakuten(norm)
                fuzzy_list.append((name, norm, dak_norm, key_str))
                exact_map[norm] = (name, key_str)
            self._fuzzy_cache[cache_key] = fuzzy_list
            self._exact_cache[cache_key] = exact_map
        return self._fuzzy_cache[cache_key]

    def _fuzzy_match(
        self,
        category: str,
        key_name: str,
        ocr_text: str,
        lang: str = "ja",
        threshold: float = 0.6,
    ) -> dict[str, Any] | None:
        text = ocr_text.strip()
        if not text:
            return None

        candidates = self._get_fuzzy_list(category, lang)
        if not candidates:
            return None

        norm_text = self._ocr_normalize(text)
        cache_key = f"{lang}:{category}"
        legacy_key_map = {
            "pokemon_key": "species_id",
            "move_key": "move_id",
            "ability_key": "ability_id",
            "item_key": "item_id",
        }
        legacy_key_name = legacy_key_map.get(key_name)

        exact = self._exact_cache.get(cache_key, {}).get(norm_text)
        if exact is not None:
            result = {
                "matched_name": exact[0],
                key_name: exact[1],
                "matched_key": exact[1],
                "confidence": 1.0,
            }
            if legacy_key_name:
                result[legacy_key_name] = self.legacy_value(exact[1])
            return result

        best_name = ""
        best_key = ""
        best_ratio = 0.0
        near_count = 0
        margin = self._DAKUTEN_TIEBREAK_MARGIN
        for orig_name, norm_name, _dak_norm, entry_key in candidates:
            ratio = SequenceMatcher(None, norm_text, norm_name).ratio()
            if ratio > best_ratio:
                best_ratio = ratio
                best_name = orig_name
                best_key = entry_key
                near_count = 1
            elif ratio >= best_ratio - margin:
                near_count += 1

        if best_ratio < threshold:
            return None

        if near_count > 1:
            dak_text = self._strip_dakuten(norm_text)
            best_dak_ratio = -1.0
            best_primary = 0.0
            for orig_name, norm_name, dak_norm, entry_key in candidates:
                ratio = SequenceMatcher(None, norm_text, norm_name).ratio()
                if ratio < best_ratio - margin:
                    continue
                dak_ratio = SequenceMatcher(None, dak_text, dak_norm).ratio()
                if dak_ratio > best_dak_ratio or (
                    dak_ratio == best_dak_ratio and ratio > best_primary
                ):
                    best_dak_ratio = dak_ratio
                    best_primary = ratio
                    best_name = orig_name
                    best_key = entry_key

        result = {
            "matched_name": best_name,
            key_name: best_key,
            "matched_key": best_key,
            "confidence": round(best_ratio, 4),
        }
        if legacy_key_name:
            result[legacy_key_name] = self.legacy_value(best_key)
        return result

    def fuzzy_match_pokemon_name(
        self, ocr_text: str, lang: str = "ja", threshold: float = 0.6,
    ) -> dict[str, Any] | None:
        return self._fuzzy_match("pokemon", "pokemon_key", ocr_text, lang, threshold)

    def fuzzy_match_move_name(
        self, ocr_text: str, lang: str = "ja", threshold: float = 0.6,
    ) -> dict[str, Any] | None:
        return self._fuzzy_match("moves", "move_key", ocr_text, lang, threshold)

    def fuzzy_match_ability_name(
        self, ocr_text: str, lang: str = "ja", threshold: float = 0.6,
    ) -> dict[str, Any] | None:
        return self._fuzzy_match("abilities", "ability_key", ocr_text, lang, threshold)

    def fuzzy_match_item_name(
        self, ocr_text: str, lang: str = "ja", threshold: float = 0.6,
    ) -> dict[str, Any] | None:
        return self._fuzzy_match("items", "item_key", ocr_text, lang, threshold)

    def localize_name(
        self,
        category: str,
        entry_key: str,
        lang: str = "ja",
    ) -> str | None:
        entries = self.names.get(lang, {}).get(category, {})
        for name, key in entries.items():
            if str(key) == entry_key:
                return name
        return None

    def localize_pokemon_name(
        self,
        pokemon_key: str,
        lang: str = "ja",
    ) -> str | None:
        cache = self._localized_pokemon_name_cache.setdefault(lang, {})
        if pokemon_key in cache:
            return cache[pokemon_key]

        exact = self.localize_name("pokemon", pokemon_key, lang)
        if exact is not None:
            cache[pokemon_key] = exact
            return exact

        pdata = self.get_pokemon_by_key(pokemon_key)
        if pdata is None:
            return None

        fallback = pdata.get("name", pokemon_key)
        if lang != "ja":
            cache[pokemon_key] = fallback
            return fallback

        base_key = str(pdata.get("base_species_key", pokemon_key))
        base_name = self.localize_name("pokemon", base_key, lang)
        if base_name is None:
            base_name = pdata.get("base_species_name") or fallback

        form = str(pdata.get("forme") or "").strip()
        if not form:
            cache[pokemon_key] = base_name
            return base_name

        template = _POKEMON_FORM_NAME_OVERRIDES_JA.get(pokemon_key)
        if template is None:
            template = _POKEMON_FORM_TEMPLATES_JA.get(form)

        if template is not None:
            localized = template.format(base=base_name, form=form)
        else:
            localized = f"{base_name} ({form})"

        cache[pokemon_key] = localized
        return localized

    def get_pokemon_key_to_name_map(
        self, lang: str = "ja", champions_only: bool = False,
    ) -> dict[str, str]:
        cache_key = (lang, champions_only)
        cached = self._pokemon_key_to_name_cache.get(cache_key)
        if cached is not None:
            return cached

        legal_keys: set[str] | None = None
        if champions_only:
            legal_keys = set(self.format.get("legal_pokemon_keys", []))

        result: dict[str, str] = {}
        for pokemon_key, pdata in sorted(self.pokemon.items()):
            if pokemon_key.startswith("_") or not isinstance(pdata, dict):
                continue
            if legal_keys is not None and pokemon_key not in legal_keys:
                continue
            result[pokemon_key] = self.localize_pokemon_name(
                pokemon_key, lang,
            ) or pdata.get("name", pokemon_key)

        self._pokemon_key_to_name_cache[cache_key] = result
        return result

    def get_pokemon_name_choices(
        self, lang: str = "ja", champions_only: bool = False,
    ) -> dict[str, str]:
        cache_key = (lang, champions_only)
        cached = self._pokemon_name_choices_cache.get(cache_key)
        if cached is not None:
            return cached

        key_to_name = self.get_pokemon_key_to_name_map(lang, champions_only)
        result: dict[str, str] = {}

        for pokemon_key, display_name in key_to_name.items():
            unique_name = display_name
            if unique_name in result and result[unique_name] != pokemon_key:
                pdata = self.get_pokemon_by_key(pokemon_key) or {}
                form = str(pdata.get("forme") or "").strip()
                english_name = pdata.get("name", pokemon_key)
                if form:
                    unique_name = f"{display_name} [{form}]"
                elif english_name != display_name:
                    unique_name = f"{display_name} [{english_name}]"
                else:
                    unique_name = f"{display_name} [{pokemon_key}]"

                suffix = 2
                base_unique_name = unique_name
                while unique_name in result and result[unique_name] != pokemon_key:
                    unique_name = f"{base_unique_name} #{suffix}"
                    suffix += 1

            result[unique_name] = pokemon_key

        self._pokemon_name_choices_cache[cache_key] = result
        return result
