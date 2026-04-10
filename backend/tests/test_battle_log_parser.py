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
        },
        "moves": {},
        "abilities": {},
        "items": {},
    }
    (names_dir / "ja.json").write_text(
        json.dumps(ja_names, ensure_ascii=False), encoding="utf-8",
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
        assert len(events) == 0

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
        """既知のトレーナー名と大きく異なる場合は誤検出として棄却."""
        parser.update_context(opponent_trainer="タロウ")
        events = parser.parse("効果はが", "ばつぐんだ を 繰り出した！")
        assert len(events) == 0

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
