"""BattleLogParser のテスト."""

from __future__ import annotations

import time

import pytest

from app.data.game_data import GameData
from app.recognition.battle_log_parser import (
    BattleLogParser,
    _strip_form_suffix,
    match_against_party,
)


@pytest.fixture()
def game_data(tmp_path):
    """最小限の辞書データで GameData を構築する."""
    import json

    base = tmp_path / "base"
    base.mkdir()
    override = tmp_path / "champions_override"
    override.mkdir()
    seasons = tmp_path / "seasons"
    seasons.mkdir()
    names_dir = tmp_path / "names"
    names_dir.mkdir()

    # moves.json にわざの優先度データを含める（素早さ推定テスト用）
    moves_data = {
        "53": {"move_key": "53", "name": "Flamethrower", "priority": 0},
        "89": {"move_key": "89", "name": "Earthquake", "priority": 0},
        "85": {"move_key": "85", "name": "Thunderbolt", "priority": 0},
        "434": {"move_key": "434", "name": "Draco Meteor", "priority": 0},
        "188": {"move_key": "188", "name": "Mortal Spin", "priority": 0},
        "7": {"move_key": "7", "name": "Fire Punch", "priority": 0},
        "421": {"move_key": "421", "name": "Shadow Claw", "priority": 0},
        "98": {"move_key": "98", "name": "Quick Attack", "priority": 1},
    }
    (base / "moves.json").write_text(
        json.dumps(moves_data, ensure_ascii=False), encoding="utf-8",
    )
    pokemon_data = {
        "charizard": {
            "pokemon_key": "charizard",
            "name": "Charizard",
            "types": ["fire", "flying"],
            "base_stats": {"hp": 78, "atk": 84, "def": 78, "spa": 109, "spd": 85, "spe": 100},
        },
        "charizardmegax": {
            "pokemon_key": "charizardmegax",
            "name": "Charizard-Mega-X",
            "base_species_key": "charizard",
            "forme": "Mega-X",
            "is_mega": True,
            "required_item": "charizarditex",
            "types": ["fire", "dragon"],
            "base_stats": {"hp": 78, "atk": 130, "def": 111, "spa": 130, "spd": 85, "spe": 100},
            "abilities": {"0": "Tough Claws"},
        },
        "charizardmegay": {
            "pokemon_key": "charizardmegay",
            "name": "Charizard-Mega-Y",
            "base_species_key": "charizard",
            "forme": "Mega-Y",
            "is_mega": True,
            "required_item": "charizarditey",
            "types": ["fire", "flying"],
            "base_stats": {"hp": 78, "atk": 104, "def": 78, "spa": 159, "spd": 115, "spe": 100},
            "abilities": {"0": "Drought"},
        },
        "gengar": {
            "pokemon_key": "gengar",
            "name": "Gengar",
            "types": ["ghost", "poison"],
            "base_stats": {"hp": 60, "atk": 65, "def": 60, "spa": 130, "spd": 75, "spe": 110},
        },
        "gengarmega": {
            "pokemon_key": "gengarmega",
            "name": "Gengar-Mega",
            "base_species_key": "gengar",
            "forme": "Mega",
            "is_mega": True,
            "required_item": "gengarite",
            "types": ["ghost", "poison"],
            "base_stats": {"hp": 60, "atk": 65, "def": 80, "spa": 170, "spd": 95, "spe": 130},
            "abilities": {"0": "Shadow Tag"},
        },
    }
    (base / "pokemon.json").write_text(
        json.dumps(pokemon_data, ensure_ascii=False), encoding="utf-8",
    )
    items_data = {
        "charizarditex": {
            "item_key": "charizarditex",
            "name": "Charizardite X",
            "mega_stone": "charizardmegax",
            "mega_evolves": "charizard",
        },
        "charizarditey": {
            "item_key": "charizarditey",
            "name": "Charizardite Y",
            "mega_stone": "charizardmegay",
            "mega_evolves": "charizard",
        },
        "gengarite": {
            "item_key": "gengarite",
            "name": "Gengarite",
            "mega_stone": "gengarmega",
            "mega_evolves": "gengar",
        },
        "focussash": {"item_key": "focussash", "name": "Focus Sash"},
        "quickclaw": {"item_key": "quickclaw", "name": "Quick Claw"},
    }
    (base / "items.json").write_text(
        json.dumps(items_data, ensure_ascii=False), encoding="utf-8",
    )
    for fname in ["abilities.json", "types.json", "natures.json"]:
        (base / fname).write_text("{}", encoding="utf-8")
    for fname in ["pokemon_patch.json", "moves_patch.json",
                  "new_entries.json", "learnsets.json"]:
        (override / fname).write_text("{}", encoding="utf-8")
    (seasons / "current.json").write_text('{"current_season": ""}', encoding="utf-8")

    ja_names = {
        "_meta": {"source": "test", "language": "ja"},
        "pokemon": {
            "リザードン": "charizard",
            "ガブリアス": "garchomp",
            "ピカチュウ": "pikachu",
            "カイリュー": "dragonite",
            "ミミッキュ": "mimikyu",
            "キラフロル": "glimmora",
            "ゲンガー": "gengar",
            "メガリザードンX": "charizardmegax",
            "メガリザードンY": "charizardmegay",
            "メガゲンガー": "gengarmega",
        },
        "moves": {
            "かえんほうしゃ": 53,
            "じしん": 89,
            "10まんボルト": 85,
            "りゅうせいぐん": 434,
            "キラースピン": 188,
            "ほのおのパンチ": 7,
            "シャドークロー": 421,
            "でんこうせっか": 98,
        },
        "abilities": {
            "プレッシャー": "pressure",
            "フェアリーオーラ": "fairyaura",
            "そうだいしょう": "supremeoverlord",
        },
        "items": {
            "きあいのタスキ": "focussash",
            "せんせいのツメ": "quickclaw",
            "ゲンガナイト": "gengarite",
            "リザードナイトX": "charizarditex",
            "リザードナイトY": "charizarditey",
        },
    }
    (names_dir / "ja.json").write_text(
        json.dumps(ja_names, ensure_ascii=False), encoding="utf-8",
    )

    # learnsets
    learnsets = {
        "charizard": {"default": [53, 89, 7]},
        "garchomp": {"default": [89, 434]},
        "pikachu": {"default": [85, 98]},
        "glimmora": {"default": [188]},
    }
    (override / "learnsets.json").write_text(
        json.dumps(learnsets, ensure_ascii=False), encoding="utf-8",
    )

    gd = GameData(data_dir=tmp_path)
    gd.load()
    return gd


@pytest.fixture()
def parser(game_data):
    """短いTTLのパーサーを構築する."""
    return BattleLogParser(game_data, dedup_ttl_s=0.5)


