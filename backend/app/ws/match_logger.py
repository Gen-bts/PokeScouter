"""1試合単位の JSONL ログを記録する.

試合開始（pre_match / team_select 突入）からバトル終了・リセット・切断まで
のすべての認識イベントを1ファイルに書き出す。
後から参照して最適化やバグ調査に使う。
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, TextIO

import cv2

if TYPE_CHECKING:
    import numpy as np

logger = logging.getLogger(__name__)


class BattleMatchLogger:
    """1試合 = 1 JSONL ファイルのロガー.

    使い方::

        ml = BattleMatchLogger(log_dir, session_id)
        ml.start_match(trigger_scene="pre_match")
        ml.log_scene_change({...})
        ml.log_ocr_result({...})
        ...
        ml.end_match(reason="battle_end", battle_result="win")
    """

    _MATCH_START_SCENES: frozenset[str] = frozenset({"pre_match", "team_select"})

    def __init__(self, log_dir: Path, session_id: str) -> None:
        self._log_dir = log_dir
        self._session_id = session_id
        self._match_seq = 0
        self._file: TextIO | None = None
        self._match_start_mono: float = 0.0
        self._match_start_dt: datetime | None = None
        self._frame_count: int = 0
        self._event_count: int = 0
        self._match_stem: str | None = None
        # 試合終了後の error_flag 追記用
        self._last_file_path: Path | None = None
        self._last_event_count: int = 0

    # ------------------------------------------------------------------
    # ライフサイクル
    # ------------------------------------------------------------------

    @property
    def is_active(self) -> bool:
        """試合ログが記録中かどうか."""
        return self._file is not None

    def start_match(self, *, trigger_scene: str) -> None:
        """新しい試合ログファイルを開きヘッダーを書き込む."""
        if self.is_active:
            self.end_match(reason="new_match_started")

        self._match_seq += 1
        self._match_start_mono = time.monotonic()
        self._match_start_dt = datetime.now(timezone.utc)
        self._frame_count = 0
        self._event_count = 0

        try:
            self._log_dir.mkdir(parents=True, exist_ok=True)
            filename = (
                f"{self._match_start_dt.strftime('%Y%m%d_%H%M%S')}"
                f"_{self._session_id[:4]}"
                f"_{self._match_seq:03d}.jsonl"
            )
            self._match_stem = filename.removesuffix(".jsonl")
            self._file = open(  # noqa: SIM115
                self._log_dir / filename, "w", encoding="utf-8",
            )
        except OSError:
            logger.warning("試合ログファイルの作成に失敗", exc_info=True)
            self._file = None
            return

        self._write_event("match_start", {
            "session_id": self._session_id,
            "match_seq": self._match_seq,
            "trigger_scene": trigger_scene,
        })
        logger.info(
            "試合ログ開始: %s (match_seq=%d)",
            self._file.name if self._file else "?",
            self._match_seq,
        )

    def end_match(
        self,
        *,
        reason: str,
        battle_result: str | None = None,
    ) -> None:
        """フッターを書き込みファイルを閉じる."""
        if not self.is_active:
            return

        duration_ms = (time.monotonic() - self._match_start_mono) * 1000
        self._write_event("match_end", {
            "reason": reason,
            "battle_result": battle_result,
            "duration_ms": round(duration_ms, 1),
            "frame_count": self._frame_count,
            "event_count": self._event_count + 1,  # match_end 自身を含む
        })

        file_name = self._file.name if self._file else "?"
        # 試合終了後の error_flag 追記用にパスとカウンタを保存
        if self._file is not None:
            self._last_file_path = Path(self._file.name)
            self._last_event_count = self._event_count
        try:
            if self._file is not None:
                self._file.close()
        except OSError:
            logger.warning("試合ログファイルのクローズに失敗", exc_info=True)
        finally:
            self._file = None
            self._match_stem = None

        logger.info(
            "試合ログ終了: %s reason=%s result=%s duration=%.1fs frames=%d",
            file_name, reason, battle_result,
            duration_ms / 1000, self._frame_count,
        )

    # ------------------------------------------------------------------
    # イベント記録（非アクティブ時は no-op）
    # ------------------------------------------------------------------

    def log_scene_change(self, scene_change: dict) -> int | None:
        """シーン遷移を記録."""
        return self._write_event("scene_change", {
            "scene": scene_change.get("scene"),
            "top_level": scene_change.get("top_level"),
            "sub_scene": scene_change.get("sub_scene"),
            "confidence": scene_change.get("confidence"),
            "interval_ms": scene_change.get("interval_ms"),
        })

    def log_ocr_result(self, ocr_result: dict) -> int | None:
        """OCR 結果を記録（crop_b64 は除去）."""
        regions = []
        for r in ocr_result.get("regions", []):
            entry = {k: v for k, v in r.items() if k != "crop_b64"}
            regions.append(entry)

        seq = self._write_event("ocr_result", {
            "scene": ocr_result.get("scene"),
            "elapsed_ms": ocr_result.get("elapsed_ms"),
            "resolution": ocr_result.get("resolution"),
            "regions": regions,
        })
        self._frame_count += 1
        return seq

    def log_pokemon_identified(
        self,
        pokemon_result: dict,
        failed_crops: list[tuple[str, np.ndarray]] | None = None,
    ) -> int | None:
        """ポケモン画像認識結果を記録.

        failed_crops が渡された場合、クロップ画像を試合サブディレクトリに保存し
        JSONL エントリに crop_images フィールドを追加する。
        """
        data: dict = {
            "pokemon": pokemon_result.get("pokemon"),
            "elapsed_ms": pokemon_result.get("elapsed_ms"),
        }
        if failed_crops:
            next_seq = self._event_count
            crop_files = []
            for tag, image in failed_crops:
                fname = self._save_crop(next_seq, f"pokemon_{tag}", image)
                if fname:
                    crop_files.append(fname)
            if crop_files:
                data["crop_images"] = crop_files
        return self._write_event("pokemon_identified", data)

    def log_match_teams(
        self,
        player_team: list[dict],
        opponent_team: list[dict],
    ) -> int | None:
        """味方・相手チーム情報を記録."""
        return self._write_event("match_teams", {
            "player_team": player_team,
            "opponent_team": opponent_team,
        })

    def log_team_selection(self, selected_positions: list[int]) -> int | None:
        """選出ポケモンを記録."""
        return self._write_event("team_selection", {
            "selected_positions": selected_positions,
        })

    def log_team_selection_order(self, selection_order: dict[int, int]) -> int | None:
        """選出順序の変更を記録."""
        return self._write_event("team_selection_order", {
            "selection_order": {str(k): v for k, v in selection_order.items()},
        })

    def log_battle_event(
        self,
        battle_event_msg: dict,
        crop_image: np.ndarray | None = None,
    ) -> int | None:
        """バトルイベント（技使用・ひんし等）を記録.

        event_type が "unrecognized" の場合はイベント種別を
        "unrecognized_text" に変更し、ログファイル上で判別可能にする。
        crop_image が渡された場合（unrecognized のみ）、クロップ画像を保存し紐づける。
        """
        data = {k: v for k, v in battle_event_msg.items() if k != "type"}
        event_name = (
            "unrecognized_text"
            if battle_event_msg.get("event_type") == "unrecognized"
            else "battle_event"
        )
        if event_name == "unrecognized_text" and crop_image is not None:
            next_seq = self._event_count
            fname = self._save_crop(next_seq, "unrecognized_text", crop_image)
            if fname:
                data["crop_image"] = fname
        return self._write_event(event_name, data)

    def log_opponent_active(self, opponent_active: dict) -> int | None:
        """相手アクティブポケモン情報を記録."""
        return self._write_event("opponent_active", opponent_active)

    def log_player_active(self, player_active: dict) -> int | None:
        """自分アクティブポケモン情報を記録."""
        return self._write_event("player_active", player_active)

    def log_item_ability(self, detection: dict) -> int | None:
        """相手もちもの・特性検出を記録."""
        return self._write_event("item_ability", {
            k: v for k, v in detection.items() if k != "type"
        })

    def log_battle_result(self, result: str) -> int | None:
        """勝敗結果を記録."""
        return self._write_event("battle_result", {"result": result})

    def log_pokemon_correction(self, correction: dict) -> int | None:
        """手動ポケモン修正を記録."""
        return self._write_event("pokemon_correction", {
            "position": correction.get("position"),
            "original_pokemon_key": correction.get("original_pokemon_key"),
            "original_name": correction.get("original_name"),
            "original_confidence": correction.get("original_confidence"),
            "corrected_pokemon_key": correction.get("corrected_pokemon_key"),
            "corrected_name": correction.get("corrected_name"),
        })

    # ------------------------------------------------------------------
    # エラーフラグ
    # ------------------------------------------------------------------

    def log_error_flag(
        self,
        target_seq: int | None,
        entry_kind: str,
        *,
        flagged: bool = True,
    ) -> int | None:
        """誤検出フラグを記録する.

        試合中はアクティブファイルに書き込み、
        試合終了後は直前のファイルを append モードで再開して追記する。
        """
        data = {
            "target_seq": target_seq,
            "entry_kind": entry_kind,
            "flagged": flagged,
        }
        # アクティブなログがある場合はそのまま書き込み
        if self.is_active:
            return self._write_event("error_flag", data)

        # 試合終了後: 直前のファイルに追記
        if self._last_file_path is None:
            return None
        try:
            with open(self._last_file_path, "a", encoding="utf-8") as f:
                now = datetime.now(timezone.utc)
                seq = self._last_event_count
                record = {
                    "ts": now.isoformat(),
                    "rel_ms": None,
                    "seq": seq,
                    "event": "error_flag",
                    **data,
                }
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
                self._last_event_count += 1
                return seq
        except OSError:
            logger.warning("error_flag 追記失敗", exc_info=True)
            return None

    # ------------------------------------------------------------------
    # マッチ開始判定ヘルパー
    # ------------------------------------------------------------------

    def maybe_start_match(self, scene_key: str) -> None:
        """シーン遷移時に必要なら試合ログを自動開始する."""
        if scene_key in self._MATCH_START_SCENES and not self.is_active:
            self.start_match(trigger_scene=scene_key)

    # ------------------------------------------------------------------
    # 内部
    # ------------------------------------------------------------------

    def _save_crop(
        self, seq: int, tag: str, image: np.ndarray,
    ) -> str | None:
        """クロップ画像を試合ログ用サブディレクトリに保存する.

        Returns:
            保存に成功したファイル名、失敗時は None。
        """
        if self._match_stem is None:
            return None
        try:
            crop_dir = self._log_dir / self._match_stem
            crop_dir.mkdir(parents=True, exist_ok=True)
            filename = f"seq{seq:04d}_{tag}.png"
            cv2.imwrite(str(crop_dir / filename), image)
            return filename
        except Exception:
            logger.warning(
                "クロップ画像保存失敗 (seq=%d, tag=%s)", seq, tag, exc_info=True,
            )
            return None

    def _write_event(self, event_type: str, data: dict) -> int | None:
        """共通エンベロープ付きで1行 JSON を書き出す.

        Returns:
            割り当てた seq 番号。書き込み失敗時は None。
        """
        if self._file is None:
            return None
        try:
            now = datetime.now(timezone.utc)
            rel_ms = (time.monotonic() - self._match_start_mono) * 1000
            seq = self._event_count
            record = {
                "ts": now.isoformat(),
                "rel_ms": round(rel_ms, 1),
                "seq": seq,
                "event": event_type,
                **data,
            }
            self._file.write(json.dumps(record, ensure_ascii=False) + "\n")
            self._file.flush()
            self._event_count += 1
            return seq
        except OSError:
            logger.warning("試合ログ書き込み失敗 (event=%s)", event_type, exc_info=True)
            try:
                if self._file is not None:
                    self._file.close()
            except OSError:
                pass
            self._file = None
            return None
