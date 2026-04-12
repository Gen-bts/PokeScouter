"""BattleLogParser のテスト."""

from __future__ import annotations

import time

import pytest

from app.data.game_data import GameData
from app.recognition.battle_log_parser import BattleLogParser


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

    for fname in ["pokemon.json", "moves.json", "abilities.json",
                  "types.json", "items.json", "natures.json"]:
        (base / fname).write_text("{}", encoding="utf-8")
    for fname in ["pokemon_patch.json", "moves_patch.json",
                  "new_entries.json", "learnsets.json"]:
        (override / fname).write_text("{}", encoding="utf-8")
    (seasons / "current.json").write_text('{"current_season": ""}', encoding="utf-8")

    ja_names = {
        "_meta": {"source": "test", "language": "ja"},
        "pokemon": {
            "リザードン": 6,
            "ガブリアス": 445,
            "ピカチュウ": 25,
            "カイリュー": 149,
            "ミミッキュ": 778,
            "キラフロル": 970,
        },
        "moves": {
            "かえんほうしゃ": 53,
            "じしん": 89,
            "10まんボルト": 85,
            "りゅうせいぐん": 434,
            "キラースピン": 188,
            "ほのおのパンチ": 7,
            "シャドークロー": 421,
        },
        "abilities": {},
        "items": {},
    }
    (names_dir / "ja.json").write_text(
        json.dumps(ja_names, ensure_ascii=False), encoding="utf-8",
    )

    # learnsets
    learnsets = {
        "6": {"default": [53, 89, 7]},
        "445": {"default": [89, 434]},
        "25": {"default": [85]},
        "970": {"default": [188]},
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
        assert ev.species_id == 6

    def test_player_fainted(self, parser: BattleLogParser) -> None:
        events = parser.parse("リザードン は たおれた！", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "pokemon_fainted"
        assert ev.side == "player"
        assert ev.pokemon_name == "リザードン"
        assert ev.species_id == 6

    def test_fainted_across_two_lines(self, parser: BattleLogParser) -> None:
        events = parser.parse("相手の ガブリアス は", "たおれた！")
        assert len(events) == 1
        ev = events[0]
        assert ev.side == "opponent"
        assert ev.pokemon_name == "ガブリアス"
        assert ev.species_id == 445

    def test_fuzzy_match_ocr_error(self, parser: BattleLogParser) -> None:
        # "リザードソ" は "リザードン" の1文字違い
        events = parser.parse("相手の リザードソ は たおれた！", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.pokemon_name == "リザードン"
        assert ev.species_id == 6

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
        assert ev.species_id == 6
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
        assert ev.species_id == 6

    def test_opponent_sent_out_fuzzy_pokemon(self, parser: BattleLogParser) -> None:
        parser.update_context(opponent_trainer="タロウ")
        # OCRブレ: "ピカチユウ" → "ピカチュウ"
        events = parser.parse("タロウが", "ピカチユウ を 繰り出した！")
        assert len(events) == 1
        ev = events[0]
        assert ev.pokemon_name == "ピカチュウ"
        assert ev.species_id == 25

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
        assert ev.species_id == 25

    def test_player_sent_out_ocr_error_ga(self, parser: BattleLogParser) -> None:
        """OCRエラー: っ→っが, ！→つ."""
        events = parser.parse("ゆけっがつピカチュウ", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.event_type == "player_sent_out"
        assert ev.pokemon_name == "ピカチュウ"
        assert ev.species_id == 25

    def test_player_sent_out_halfwidth_excl(self, parser: BattleLogParser) -> None:
        """半角!でも検出される."""
        events = parser.parse("ゆけっ!リザードン", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.pokemon_name == "リザードン"
        assert ev.species_id == 6

    def test_player_sent_out_with_space(self, parser: BattleLogParser) -> None:
        """ポケモン名の前にスペース."""
        events = parser.parse("ゆけっ！ ガブリアス", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.pokemon_name == "ガブリアス"
        assert ev.species_id == 445

    def test_player_sent_out_across_two_lines(self, parser: BattleLogParser) -> None:
        """2行にまたがるケース."""
        events = parser.parse("ゆけっ！", "ピカチュウ")
        assert len(events) == 1
        ev = events[0]
        assert ev.pokemon_name == "ピカチュウ"
        assert ev.species_id == 25

    def test_player_sent_out_tsu_normalization(self, parser: BattleLogParser) -> None:
        """っ が つ に読み替えられるケース."""
        events = parser.parse("ゆけつ！ピカチュウ", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.species_id == 25

    def test_player_sent_out_party_matching(self, parser: BattleLogParser) -> None:
        """プレイヤーパーティ限定マッチング."""
        parser.update_context(player_party=[
            {"species_id": 25, "name": "ピカチュウ"},
            {"species_id": 6, "name": "リザードン"},
        ])
        # OCRブレ: "ピカチユウ" → "ピカチュウ"
        events = parser.parse("ゆけっ！ピカチユウ", "")
        assert len(events) == 1
        ev = events[0]
        assert ev.pokemon_name == "ピカチュウ"
        assert ev.species_id == 25

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
        assert msg["species_id"] == 6


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
        assert ev.species_id == 6
        assert ev.details["stat"] == "atk"
        assert ev.details["stages"] == 2

    def test_opponent_speed_up_1(self, parser: BattleLogParser) -> None:
        """相手の すばやさが 上がった（+1段階）."""
        events = parser.parse("相手の ガブリアス の", "すばやさが 上がった！")
        assert len(events) == 1
        ev = events[0]
        assert ev.details["stat"] == "spe"
        assert ev.details["stages"] == 1
        assert ev.species_id == 445

    def test_opponent_defense_down_1(self, parser: BattleLogParser) -> None:
        """相手の ぼうぎょが 下がった（-1段階）."""
        events = parser.parse("相手の ピカチュウ の", "ぼうぎょが 下がった！")
        assert len(events) == 1
        ev = events[0]
        assert ev.details["stat"] == "def"
        assert ev.details["stages"] == -1
        assert ev.species_id == 25

    def test_opponent_spdef_down_2(self, parser: BattleLogParser) -> None:
        """相手の とくぼうが がくっと 下がった（-2段階）."""
        events = parser.parse("相手の ミミッキュ の", "とくぼうが がくっと 下がった！")
        assert len(events) == 1
        ev = events[0]
        assert ev.details["stat"] == "spd"
        assert ev.details["stages"] == -2
        assert ev.species_id == 778

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
        assert ev.species_id == 6

    def test_party_limited_matching(self, parser: BattleLogParser) -> None:
        """パーティ限定マッチングが使用される."""
        parser.update_context(opponent_party=[
            {"species_id": 6, "name": "リザードン"},
            {"species_id": 445, "name": "ガブリアス"},
        ])
        events = parser.parse("相手の リザードン の", "とくこうが ぐーんと 上がった！")
        assert len(events) == 1
        ev = events[0]
        assert ev.species_id == 6
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
        assert ev.species_id == 970
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
        assert ev.species_id == 25
        assert ev.move_name == "10まんボルト"
        assert ev.move_id == 85

    def test_move_with_no_in_name(self, parser: BattleLogParser) -> None:
        """「の」を含む技名（ほのおのパンチ）が正しく解析される."""
        events = parser.parse("相手のリザードンの", "ほのおのパンチ!")
        assert len(events) == 1
        ev = events[0]
        assert ev.pokemon_name == "リザードン"
        assert ev.species_id == 6
        assert ev.move_name == "ほのおのパンチ"
        assert ev.move_id == 7

    def test_fuzzy_pokemon_name(self, parser: BattleLogParser) -> None:
        """OCRブレでもポケモン名がfuzzy matchされる."""
        events = parser.parse("相手のリザードソの", "かえんほうしゃ!")
        assert len(events) == 1
        ev = events[0]
        assert ev.pokemon_name == "リザードン"
        assert ev.species_id == 6

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
            {"species_id": 970, "name": "キラフロル"},
            {"species_id": 445, "name": "ガブリアス"},
        ])
        events = parser.parse("相手のキラフロルの", "キラースピン!")
        assert len(events) == 1
        ev = events[0]
        assert ev.species_id == 970

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

    def test_yawn_aftermath_not_move_used(self, parser: BattleLogParser) -> None:
        """あくびのあと等「眠気を誘った」叙述はわざとして扱わない（未認識イベント）."""
        events = parser.parse("相手のリザードンの 眠気を　誘つた!", "")
        assert len(events) == 1
        assert events[0].event_type == "unrecognized"

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

    def test_ws_message_includes_move(self, parser: BattleLogParser) -> None:
        """WebSocketメッセージにmove_name/move_idが含まれる."""
        events = parser.parse("相手のリザードンの", "かえんほうしゃ!")
        msg = events[0].to_ws_message()
        assert msg["type"] == "battle_event"
        assert msg["event_type"] == "move_used"
        assert msg["move_name"] == "かえんほうしゃ"
        assert msg["move_id"] == 53
        assert msg["pokemon_name"] == "リザードン"
        assert msg["species_id"] == 6


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
        assert msg["species_id"] == 149
        assert msg["move_name"] is None
        assert msg["move_id"] is None
        assert isinstance(msg["details"], dict)