class TestFaintedPattern:
    """たおれたパターンのテスト."""

    def test_opponent_fainted(self, parser: BattleLogParser) -> None:
        events = parser.parse("相手の リザードン は たおれた！", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "pokemon_fainted"
        assert ev.side == "opponent"
        assert ev.pokemon_name == "リザードン"
        assert ev.pokemon_key == "charizard"

    def test_player_fainted(self, parser: BattleLogParser) -> None:
        events = parser.parse("リザードン は たおれた！", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "pokemon_fainted"
        assert ev.side == "player"
        assert ev.pokemon_name == "リザードン"
        assert ev.pokemon_key == "charizard"

    def test_fainted_across_two_lines(self, parser: BattleLogParser) -> None:
        events = parser.parse("相手の ガブリアス は", "たおれた！")
        assert len(events) == 1
        ev = events[0]
        assert ev.side == "opponent"
        assert ev.pokemon_name == "ガブリアス"
        assert ev.pokemon_key == "garchomp"

    def test_fuzzy_match_ocr_error(self, parser: BattleLogParser) -> None:
        # "リザードソ" は "リザードン" の1文字違い
        events = parser.parse("相手の リザードソ は たおれた！", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.pokemon_name == "リザードン"
        assert ev.pokemon_key == "charizard"

    def test_unmatched_pokemon_name(self, parser: BattleLogParser) -> None:
        # fuzzy match 不能な名前でもイベントは生成される（species_id=None）
        events = parser.parse("相手の あいうえお は たおれた！", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.pokemon_name == "あいうえお"
        assert ev.species_id is None

    def test_no_match_on_unrelated_text(self, parser: BattleLogParser) -> None:
        events = parser.parse("効果は ばつぐんだ！", "")
        assert len(events) == 1
        assert events[0].event_type == "unrecognized"
        assert "ばつぐんだ" in events[0].raw_text

    def test_empty_text(self, parser: BattleLogParser) -> None:
        assert parser.parse("", "") == []
        assert parser.parse("  ", "  ") == []


class TestOpponentSentOutPattern:
    """相手が繰り出したパターンのテスト."""

    def test_opponent_sent_out_with_known_trainer(self, parser: BattleLogParser) -> None:
        parser.update_context(opponent_trainer="タロウ")
        events = parser.parse("タロウが", "リザードン を 繰り出した！")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "opponent_sent_out"
        assert ev.side == "opponent"
        assert ev.pokemon_name == "リザードン"
        assert ev.pokemon_key == "charizard"
        # OCR専用リージョンの名前が使われる
        assert ev.details["trainer_name"] == "タロウ"

    def test_trainer_name_uses_known_value(self, parser: BattleLogParser) -> None:
        """メインテキストのOCRブレでも、既知のトレーナー名が採用される."""
        parser.update_context(opponent_trainer="タロウ")
        events = parser.parse("タロワが", "ガブリアス を 繰り出した！")
        assert len(events) == 1
        ev = events[0]
        assert ev.details["trainer_name"] == "タロウ"  # 既知の名前を採用
        assert ev.pokemon_name == "ガブリアス"

    def test_mismatched_trainer_rejected(self, parser: BattleLogParser) -> None:
        """既知のトレーナー名と大きく異なる場合は誤検出として棄却（未認識イベント）."""
        parser.update_context(opponent_trainer="タロウ")
        events = parser.parse("効果はが", "ばつぐんだ を 繰り出した！")
        assert len(events) == 1
        assert events[0].event_type == "unrecognized"

    def test_opponent_sent_out_without_context(self, parser: BattleLogParser) -> None:
        """コンテキスト未設定でもマッチする（トレーナー名照合スキップ）."""
        events = parser.parse("タロウが", "リザードン を 繰り出した！")
        assert len(events) == 1
        ev = events[0]
        assert ev.details["trainer_name"] == "タロウ"
        assert ev.pokemon_key == "charizard"

    def test_opponent_sent_out_fuzzy_pokemon(self, parser: BattleLogParser) -> None:
        parser.update_context(opponent_trainer="タロウ")
        # OCRブレ: "ピカチユウ" → "ピカチュウ"
        events = parser.parse("タロウが", "ピカチユウ を 繰り出した！")
        assert len(events) == 1
        ev = events[0]
        assert ev.pokemon_name == "ピカチュウ"
        assert ev.pokemon_key == "pikachu"

    def test_opponent_sent_out_unknown_pokemon(self, parser: BattleLogParser) -> None:
        parser.update_context(opponent_trainer="タロウ")
        events = parser.parse("タロウが", "あいうえお を 繰り出した！")
        assert len(events) == 1
        ev = events[0]
        assert ev.pokemon_name == "あいうえお"
        assert ev.species_id is None


class TestPlayerSentOutPattern:
    """プレイヤーのポケモン送り出しパターンのテスト."""

    def test_player_sent_out_clean(self, parser: BattleLogParser) -> None:
        """正常なテキスト: ゆけっ！ピカチュウ."""
        events = parser.parse("ゆけっ！ピカチュウ", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "player_sent_out"
        assert ev.side == "player"
        assert ev.pokemon_name == "ピカチュウ"
        assert ev.pokemon_key == "pikachu"

    def test_player_sent_out_ocr_error_ga(self, parser: BattleLogParser) -> None:
        """OCRエラー: っ→っが, ！→つ."""
        events = parser.parse("ゆけっがつピカチュウ", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "player_sent_out"
        assert ev.pokemon_name == "ピカチュウ"
        assert ev.pokemon_key == "pikachu"

    def test_player_sent_out_halfwidth_excl(self, parser: BattleLogParser) -> None:
        """半角!でも検出される."""
        events = parser.parse("ゆけっ!リザードン", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.pokemon_name == "リザードン"
        assert ev.pokemon_key == "charizard"

    def test_player_sent_out_with_space(self, parser: BattleLogParser) -> None:
        """ポケモン名の前にスペース."""
        events = parser.parse("ゆけっ！ ガブリアス", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.pokemon_name == "ガブリアス"
        assert ev.pokemon_key == "garchomp"

    def test_player_sent_out_across_two_lines(self, parser: BattleLogParser) -> None:
        """2行にまたがるケース."""
        events = parser.parse("ゆけっ！", "ピカチュウ")
        assert len(events) == 1
        ev = events[0]
        assert ev.pokemon_name == "ピカチュウ"
        assert ev.pokemon_key == "pikachu"

    def test_player_sent_out_tsu_normalization(self, parser: BattleLogParser) -> None:
        """っ が つ に読み替えられるケース."""
        events = parser.parse("ゆけつ！ピカチュウ", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.pokemon_key == "pikachu"

    def test_player_sent_out_party_matching(self, parser: BattleLogParser) -> None:
        """プレイヤーパーティ限定マッチング."""
        parser.update_context(player_party=[
            {"pokemon_key": "pikachu", "name": "ピカチュウ"},
            {"pokemon_key": "charizard", "name": "リザードン"},
        ])
        # OCRブレ: "ピカチユウ" → "ピカチュウ"
        events = parser.parse("ゆけっ！ピカチユウ", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.pokemon_name == "ピカチュウ"
        assert ev.pokemon_key == "pikachu"

    def test_player_sent_out_unrelated_text(self, parser: BattleLogParser) -> None:
        """ゆけ を含まないテキストは検出されない（未認識イベント）."""
        events = parser.parse("効果は ばつぐんだ！", "")
        assert len(events) == 1
        assert events[0].event_type == "unrecognized"

    def test_player_sent_out_ws_message(self, parser: BattleLogParser) -> None:
        """WebSocketメッセージのフォーマット."""
        events = parser.parse("ゆけっ！リザードン", "")
        msg = events[0].to_ws_message()
        assert msg["type"] == "battle_event"
        assert msg["event_type"] == "player_sent_out"
        assert msg["side"] == "player"
        assert msg["pokemon_name"] == "リザードン"
        assert msg["species_id"] == "charizard"


class TestDeduplication:
    """重複排除のテスト."""

    def test_same_text_consecutive(self, parser: BattleLogParser) -> None:
        events1 = parser.parse("相手の ピカチュウ は たおれた！", "")
        assert len(events1) == 1

        # 同一テキスト → 高速パスでスキップ
        events2 = parser.parse("相手の ピカチュウ は たおれた！", "")
        assert len(events2) == 0

    def test_same_event_different_text(self, parser: BattleLogParser) -> None:
        """OCRブレでテキストが微妙に違っても、同じイベントなら重複排除."""
        events1 = parser.parse("相手の ピカチュウ は たおれた！", "")
        assert len(events1) == 1

        # テキストは変わったが同じイベント → フィンガープリントで排除
        events2 = parser.parse("相手の ピカチュウ は たおれた!", "")
        assert len(events2) == 0

    def test_different_event_not_deduplicated(self, parser: BattleLogParser) -> None:
        events1 = parser.parse("相手の ピカチュウ は たおれた！", "")
        assert len(events1) == 1

        events2 = parser.parse("相手の リザードン は たおれた！", "")
        assert len(events2) == 1

    def test_dedup_expires_after_ttl(self, parser: BattleLogParser) -> None:
        events1 = parser.parse("相手の ピカチュウ は たおれた！", "")
        assert len(events1) == 1

        # TTL (0.5s) 待ち
        time.sleep(0.6)

        # テキストを変えて高速パスを回避（実際のゲームでは別のメッセージ挟む想定）
        parser._last_raw_text = ""
        events2 = parser.parse("相手の ピカチュウ は たおれた！", "")
        assert len(events2) == 1

    def test_reset_clears_dedup(self, parser: BattleLogParser) -> None:
        events1 = parser.parse("相手の ピカチュウ は たおれた！", "")
        assert len(events1) == 1

        parser.reset()

        events2 = parser.parse("相手の ピカチュウ は たおれた！", "")
        assert len(events2) == 1


class TestStatChangePattern:
    """ステータス変化パターンのテスト."""

    def test_opponent_attack_up_2(self, parser: BattleLogParser) -> None:
        """相手の こうげきが ぐーんと 上がった（+2段階）."""
        events = parser.parse("相手の リザードン の", "こうげきが ぐーんと 上がった！")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "stat_change"
        assert ev.side == "opponent"
        assert ev.pokemon_name == "リザードン"
        assert ev.pokemon_key == "charizard"
        assert ev.details["stat"] == "atk"
        assert ev.details["stages"] == 2

    def test_opponent_speed_up_1(self, parser: BattleLogParser) -> None:
        """相手の すばやさが 上がった（+1段階）."""
        events = parser.parse("相手の ガブリアス の", "すばやさが 上がった！")
        assert len(events) == 1
        ev = events[0]
        assert ev.details["stat"] == "spe"
        assert ev.details["stages"] == 1
        assert ev.pokemon_key == "garchomp"

    def test_opponent_defense_down_1(self, parser: BattleLogParser) -> None:
        """相手の ぼうぎょが 下がった（-1段階）."""
        events = parser.parse("相手の ピカチュウ の", "ぼうぎょが 下がった！")
        assert len(events) == 1
        ev = events[0]
        assert ev.details["stat"] == "def"
        assert ev.details["stages"] == -1
        assert ev.pokemon_key == "pikachu"

    def test_opponent_spdef_down_2(self, parser: BattleLogParser) -> None:
        """相手の とくぼうが がくっと 下がった（-2段階）."""
        events = parser.parse("相手の ミミッキュ の", "とくぼうが がくっと 下がった！")
        assert len(events) == 1
        ev = events[0]
        assert ev.details["stat"] == "spd"
        assert ev.details["stages"] == -2
        assert ev.pokemon_key == "mimikyu"

    def test_opponent_spatk_up_3(self, parser: BattleLogParser) -> None:
        """相手の とくこうが ぐぐーんと 上がった（+3段階）."""
        events = parser.parse("相手の カイリュー の", "とくこうが ぐぐーんと 上がった！")
        assert len(events) == 1
        ev = events[0]
        assert ev.details["stat"] == "spa"
        assert ev.details["stages"] == 3

    def test_opponent_speed_down_3(self, parser: BattleLogParser) -> None:
        """相手の すばやさが がくーんと 下がった（-3段階）."""
        events = parser.parse("相手の ガブリアス の", "すばやさが がくーんと 下がった！")
        assert len(events) == 1
        ev = events[0]
        assert ev.details["stat"] == "spe"
        assert ev.details["stages"] == -3

    def test_opponent_stat_change_kanji_attack(self, parser: BattleLogParser) -> None:
        """UI が「攻撃」漢字表記のときも stat_change に落とす（move_used にしない）."""
        events = parser.parse("相手のリザードンの 攻撃がぐーんと上がった!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "stat_change"
        assert ev.pokemon_name == "リザードン"
        assert ev.details["stat"] == "atk"
        assert ev.details["stages"] == 2

    def test_player_stat_change(self, parser: BattleLogParser) -> None:
        """プレイヤー側のステータス変化（相手なし）."""
        events = parser.parse("リザードン の", "こうげきが 上がった！")
        assert len(events) == 1
        ev = events[0]
        assert ev.side == "player"
        assert ev.details["stat"] == "atk"
        assert ev.details["stages"] == 1

    def test_fuzzy_pokemon_name(self, parser: BattleLogParser) -> None:
        """OCRブレでもポケモン名がfuzzy matchされる."""
        events = parser.parse("相手の リザードソ の", "こうげきが 上がった！")
        assert len(events) == 1
        ev = events[0]
        assert ev.pokemon_name == "リザードン"
        assert ev.pokemon_key == "charizard"

    def test_party_limited_matching(self, parser: BattleLogParser) -> None:
        """パーティ限定マッチングが使用される."""
        parser.update_context(opponent_party=[
            {"pokemon_key": "charizard", "name": "リザードン"},
            {"pokemon_key": "garchomp", "name": "ガブリアス"},
        ])
        events = parser.parse("相手の リザードン の", "とくこうが ぐーんと 上がった！")
        assert len(events) == 1
        ev = events[0]
        assert ev.pokemon_key == "charizard"
        assert ev.details["stat"] == "spa"
        assert ev.details["stages"] == 2

    def test_different_stats_not_deduplicated(self, parser: BattleLogParser) -> None:
        """同一ポケモンで異なるステータス変化は重複排除されない."""
        events1 = parser.parse("相手の リザードン の", "こうげきが 上がった！")
        assert len(events1) == 1

        events2 = parser.parse("相手の リザードン の", "ぼうぎょが 下がった！")
        assert len(events2) == 1

    def test_same_stat_change_deduplicated(self, parser: BattleLogParser) -> None:
        """同一ステータス変化はTTL内で重複排除される."""
        events1 = parser.parse("相手の リザードン の", "こうげきが 上がった！")
        assert len(events1) == 1

        # テキスト微差でも同一フィンガープリントなら排除
        parser._last_raw_text = ""  # 高速パスを回避
        events2 = parser.parse("相手の リザードン の", "こうげきが 上がった!")
        assert len(events2) == 0

    def test_ws_message_includes_stat_details(self, parser: BattleLogParser) -> None:
        """WebSocketメッセージにstat/stagesが含まれる."""
        events = parser.parse("相手の カイリュー の", "すばやさが ぐーんと 上がった！")
        msg = events[0].to_ws_message()
        assert msg["type"] == "battle_event"
        assert msg["event_type"] == "stat_change"
        assert msg["details"]["stat"] == "spe"
        assert msg["details"]["stages"] == 2


class TestMoveUsedPattern:
    """技使用パターンのテスト."""

    def test_opponent_move_used(self, parser: BattleLogParser) -> None:
        """相手のポケモンが技を使用した基本ケース."""
        events = parser.parse("相手のキラフロルの", "キラースピン!")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "move_used"
        assert ev.side == "opponent"
        assert ev.pokemon_name == "キラフロル"
        assert ev.pokemon_key == "glimmora"
        assert ev.move_name == "キラースピン"
        assert ev.move_id == 188

    def test_player_move_used(self, parser: BattleLogParser) -> None:
        """自分のポケモンが技を使用."""
        events = parser.parse("ピカチュウの", "10まんボルト!")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "move_used"
        assert ev.side == "player"
        assert ev.pokemon_name == "ピカチュウ"
        assert ev.pokemon_key == "pikachu"
        assert ev.move_name == "10まんボルト"
        assert ev.move_id == 85

    def test_move_with_no_in_name(self, parser: BattleLogParser) -> None:
        """「の」を含む技名（ほのおのパンチ）が正しく解析される."""
        events = parser.parse("相手のリザードンの", "ほのおのパンチ!")
        assert len(events) == 1
        ev = events[0]
        assert ev.pokemon_name == "リザードン"
        assert ev.pokemon_key == "charizard"
        assert ev.move_name == "ほのおのパンチ"
        assert ev.move_id == 7

    def test_fuzzy_pokemon_name(self, parser: BattleLogParser) -> None:
        """OCRブレでもポケモン名がfuzzy matchされる."""
        events = parser.parse("相手のリザードソの", "かえんほうしゃ!")
        assert len(events) == 1
        ev = events[0]
        assert ev.pokemon_name == "リザードン"
        assert ev.pokemon_key == "charizard"

    def test_fuzzy_move_name_learnset(self, parser: BattleLogParser) -> None:
        """learnset限定でのfuzzy matchが効く."""
        # "かえんほうしや" → "かえんほうしゃ" (1文字違い)
        events = parser.parse("相手のリザードンの", "かえんほうしや!")
        assert len(events) == 1
        ev = events[0]
        assert ev.move_name == "かえんほうしゃ"
        assert ev.move_id == 53

    def test_party_limited_pokemon(self, parser: BattleLogParser) -> None:
        """パーティ限定マッチングが使用される."""
        parser.update_context(opponent_party=[
            {"pokemon_key": "glimmora", "name": "キラフロル"},
            {"pokemon_key": "garchomp", "name": "ガブリアス"},
        ])
        events = parser.parse("相手のキラフロルの", "キラースピン!")
        assert len(events) == 1
        ev = events[0]
        assert ev.pokemon_key == "glimmora"

    def test_unmatched_move_returns_raw_text(self, parser: BattleLogParser) -> None:
        """learnset にマッチしない場合は生テキストでイベント発行."""
        events = parser.parse("相手のリザードンの", "あいうえお!")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "move_used"
        assert ev.move_name == "あいうえお"
        assert ev.move_id is None

    def test_stat_change_not_captured_as_move(self, parser: BattleLogParser) -> None:
        """ステータス変化がmove_usedとして誤検出されない."""
        events = parser.parse("相手の リザードン の", "こうげきが ぐーんと 上がった！")
        assert len(events) == 1
        assert events[0].event_type == "stat_change"

    def test_yawn_aftermath_is_drowsy_status(self, parser: BattleLogParser) -> None:
        """あくび後の「眠気を誘った」は move_used ではなく drowsy として扱う."""
        events = parser.parse("相手のリザードンの 眠気を　誘つた!", "")
        assert len(events) == 1
        assert events[0].event_type == "status_condition"
        assert events[0].details["status"] == "drowsy"

    def test_move_used_dedup(self, parser: BattleLogParser) -> None:
        """同一技使用はTTL内で重複排除される."""
        events1 = parser.parse("相手のガブリアスの", "じしん!")
        assert len(events1) == 1

        parser._last_raw_text = ""
        events2 = parser.parse("相手のガブリアスの", "じしん！")
        assert len(events2) == 0

    def test_fullwidth_exclamation(self, parser: BattleLogParser) -> None:
        """全角！でも技使用が検出される."""
        events = parser.parse("相手のガブリアスの", "じしん！")
        assert len(events) == 1
        ev = events[0]
        assert ev.move_name == "じしん"
        assert ev.move_id == 89

    def test_ocr_latin_noise_move_name(self, parser: BattleLogParser) -> None:
        """OCR英字混入 (UUん) でもパイプライン補正で じしん にマッチする."""
        events = parser.parse("相手のガブリアスの", "UUん!")
        assert len(events) == 1
        ev = events[0]
        assert ev.move_name == "じしん"
        assert ev.move_key == "earthquake" or ev.move_id == 89

    def test_ws_message_includes_move(self, parser: BattleLogParser) -> None:
        """WebSocketメッセージにmove_name/move_idが含まれる."""
        events = parser.parse("相手のリザードンの", "かえんほうしゃ!")
        msg = events[0].to_ws_message()
        assert msg["type"] == "battle_event"
        assert msg["event_type"] == "move_used"
        assert msg["move_name"] == "かえんほうしゃ"
        assert msg["move_id"] == 53
        assert msg["pokemon_name"] == "リザードン"
        assert msg["species_id"] == "charizard"

    def test_move_used_includes_priority(self, parser: BattleLogParser) -> None:
        """通常わざの details に priority=0 が含まれる."""
        events = parser.parse("相手のリザードンの", "かえんほうしゃ!")
        assert len(events) == 1
        ev = events[0]
        assert ev.details.get("priority") == 0

    def test_priority_move_has_correct_priority(self, parser: BattleLogParser) -> None:
        """先制わざ（でんこうせっか）の details に priority=1 が含まれる."""
        events = parser.parse("ピカチュウの", "でんこうせっか!")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "move_used"
        assert ev.move_name == "でんこうせっか"
        assert ev.details.get("priority") == 1

    def test_unmatched_move_has_no_priority(self, parser: BattleLogParser) -> None:
        """辞書に存在しないわざは details に priority が含まれない."""
        events = parser.parse("相手のリザードンの", "あいうえお!")
        assert len(events) == 1
        ev = events[0]
        assert "priority" not in ev.details

    def test_ws_message_includes_priority(self, parser: BattleLogParser) -> None:
        """WebSocketメッセージの details に priority が含まれる."""
        events = parser.parse("ピカチュウの", "でんこうせっか!")
        msg = events[0].to_ws_message()
        assert msg["details"]["priority"] == 1


class TestUnrecognizedEvent:
    """未認識テキストイベントのテスト."""

    def test_unrecognized_dedup_same_text(self, parser: BattleLogParser) -> None:
        """同一未認識テキスト連続は _last_raw_text でスキップ."""
        events1 = parser.parse("効果は ばつぐんだ！", "")
        assert len(events1) == 1
        assert events1[0].event_type == "unrecognized"

        events2 = parser.parse("効果は ばつぐんだ！", "")
        assert len(events2) == 0  # _last_raw_text 高速パス

    def test_unrecognized_dedup_ttl(self, parser: BattleLogParser) -> None:
        """TTL内で別テキストを挟んでも同一未認識テキストは排除."""
        events1 = parser.parse("効果は ばつぐんだ！", "")
        assert len(events1) == 1

        # 別テキストを挟んで _last_raw_text をリセット
        parser.parse("相手の リザードン は たおれた！", "")

        events3 = parser.parse("効果は ばつぐんだ！", "")
        assert len(events3) == 0  # fingerprint TTL で排除

    def test_unrecognized_ws_message(self, parser: BattleLogParser) -> None:
        """未認識イベントの WebSocket メッセージフォーマット."""
        events = parser.parse("効果は ばつぐんだ！", "")
        msg = events[0].to_ws_message()
        assert msg["type"] == "battle_event"
        assert msg["event_type"] == "unrecognized"
        assert msg["side"] == "unknown"
        assert "ばつぐんだ" in msg["raw_text"]


class TestToWsMessage:
    """WebSocket メッセージ変換のテスト."""

    def test_ws_message_format(self, parser: BattleLogParser) -> None:
        events = parser.parse("相手の カイリュー は たおれた！", "")
        msg = events[0].to_ws_message()
        assert msg["type"] == "battle_event"
        assert msg["event_type"] == "pokemon_fainted"
        assert msg["side"] == "opponent"
        assert msg["pokemon_name"] == "カイリュー"
        assert msg["species_id"] == "dragonite"
        assert msg["move_name"] is None
        assert msg["move_id"] is None
        assert isinstance(msg["details"], dict)


class TestOpponentSentOutHaParticle:
    """opponent_sent_out: は パーティクルでのマッチ修正テスト."""

    def test_ha_particle(self, parser: BattleLogParser) -> None:
        """「は」パーティクルで繰り出しが検出される."""
        parser.update_context(opponent_trainer="ソラシド")
        events = parser.parse("ソラシドは ヤドキングを繰り出した!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "opponent_sent_out"
        assert ev.side == "opponent"
        assert ev.details["trainer_name"] == "ソラシド"

    def test_ha_particle_with_ocr_trainer(self, parser: BattleLogParser) -> None:
        """OCRブレのトレーナー名でも検出される."""
        parser.update_context(opponent_trainer="ソラシド")
        events = parser.parse("ソラシドは", "ガブリアス を 繰り出した！")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "opponent_sent_out"
        assert ev.pokemon_name == "ガブリアス"

    def test_ga_particle_still_works(self, parser: BattleLogParser) -> None:
        """従来の「が」パーティクルも引き続き動作する."""
        events = parser.parse("タロウが", "リザードン を 繰り出した！")
        assert len(events) == 1
        assert events[0].event_type == "opponent_sent_out"


class TestNoiseFilter:
    """ノイズフィルターのテスト."""

    def test_timer_text(self, parser: BattleLogParser) -> None:
        """タイマーテキストはフィルターされる."""
        assert parser.parse("04:16", "") == []
        assert parser.parse("03:49", "") == []

    def test_short_ascii(self, parser: BattleLogParser) -> None:
        """短いASCIIゴミはフィルターされる."""
        assert parser.parse("S", "") == []
        assert parser.parse("MnA", "") == []
        assert parser.parse("LO", "") == []

    def test_single_number(self, parser: BattleLogParser) -> None:
        """数字のみはフィルターされる."""
        assert parser.parse("2", "") == []
        assert parser.parse("4", "") == []

    def test_punctuation_only(self, parser: BattleLogParser) -> None:
        """記号のみはフィルターされる."""
        assert parser.parse("?", "") == []
        assert parser.parse("-", "") == []
        assert parser.parse("#", "") == []

    def test_real_text_not_filtered(self, parser: BattleLogParser) -> None:
        """実際のバトルテキストはフィルターされない."""
        events = parser.parse("相手の リザードン は たおれた！", "")
        assert len(events) == 1
        assert events[0].event_type == "pokemon_fainted"


class TestTypeEffectivenessPattern:
    """タイプ相性パターンのテスト."""

    def test_super_effective(self, parser: BattleLogParser) -> None:
        events = parser.parse("効果はバツグンだ!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "type_effectiveness"
        assert ev.details["effectiveness"] == "super_effective"

    def test_not_very_effective(self, parser: BattleLogParser) -> None:
        events = parser.parse("効果はいまひとつだ", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.details["effectiveness"] == "not_very_effective"

    def test_double_super_effective(self, parser: BattleLogParser) -> None:
        events = parser.parse("効果はちょうバツグンだ!!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.details["effectiveness"] == "double_super_effective"

    def test_ocr_variant_chou(self, parser: BattleLogParser) -> None:
        """OCRブレ: ちょう→ちよう."""
        events = parser.parse("効果はちようバツグンだ!!", "")
        assert len(events) == 1
        assert events[0].details["effectiveness"] == "double_super_effective"


class TestWeatherPattern:
    """天候パターンのテスト."""

    def test_snow_start(self, parser: BattleLogParser) -> None:
        events = parser.parse("雪が降り始めた!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "weather"
        assert ev.details["weather"] == "snow"
        assert ev.details["action"] == "start"

    def test_snow_end(self, parser: BattleLogParser) -> None:
        events = parser.parse("雪が止んだ!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.details["weather"] == "snow"
        assert ev.details["action"] == "end"


class TestTrickRoomPattern:
    """トリックルームパターンのテスト."""

    def test_trick_room_start(self, parser: BattleLogParser) -> None:
        events = parser.parse("相手のリザードンは 時空をゆがめた!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "field_effect"
        assert ev.details["effect"] == "trick_room"
        assert ev.details["action"] == "start"
        assert ev.side == "opponent"

    def test_trick_room_end(self, parser: BattleLogParser) -> None:
        events = parser.parse("ゆがんだ時空が元に戻った!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "field_effect"
        assert ev.details["effect"] == "trick_room"
        assert ev.details["action"] == "end"

    def test_trick_room_end_ocr_tsu(self, parser: BattleLogParser) -> None:
        """OCRブレ: 戻った→戻つた."""
        events = parser.parse("ゆがんだ時空が元に戻つた!", "")
        assert len(events) == 1
        assert events[0].event_type == "field_effect"


class TestHazardPattern:
    """ステルスロックパターンのテスト."""

    def test_hazard_set_opponent(self, parser: BattleLogParser) -> None:
        events = parser.parse("相手の周りに とがった岩がただよい始めた!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "hazard_set"
        assert ev.side == "opponent"
        assert ev.details["hazard_type"] == "stealth_rock"

    def test_hazard_set_player(self, parser: BattleLogParser) -> None:
        events = parser.parse("周りに とがった岩がただよい始めた!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "hazard_set"
        assert ev.side == "player"

    def test_hazard_damage(self, parser: BattleLogParser) -> None:
        events = parser.parse("相手のリザードンに とがった岩が食いこんだ!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "hazard_damage"
        assert ev.side == "opponent"
        assert ev.pokemon_name == "リザードン"

    def test_hazard_damage_ocr_tsu(self, parser: BattleLogParser) -> None:
        """OCRブレ: とがった→とがつた."""
        events = parser.parse("相手のガブリアスに とがつた岩が食いこんだ!", "")
        assert len(events) == 1
        assert events[0].event_type == "hazard_damage"
        assert events[0].pokemon_name == "ガブリアス"


class TestProtectPattern:
    """まもるパターンのテスト."""

    def test_protect_stance(self, parser: BattleLogParser) -> None:
        events = parser.parse("ピカチュウは 守りの体勢に入った!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "protect"
        assert ev.side == "player"
        assert ev.details["phase"] == "stance"
        assert ev.pokemon_name == "ピカチュウ"

    def test_protect_blocked(self, parser: BattleLogParser) -> None:
        events = parser.parse("ピカチュウは 攻撃から身を守った!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "protect"
        assert ev.details["phase"] == "blocked"

    def test_protect_opponent(self, parser: BattleLogParser) -> None:
        events = parser.parse("相手のリザードンは 守りの体勢に入った!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.side == "opponent"

    def test_protect_ocr_tsu(self, parser: BattleLogParser) -> None:
        """OCRブレ: 入った→入つた, 守った→守つた."""
        events = parser.parse("ピカチュウは 守りの体勢に入つた!", "")
        assert len(events) == 1
        assert events[0].event_type == "protect"

        parser._last_raw_text = ""
        parser._recent_events.clear()
        events = parser.parse("ピカチュウは 攻撃から身を守つた!", "")
        assert len(events) == 1
        assert events[0].event_type == "protect"


class TestSleepPattern:
    """ねむり状態パターンのテスト."""

    def test_fell_asleep(self, parser: BattleLogParser) -> None:
        events = parser.parse("ピカチュウは 眠ってしまった!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "status_condition"
        assert ev.details["status"] == "sleep"
        assert ev.details["phase"] == "inflicted"
        assert ev.pokemon_name == "ピカチュウ"

    def test_still_sleeping(self, parser: BattleLogParser) -> None:
        events = parser.parse("ピカチュウは ぐうぐう眠っている", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.details["phase"] == "continuing"

    def test_fell_asleep_opponent(self, parser: BattleLogParser) -> None:
        events = parser.parse("相手のリザードンは 眠ってしまった!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.side == "opponent"

    def test_ocr_tsu_variant(self, parser: BattleLogParser) -> None:
        """OCRブレ: 眠って→眠つて."""
        events = parser.parse("ピカチュウは 眠つてしまつた!", "")
        assert len(events) == 1
        assert events[0].event_type == "status_condition"


class TestMoveFailedPattern:
    """技失敗/命中ミスパターンのテスト."""

    def test_move_failed(self, parser: BattleLogParser) -> None:
        events = parser.parse("しかしうまく決まらなかった!!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "move_failed"
        assert ev.details["reason"] == "failed"

    def test_move_failed_ocr_tsu(self, parser: BattleLogParser) -> None:
        events = parser.parse("しかしうまく決まらなかつた!!", "")
        assert len(events) == 1
        assert events[0].event_type == "move_failed"

    def test_move_missed(self, parser: BattleLogParser) -> None:
        events = parser.parse("ガブリアスには 当たらなかった!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "move_failed"
        assert ev.details["reason"] == "missed"
        assert ev.pokemon_name == "ガブリアス"

    def test_move_missed_opponent(self, parser: BattleLogParser) -> None:
        events = parser.parse("相手のリザードンには 当たらなかった!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.side == "opponent"


class TestForcedSwitchPattern:
    """強制交代パターンのテスト."""

    def test_forced_switch_opponent(self, parser: BattleLogParser) -> None:
        events = parser.parse("相手のリザードンは 戦闘に引きずりだされた!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "forced_switch"
        assert ev.side == "opponent"
        assert ev.pokemon_name == "リザードン"
        assert ev.details["method"] == "dragged"

    def test_forced_switch_ocr_variant(self, parser: BattleLogParser) -> None:
        """OCRブレ: 引きずり→引きすり."""
        events = parser.parse("相手のガブリアスは 戦闘に引きすりだされた!", "")
        assert len(events) == 1
        assert events[0].event_type == "forced_switch"


class TestMegaEvolutionPattern:
    """メガシンカパターンのテスト."""

    def test_mega_evolution_opponent(self, parser: BattleLogParser) -> None:
        events = parser.parse("相手のリザードンは メガリザードンにメガシンカした!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "mega_evolution"
        assert ev.side == "opponent"
        assert ev.pokemon_name == "リザードン"
        assert ev.details["mega_name"] == "メガリザードン"

    def test_mega_evolution_player(self, parser: BattleLogParser) -> None:
        events = parser.parse("リザードンは メガリザードンにメガシンカした!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.side == "player"

    def test_mega_evolution_resolves_mega_x(self, parser: BattleLogParser) -> None:
        """メガリザードンXの pokemon_key が解決される."""
        events = parser.parse("相手のリザードンは メガリザードンXにメガシンカした!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "mega_evolution"
        assert ev.pokemon_key == "charizard"
        assert ev.details["mega_pokemon_key"] == "charizardmegax"
        assert ev.details["mega_name"] == "メガリザードンX"

    def test_mega_evolution_resolves_mega_y(self, parser: BattleLogParser) -> None:
        """メガリザードンYの pokemon_key が解決される."""
        events = parser.parse("リザードンは メガリザードンYにメガシンカした!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.details["mega_pokemon_key"] == "charizardmegay"

    def test_mega_evolution_single_form(self, parser: BattleLogParser) -> None:
        """単一メガフォーム（ゲンガー）の解決."""
        events = parser.parse("相手のゲンガーは メガゲンガーにメガシンカした!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.pokemon_key == "gengar"
        assert ev.details["mega_pokemon_key"] == "gengarmega"

    def test_mega_evolution_unknown_base(self, parser: BattleLogParser) -> None:
        """未知ポケモンの場合 mega_pokemon_key は None."""
        events = parser.parse("相手のナゾノクサは メガナゾノクサにメガシンカした!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.details["mega_pokemon_key"] is None


class TestSurrenderPattern:
    """降参パターンのテスト."""

    def test_surrender(self, parser: BattleLogParser) -> None:
        events = parser.parse("降参が 選ばれました", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "surrender"
        assert ev.side == "unknown"


class TestPokemonRecalledPattern:
    """ポケモン引っ込め/戻しパターンのテスト."""

    def test_player_recall(self, parser: BattleLogParser) -> None:
        """プレイヤーの「戻れ!」."""
        events = parser.parse("ピカチュウ 戻れ!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "pokemon_recalled"
        assert ev.side == "player"
        assert ev.pokemon_name == "ピカチュウ"
        assert ev.details["method"] == "recall"

    def test_opponent_returning(self, parser: BattleLogParser) -> None:
        """相手のポケモンが戻っていく."""
        parser.update_context(opponent_trainer="タロウ")
        events = parser.parse("相手のリザードンは タロウの元へ戻っていく!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "pokemon_recalled"
        assert ev.side == "opponent"
        assert ev.pokemon_name == "リザードン"
        assert ev.details["method"] == "returning"

    def test_opponent_returning_ocr_tsu(self, parser: BattleLogParser) -> None:
        """OCRブレ: 戻っていく→戻つていく."""
        parser.update_context(opponent_trainer="タロウ")
        events = parser.parse("相手のリザードンは タロウの元へ戻つていく!", "")
        assert len(events) == 1
        assert events[0].event_type == "pokemon_recalled"

    def test_withdrew(self, parser: BattleLogParser) -> None:
        """トレーナーがポケモンを引っこめた."""
        parser.update_context(opponent_trainer="タロウ")
        events = parser.parse("タロウは リザードンを引っこめた!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "pokemon_recalled"
        assert ev.side == "opponent"
        assert ev.details["method"] == "withdrew"

    def test_withdrew_ocr_tsu(self, parser: BattleLogParser) -> None:
        """OCRブレ: 引っこめた→引つこめた."""
        parser.update_context(opponent_trainer="タロウ")
        events = parser.parse("タロウは リザードンを引つこめた!", "")
        assert len(events) == 1
        assert events[0].event_type == "pokemon_recalled"


# ---------------------------------------------------------------------------
# _strip_form_suffix
# ---------------------------------------------------------------------------


class TestStripFormSuffix:
    """フォルム接尾辞の除去テスト."""

    def test_galarian(self) -> None:
        assert _strip_form_suffix("ヤドキング(ガラルのすがた)") == "ヤドキング"

    def test_alolan(self) -> None:
        assert _strip_form_suffix("ガラガラ(アローラのすがた)") == "ガラガラ"

    def test_paldea_aqua(self) -> None:
        assert _strip_form_suffix("ケンタロス(パルデアのすがた・アクア)") == "ケンタロス"

    def test_mighty_form(self) -> None:
        assert _strip_form_suffix("イルカマン(マイティフォルム)") == "イルカマン"

    def test_no_suffix(self) -> None:
        assert _strip_form_suffix("リザードン") == "リザードン"

    def test_prefix_form_unchanged(self) -> None:
        assert _strip_form_suffix("ヒートロトム") == "ヒートロトム"

    def test_female_symbol_unchanged(self) -> None:
        assert _strip_form_suffix("ニドラン♀") == "ニドラン♀"

    def test_fullwidth_parentheses(self) -> None:
        assert _strip_form_suffix("テスト（フォルム）") == "テスト"


# ---------------------------------------------------------------------------
# match_against_party — リージョナルフォルム
# ---------------------------------------------------------------------------


class TestMatchAgainstPartyRegionalForms:
    """リージョナルフォルム名のパーティマッチングテスト."""

    def test_base_name_matches_galarian(self) -> None:
        party = [{"pokemon_key": "slowkinggalar", "name": "ヤドキング(ガラルのすがた)"}]
        result = match_against_party("ヤドキング", party)
        assert result is not None
        assert result["pokemon_key"] == "slowkinggalar"
        assert result["matched_name"] == "ヤドキング(ガラルのすがた)"
        assert result["confidence"] == 1.0

    def test_base_name_matches_alolan(self) -> None:
        party = [{"pokemon_key": "marowakalola", "name": "ガラガラ(アローラのすがた)"}]
        result = match_against_party("ガラガラ", party)
        assert result is not None
        assert result["confidence"] == 1.0

    def test_fuzzy_match_with_form_suffix(self) -> None:
        """OCR エラーでも接尾辞除去後なら高い類似度."""
        party = [{"pokemon_key": "slowkinggalar", "name": "ヤドキング(ガラルのすがた)"}]
        result = match_against_party("ヤドキンク", party)
        assert result is not None
        assert result["pokemon_key"] == "slowkinggalar"
        assert result["confidence"] > 0.7

    def test_full_name_still_matches(self) -> None:
        """フル名（接尾辞付き）でも完全一致."""
        party = [{"pokemon_key": "slowkinggalar", "name": "ヤドキング(ガラルのすがた)"}]
        result = match_against_party("ヤドキング(ガラルのすがた)", party)
        assert result is not None
        assert result["confidence"] == 1.0

    def test_prefix_form_unaffected(self) -> None:
        party = [{"pokemon_key": "rotomheat", "name": "ヒートロトム"}]
        result = match_against_party("ヒートロトム", party)
        assert result is not None
        assert result["confidence"] == 1.0

    def test_base_form_preferred_over_regional(self) -> None:
        """ベース形式がパーティにあれば、そちらが完全一致で優先."""
        party = [
            {"pokemon_key": "slowking", "name": "ヤドキング"},
            {"pokemon_key": "slowkinggalar", "name": "ヤドキング(ガラルのすがた)"},
        ]
        result = match_against_party("ヤドキング", party)
        assert result is not None
        assert result["pokemon_key"] == "slowking"
        assert result["confidence"] == 1.0


# ---------------------------------------------------------------------------
# テレインパターン
# ---------------------------------------------------------------------------


class TestTerrainPattern:
    """テレインパターンのテスト."""

    def test_electric_terrain_start(self, parser: BattleLogParser) -> None:
        events = parser.parse("エレクトリックフィールドに覆われた!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "terrain"
        assert ev.details["terrain"] == "electric"
        assert ev.details["action"] == "start"

    def test_electric_terrain_end(self, parser: BattleLogParser) -> None:
        events = parser.parse("エレクトリックフィールドが消えった!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.details["terrain"] == "electric"
        assert ev.details["action"] == "end"

    def test_grassy_terrain_start(self, parser: BattleLogParser) -> None:
        events = parser.parse("草原が広がった!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.details["terrain"] == "grassy"
        assert ev.details["action"] == "start"

    def test_grassy_terrain_end(self, parser: BattleLogParser) -> None:
        events = parser.parse("草原が消えった!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.details["terrain"] == "grassy"
        assert ev.details["action"] == "end"

    def test_psychic_terrain_start(self, parser: BattleLogParser) -> None:
        events = parser.parse("サイコフィールドに覆われた!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.details["terrain"] == "psychic"
        assert ev.details["action"] == "start"

    def test_misty_terrain_start(self, parser: BattleLogParser) -> None:
        events = parser.parse("ミストフィールドに覆われた!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.details["terrain"] == "misty"
        assert ev.details["action"] == "start"

    def test_misty_terrain_end(self, parser: BattleLogParser) -> None:
        events = parser.parse("ミストフィールドが消えった!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.details["terrain"] == "misty"
        assert ev.details["action"] == "end"

    def test_grassy_terrain_ocr_tsu(self, parser: BattleLogParser) -> None:
        """OCRブレ: 広がった→広がつた."""
        events = parser.parse("草原が広がつた!", "")
        assert len(events) == 1
        assert events[0].details["terrain"] == "grassy"


# ---------------------------------------------------------------------------
# 壁パターン
# ---------------------------------------------------------------------------


class TestScreenPattern:
    """壁パターンのテスト."""

    def test_reflect_set_player(self, parser: BattleLogParser) -> None:
        events = parser.parse("リフレクターの壁が", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "screen"
        assert ev.side == "player"
        assert ev.details["screen"] == "reflect"
        assert ev.details["action"] == "start"

    def test_reflect_set_opponent(self, parser: BattleLogParser) -> None:
        events = parser.parse("相手の リフレクターの壁が", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.side == "opponent"
        assert ev.details["screen"] == "reflect"

    def test_light_screen_set(self, parser: BattleLogParser) -> None:
        events = parser.parse("ひかりのかべが", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.details["screen"] == "light_screen"
        assert ev.details["action"] == "start"

    def test_aurora_veil_set(self, parser: BattleLogParser) -> None:
        events = parser.parse("オーロラベールに覆われた", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.details["screen"] == "aurora_veil"
        assert ev.details["action"] == "start"

    def test_reflect_end_player(self, parser: BattleLogParser) -> None:
        events = parser.parse("リフレクターが消えた!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "screen"
        assert ev.side == "player"
        assert ev.details["screen"] == "reflect"
        assert ev.details["action"] == "end"

    def test_reflect_end_opponent(self, parser: BattleLogParser) -> None:
        events = parser.parse("相手の リフレクターが消えた!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.side == "opponent"
        assert ev.details["screen"] == "reflect"
        assert ev.details["action"] == "end"

    def test_light_screen_end(self, parser: BattleLogParser) -> None:
        events = parser.parse("ひかりのかべが消えた!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.details["screen"] == "light_screen"
        assert ev.details["action"] == "end"

    def test_aurora_veil_end(self, parser: BattleLogParser) -> None:
        events = parser.parse("オーロラベールが消えた!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.details["screen"] == "aurora_veil"
        assert ev.details["action"] == "end"


# ---------------------------------------------------------------------------
# おいかぜパターン
# ---------------------------------------------------------------------------


class TestTailwindPattern:
    """おいかぜパターンのテスト."""

    def test_tailwind_start_player(self, parser: BattleLogParser) -> None:
        events = parser.parse("おいかぜが吹き始めた!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "tailwind"
        assert ev.side == "player"
        assert ev.details["action"] == "start"

    def test_tailwind_start_opponent(self, parser: BattleLogParser) -> None:
        events = parser.parse("相手の おいかぜが吹き始めた!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.side == "opponent"
        assert ev.details["action"] == "start"

    def test_tailwind_end_player(self, parser: BattleLogParser) -> None:
        events = parser.parse("おいかぜが止んだ!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "tailwind"
        assert ev.side == "player"
        assert ev.details["action"] == "end"

    def test_tailwind_end_opponent(self, parser: BattleLogParser) -> None:
        events = parser.parse("相手の おいかぜがやんだ!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.side == "opponent"
        assert ev.details["action"] == "end"


class TestOcrDriftTolerance:
    """OCR揺らぎ（大きい「つ」→小さい「っ」、ハイフン挿入等）の吸収テスト."""

    def test_sand_end_with_big_tsu(self, parser: BattleLogParser) -> None:
        events = parser.parse("砂あらしがおさまつた!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "weather"
        assert ev.details == {"weather": "sand", "action": "end"}

    def test_sun_end_with_big_tsu(self, parser: BattleLogParser) -> None:
        events = parser.parse("日差しが元に戻つた!", "")
        assert len(events) == 1
        assert events[0].event_type == "weather"
        assert events[0].details == {"weather": "sun", "action": "end"}

    def test_stat_change_with_big_tsu(self, parser: BattleLogParser) -> None:
        events = parser.parse("相手のリザードンの 攻撃が下がつた!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "stat_change"
        assert ev.side == "opponent"
        assert ev.pokemon_key == "charizard"
        assert ev.details == {"stat": "atk", "stages": -1}

    def test_stat_change_sharply_with_big_tsu(self, parser: BattleLogParser) -> None:
        events = parser.parse("ピカチュウの すばやさが がくつと下がつた!", "")
        assert len(events) == 1
        assert events[0].event_type == "stat_change"
        assert events[0].details == {"stat": "spe", "stages": -2}

    def test_opponent_sent_out_without_ri(self, parser: BattleLogParser) -> None:
        """「繰り出した」の「り」が抜けた OCR ぶれ."""
        parser.update_context(opponent_trainer="タロウ")
        events = parser.parse("タロウが リザードンを繰出した!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "opponent_sent_out"
        assert ev.pokemon_key == "charizard"

    def test_mega_evolution_with_hyphen(self, parser: BattleLogParser) -> None:
        """「メガ○○に-メガシンカした」のハイフン挿入OCRぶれ."""
        events = parser.parse("ゲンガーは メガゲンガーに-メガシンカした!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "mega_evolution"
        assert ev.pokemon_key == "gengar"
        assert ev.details["mega_name"] == "メガゲンガー"


class TestCriticalHitPattern:
    """急所パターンのテスト."""

    def test_critical_hit(self, parser: BattleLogParser) -> None:
        events = parser.parse("急所に当たった!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "critical_hit"
        assert ev.details == {"critical": True}

    def test_critical_hit_with_big_tsu(self, parser: BattleLogParser) -> None:
        events = parser.parse("急所に当たつた!", "")
        assert len(events) == 1
        assert events[0].event_type == "critical_hit"


class TestMultiHitPattern:
    """連続ヒットパターンのテスト."""

    def test_two_hits(self, parser: BattleLogParser) -> None:
        events = parser.parse("2回当たった!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "multi_hit"
        assert ev.details == {"hits": 2}

    def test_five_hits_with_big_tsu(self, parser: BattleLogParser) -> None:
        events = parser.parse("5回当たつた!", "")
        assert len(events) == 1
        assert events[0].details == {"hits": 5}


class TestItemTriggeredPattern:
    """持ち物発動メッセージパターンのテスト."""

    def test_focus_sash_holds_on(self, parser: BattleLogParser) -> None:
        events = parser.parse("相手のガブリアスは きあいのタスキでもちこたえた!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "item_triggered"
        assert ev.side == "opponent"
        assert ev.pokemon_key == "garchomp"
        assert ev.details["item_key"] == "focussash"
        assert ev.details["item_name"] == "きあいのタスキ"

    def test_quickclaw_triggers(self, parser: BattleLogParser) -> None:
        events = parser.parse(
            "相手のリザードンはせんせいのツメで 行動がはやくなった!", "",
        )
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "item_triggered"
        assert ev.side == "opponent"
        assert ev.details["item_key"] == "quickclaw"


class TestMegaStoneRevealedPattern:
    """メガストーン反応パターンのテスト（対戦開始時両サイド所持判明）."""

    def test_both_sides_revealed(self, parser: BattleLogParser) -> None:
        events = parser.parse(
            "ゲンガーのゲンガナイトと 相手のリザードンのリザードナイトXが反応した!", "",
        )
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "mega_stone_revealed"
        pairs = ev.details["pairs"]
        assert pairs["player"]["pokemon_key"] == "gengar"
        assert pairs["player"]["stone_key"] == "gengarite"
        assert pairs["opponent"]["pokemon_key"] == "charizard"
        assert pairs["opponent"]["stone_key"] == "charizarditex"


class TestWeatherDamagePattern:
    """天気被害パターンのテスト."""

    def test_sandstorm_hits_opponent(self, parser: BattleLogParser) -> None:
        events = parser.parse("砂あらしが 相手のリザードンを襲う!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "weather_damage"
        assert ev.side == "opponent"
        assert ev.pokemon_key == "charizard"
        assert ev.details == {"weather": "sand"}

    def test_sandstorm_hits_player(self, parser: BattleLogParser) -> None:
        events = parser.parse("砂あらしが ピカチュウを襲う!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.side == "player"
        assert ev.details == {"weather": "sand"}


class TestStatResetPattern:
    """ステータスリセットパターンのテスト."""

    def test_all_stats_reset(self, parser: BattleLogParser) -> None:
        events = parser.parse("全てのステータスが 元に戻った!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "stat_reset"
        assert ev.details == {"reset_type": "all_stats"}

    def test_all_stats_reset_with_big_tsu(self, parser: BattleLogParser) -> None:
        events = parser.parse("全てのステータスが 元に戻つた!", "")
        assert len(events) == 1
        assert events[0].event_type == "stat_reset"


class TestObservedLogVariants:
    """実ログで残っていた高価値テキストの回帰テスト."""

    def test_type_effectiveness_variant_super_effective(self, parser: BattleLogParser) -> None:
        events = parser.parse("効果はーバツグンだ!", "")
        assert len(events) == 1
        assert events[0].event_type == "type_effectiveness"
        assert events[0].details["effectiveness"] == "super_effective"

    def test_type_effectiveness_variant_immune(self, parser: BattleLogParser) -> None:
        events = parser.parse("ゲンガーには 効果がないようだ", "")
        assert len(events) == 1
        assert events[0].event_type == "type_effectiveness"
        assert events[0].details["effectiveness"] == "immune"

    def test_weather_variant_sandstorm_start(self, parser: BattleLogParser) -> None:
        events = parser.parse("砂あしが吹き始めた!", "")
        assert len(events) == 1
        assert events[0].event_type == "weather"
        assert events[0].details["weather"] == "sand"
        assert events[0].details["action"] == "start"

    def test_player_sent_out_variant(self, parser: BattleLogParser) -> None:
        events = parser.parse("ゆけう!ガブリアス!", "")
        assert len(events) == 1
        assert events[0].event_type == "player_sent_out"
        assert events[0].pokemon_key == "garchomp"

    def test_fainted_variant_with_noise(self, parser: BattleLogParser) -> None:
        events = parser.parse("ゲンガーは1たおれた!", "")
        assert len(events) == 1
        assert events[0].event_type == "pokemon_fainted"
        assert events[0].pokemon_key == "gengar"

    def test_drowsy_status_detected(self, parser: BattleLogParser) -> None:
        events = parser.parse("相手のリザードンの 眠気を誘つた!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "status_condition"
        assert ev.side == "opponent"
        assert ev.details["status"] == "drowsy"

    def test_confusion_detected(self, parser: BattleLogParser) -> None:
        events = parser.parse("ガブリアスは つかれ果てて混乱した!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "status_condition"
        assert ev.details["status"] == "confusion"
        assert ev.pokemon_key == "garchomp"

    def test_spikes_set_detected(self, parser: BattleLogParser) -> None:
        events = parser.parse("相手の足下に まきびしが散ばつた!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "hazard_set"
        assert ev.side == "opponent"
        assert ev.details["hazard_type"] == "spikes"

    def test_spikes_damage_detected(self, parser: BattleLogParser) -> None:
        events = parser.parse("相手のガブリアスは まきびしのダメージを受けた!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "hazard_damage"
        assert ev.side == "opponent"
        assert ev.details["hazard_type"] == "spikes"
        assert ev.pokemon_key == "garchomp"

    def test_substitute_broken_detected(self, parser: BattleLogParser) -> None:
        events = parser.parse("ゲンガーの 身代わりは 消えてしまつた", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "substitute"
        assert ev.details["phase"] == "broken"
        assert ev.pokemon_key == "gengar"

    def test_substitute_took_hit_detected(self, parser: BattleLogParser) -> None:
        events = parser.parse("ゲンガーにかわつて 身代わりが攻撃を受けた!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "substitute"
        assert ev.details["phase"] == "took_hit"
        assert ev.pokemon_key == "gengar"

    def test_burn_damage_detected(self, parser: BattleLogParser) -> None:
        events = parser.parse("ガブリアスは やけどのダメージを受けた!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "status_damage"
        assert ev.details["status"] == "burn"
        assert ev.pokemon_key == "garchomp"

    def test_ability_revealed_detected(self, parser: BattleLogParser) -> None:
        events = parser.parse("相手のリザードンは プレツシャーを放つている!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "ability_revealed"
        assert ev.side == "opponent"
        assert ev.details["ability_key"] == "pressure"

    def test_supreme_overlord_detected(self, parser: BattleLogParser) -> None:
        events = parser.parse("相手のガブリアスは 倒された仲間から力をもらつた!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "ability_revealed"
        assert ev.details["ability_key"] == "supremeoverlord"

    def test_mega_stone_reveal_with_ring_detected(self, parser: BattleLogParser) -> None:
        events = parser.parse("ゲンガーのゲンガナイトと Genのゼンブイリングが反応した!", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "mega_stone_revealed"
        assert ev.pokemon_key == "gengar"
        assert ev.details["stone_key"] == "gengarite"
        assert ev.details["ring_name"] == "ゼンブイリング"
