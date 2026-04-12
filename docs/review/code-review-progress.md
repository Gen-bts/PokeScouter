# コードレビュー進捗

最終更新: 2026-04-11

## 対象

この進捗シートは、PokeScouter アプリ全体のコードレビューを管理する。

対象ディレクトリ:

- `backend/app/`
- `backend/tests/`
- `calc-service/src/`
- `calc-service/tests/`
- `frontend/src/`
- `scripts/`

## 運用ルール

- ステータスは `Not Started` / `In Review` / `Blocked` / `Done` を使う。
- 着手したら担当と最終更新日を入れる。
- 指摘は Findings Log に追記し、対象 ID と結びつける。
- 修正確認が必要なものは `Fixed` のまま残し、再確認後に `Verified` にする。

## レビュー対象一覧

| ID | 領域 | 主な対象 | 観点 | 担当 | ステータス | 最終更新 | Finding 数 | メモ |
|---|---|---|---|---|---|---|---|---|
| R1 | バックエンド API / 起動構成 | `backend/app/main.py`, `backend/app/dependencies.py`, `backend/app/api/` | ルーティング、DI、起動順、例外処理 | Codex | Done | 2026-04-11 | 1 | F-001 |
| R2 | OCR / 認識 / 対戦状態管理 | `backend/app/ocr/`, `backend/app/recognition/`, `backend/app/ws/`, `backend/config/` | 状態遷移、排他、WebSocket、設定整合 | Codex | Done | 2026-04-11 | 1 | F-002 |
| R3 | データアクセス / 検索 / 補助ロジック | `backend/app/data/`, `pokemon_matcher.py`, `stat_modifier.py`, 関連テスト | 検索品質、変換ロジック、データ整合 | Codex | Done | 2026-04-11 | 0 | 重大な指摘なし（一次レビュー） |
| R4 | ダメージ計算サービス連携 | `backend/app/damage/`, `backend/app/api/damage.py`, `calc-service/src/`, `calc-service/tests/` | API 契約、型、異常系、計算前提 | Codex | Done | 2026-04-11 | 0 | 重大な指摘なし（一次レビュー） |
| R5 | フロントエンド画面 / 状態管理 / hooks | `frontend/src/App.tsx`, `frontend/src/components/`, `frontend/src/hooks/`, `frontend/src/stores/`, `frontend/src/types.ts` | 非同期整合、ストア責務、型同期、表示回帰 | Codex | Done | 2026-04-11 | 2 | F-003, F-004 |
| R6 | DevTools / ベンチマーク / 開発補助 | `frontend/src/components/devtools/`, ベンチマーク系ストアと表示 | 本番影響、責務分離、データ整合 | Codex | Done | 2026-04-11 | 1 | F-004 |
| R7 | スクリプト / 補助データ / 運用性 | `scripts/`, `data/`, `templates/`, `docs/implementation/`, `README.md` | 再現性、運用性、ドキュメント整合 | Codex | Done | 2026-04-11 | 0 | 重大な指摘なし（一次レビュー） |

## セッションログ

| 日付 | 担当 | 対象 ID | 内容 | 結果 |
|---|---|---|---|---|
| 2026-04-11 | 未設定 | - | 全コード対象のレビュー計画へ更新 | Open |
| 2026-04-11 | Codex | R1-R7 | 一次レビューを実施し Findings を記録 | Open |

## Findings Log

| Finding ID | 日付 | 対象 ID | 重要度 | 状態 | 概要 | 対応 / 再確認メモ |
|---|---|---|---|---|---|---|
| F-001 | 2026-04-11 | R1 | High | Open | ファイル保存 API が read-modify-write 前提で排他なしのため、並行更新で `parties.json` / `regions.json` / 録画メタデータの更新が消える | [parties.py](/d:/Code/personal/PokeScouter/backend/app/api/parties.py#L20) の `_read_parties()` / `_write_parties()` と [devtools.py](/d:/Code/personal/PokeScouter/backend/app/api/devtools.py#L58) の `_read_metadata()` / `_write_metadata()`、[devtools.py](/d:/Code/personal/PokeScouter/backend/app/api/devtools.py#L230) の `_read_regions()` / `_write_regions()` が全て無ロック。`POST/PUT/DELETE` の同時実行で更新消失やフレーム番号競合が起きる。 |
| F-002 | 2026-04-11 | R2 | Medium | Open | シーンリセット後も `BattleLogParser` の相手パーティ文脈が残り、次試合で古い相手情報を使って照合する | [battle_log_parser.py](/d:/Code/personal/PokeScouter/backend/app/recognition/battle_log_parser.py#L321) の `reset()` は `_context` を消していない一方、[battle.py](/d:/Code/personal/PokeScouter/backend/app/ws/battle.py#L789) は相手パーティが空のとき `None` を渡して更新をスキップする。`reset` / `force_scene` 後や team_select 未経由復帰で古い `opponent_party` が残る。 |
| F-003 | 2026-04-11 | R5 | Medium | Open | ダメージ計算フックが選択中ポケモンの内容更新に追随せず、相手が消えても古い結果を表示し続ける | [useDamageCalc.ts](/d:/Code/personal/PokeScouter/frontend/src/hooks/useDamageCalc.ts#L87) の effect 依存配列が `attackerPos`, `defenderKey`, `attackerValid` だけなので、同じスロット内で `fields` / `move_ids` / `ability_id` が更新されても再計算されない。さらに [useDamageCalc.ts](/d:/Code/personal/PokeScouter/frontend/src/hooks/useDamageCalc.ts#L93) で early return するだけなので、防御側が空になっても既存 `results` が残る。 |
| F-004 | 2026-04-11 | R5,R6 | High | Open | フロントエンドが TypeScript ビルド不能で、現状の `npm run build` が失敗する | `frontend` で `npm run build` 実行時に [FrameViewer.tsx](/d:/Code/personal/PokeScouter/frontend/src/components/devtools/FrameViewer.tsx#L59), [OfflineBenchmark.tsx](/d:/Code/personal/PokeScouter/frontend/src/components/devtools/OfflineBenchmark.tsx#L34), [useOpponentTeamStore.ts](/d:/Code/personal/PokeScouter/frontend/src/stores/useOpponentTeamStore.ts#L132), [TypeIcon.tsx](/d:/Code/personal/PokeScouter/frontend/src/components/TypeIcon.tsx#L1) などで strict type error と SVG module 解決エラーが発生する。出荷用ビルドを通せない。 |

重要度の目安:

- `High`: リリース阻害。誤動作、契約破綻、重大な回帰。
- `Medium`: リリース前に直したい。例外処理不足、境界条件漏れ、競合懸念、テスト不足。
- `Low`: 余力対応。保守性や可読性の改善。

状態の目安:

- `Open`: 未対応
- `Fixed`: 修正済み、未再確認
- `Verified`: 修正確認済み
- `Accepted`: リスクを理解して今回は許容

## 完了条件チェック

- [x] R1 から R7 までレビュー結果が記録されている
- [x] Findings Log に指摘が残っている、または「重大な指摘なし」と判断できる記録がある
- [ ] `Fixed` の項目に再確認結果が追記されている
- [x] 残リスクまたは未確認事項が明記されている

## 残リスク / 保留事項

- F-001 から F-004 は未修正。特に F-004 はフロントエンドの出荷ビルドを阻害する。
- R3 / R4 / R7 は一次レビューで重大な指摘なし。ただし実機画面や本番データでの運用確認までは未実施。
