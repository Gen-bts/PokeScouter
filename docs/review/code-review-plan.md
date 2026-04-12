# コードレビュー計画

最終更新: 2026-04-11

## 目的

- PokeScouter アプリ全体のコードを対象に、重大な不具合、設計上のリスク、回帰要因を洗い出す。
- レビュー対象を明確に区切り、抜け漏れなく進捗管理できる状態にする。
- 指摘事項と再確認事項をドキュメントに残し、後続の修正と再レビューにつなげる。

## 対象範囲

今回のレビュー対象は、リポジトリ内のアプリ実装全体とする。

- `backend/app/`
- `backend/tests/`
- `calc-service/src/`
- `calc-service/tests/`
- `frontend/src/`
- `scripts/`

補助的に確認するもの:

- `backend/config/`
- `data/`
- `templates/`
- `docs/implementation/`
- `README.md`

対象外:

- 仮想環境やビルド成果物
- 画像アセット自体の内容レビュー
- レビュー目的と無関係な文章校正

## レビュー方針

全体レビューでは、以下の順に優先度を置く。

1. ユーザー影響が大きい不具合
2. API 契約やデータ契約の破綻
3. 状態管理や非同期処理の競合
4. テスト不足による将来の回帰リスク
5. 保守性の低下につながる構造的な問題

見た目や好みの差ではなく、次の観点を優先して指摘する。

- バグ
- 仕様逸脱
- 回帰リスク
- 境界条件の漏れ
- 例外処理不足
- テスト不足
- データ整合性の問題

## レビュー単位

### R1. バックエンド API / 起動構成

対象:

- `backend/app/main.py`
- `backend/app/dependencies.py`
- `backend/app/api/`

観点:

- FastAPI ルーティングと依存性注入の構成が正しいか
- 起動時初期化とシャットダウン処理が安全か
- REST API の入出力、エラー処理、境界条件が揃っているか

完了条件:

- 各 API の責務と依存関係を確認済み
- 主要 API の失敗系を記録済み

### R2. OCR / 認識 / 対戦状態管理

対象:

- `backend/app/ocr/`
- `backend/app/recognition/`
- `backend/app/ws/`
- `backend/config/`
- `backend/tests/test_scene_state.py`
- `backend/tests/test_battle_log_parser.py`
- `backend/tests/test_party_register.py`

観点:

- OCR パイプラインと認識ロジックの責務分離が適切か
- 状態遷移、対戦ログ解釈、パーティ管理に破綻がないか
- WebSocket のフレーム処理や排他制御に競合がないか

完了条件:

- 主要な状態遷移パスを確認済み
- 競合や欠落があれば Findings Log に記録済み

### R3. データアクセス / 検索 / 補助ロジック

対象:

- `backend/app/data/`
- `backend/app/recognition/pokemon_matcher.py`
- `backend/app/recognition/stat_modifier.py`
- `backend/tests/test_game_data_fuzzy.py`
- `backend/tests/test_stat_modifier.py`
- `backend/tests/test_type_consistency.py`

観点:

- ベースデータ参照と検索ロジックが一貫しているか
- 曖昧検索や変換処理に危険な前提がないか
- テストが仕様の実態に追随しているか

完了条件:

- データ参照経路と検索仕様を確認済み
- 補助ロジックのテスト範囲を把握済み

### R4. ダメージ計算サービス連携

対象:

- `backend/app/damage/`
- `backend/app/api/damage.py`
- `calc-service/src/`
- `calc-service/tests/`

観点:

- バックエンドと計算サービスの API 契約が一致しているか
- 型、フィールド名、計算前提、異常系の扱いが揃っているか
- 計算ロジックに明白な取りこぼしがないか

完了条件:

- リクエストとレスポンスの往復仕様を確認済み
- 代表的なテストカバレッジを把握済み

### R5. フロントエンド画面 / 状態管理 / hooks

対象:

- `frontend/src/App.tsx`
- `frontend/src/components/`
- `frontend/src/hooks/`
- `frontend/src/stores/`
- `frontend/src/types.ts`
- `frontend/src/utils/`

観点:

- Zustand ストア間の責務分離が崩れていないか
- 非同期処理と画面表示が整合しているか
- 型定義と API 契約がずれていないか
- UI 追加が既存フローを壊していないか

完了条件:

- 主要画面のデータフローを確認済み
- 状態更新の起点と反映先を追跡済み

### R6. DevTools / ベンチマーク / 開発用補助機能

対象:

- `frontend/src/components/devtools/`
- `frontend/src/stores/useBenchmarkStore.ts`
- `frontend/src/stores/useFullMatchStore.ts`
- `frontend/src/stores/useMatchLogStore.ts`
- `frontend/src/components/BenchmarkReport.tsx`

観点:

- 開発用機能が本番系ロジックに不要な影響を与えていないか
- ベンチマークや記録機能のデータ整合性が保たれているか
- 大きいコンポーネントに責務過多がないか

完了条件:

- DevTools 系の主なデータフローを確認済み
- 本番コードとの結合リスクを記録済み

### R7. スクリプト / 補助データ / 運用性

対象:

- `scripts/`
- `data/`
- `templates/`
- `docs/implementation/`
- `README.md`

観点:

- スクリプトの再実行性と前提条件が妥当か
- データ更新手順が再現可能か
- ドキュメントが実装実態と大きくずれていないか

完了条件:

- 主要スクリプトの役割と前提条件を確認済み
- データ由来や運用上の注意点を整理済み

## 進め方

1. `docs/review/code-review-progress.md` の対象 ID を `In Review` にして着手する。
2. 指摘は Findings Log に `F-xxx` 形式で追記する。
3. 指摘ごとに重要度、対象、対応方針、再確認要否を残す。
4. レビュー完了後に `Done` へ更新し、残リスクをまとめる。

## 判定ルール

`Done` にしてよい条件:

- 対象コードを一通り確認済み
- 指摘事項または「問題なし」の結果を残している
- 未確認事項があれば明示している

`Done` にしない条件:

- 対象を読んだだけで結果を残していない
- 一部しか見ていないのに完了扱いにしている
- 指摘の再確認条件が曖昧

## 期待アウトプット

- 領域別のレビュー進捗
- 指摘一覧と重要度
- 修正後に再確認が必要な項目
- 最終的に残るリスク
