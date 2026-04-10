# コードレビュー進捗

最終更新: 2026-04-11

## 運用ルール

- ステータスは `Not Started` / `In Review` / `Blocked` / `Done` を使う。
- 着手時に担当と日付を入れる。
- 指摘を出したら Findings Log に ID を採番して残す。
- 修正確認まで終わったら `Done` にする。

## レビュー対象一覧

| ID | 領域 | 主な対象 | 観点 | 担当 | ステータス | 最終更新 | Finding 数 | メモ |
|---|---|---|---|---|---|---|---|---|
| R1 | API / サーバ初期化 | `backend/app/main.py`, `backend/app/dependencies.py`, `backend/app/api/` | ルーティング、DI、失敗系、初期化順 | 未設定 | Not Started | - | 0 | |
| R2 | 認識状態 / WebSocket | `backend/app/recognition/`, `backend/app/ws/battle.py`, `backend/config/regions.json` | 状態遷移、排他、pause 制御、設定整合 | 未設定 | Not Started | - | 0 | |
| R3 | ダメージ計算 | `backend/app/api/damage.py`, `backend/app/damage/`, `calc-service/src/`, `calc-service/tests/` | API 契約、型、計算根拠、異常系 | 未設定 | Not Started | - | 0 | |
| R4 | フロントエンド状態管理 / UI | `frontend/src/App.tsx`, `frontend/src/components/`, `frontend/src/hooks/`, `frontend/src/stores/`, `frontend/src/types.ts` | 非同期整合、ストア分割、表示回帰、型同期 | 未設定 | Not Started | - | 0 | |
| R5 | DevTools / データ / スクリプト | `frontend/src/components/devtools/`, `scripts/fetch_item_sprites.py`, `data/`, `templates/items/`, `docs/implementation/` | 開発用影響、生成物、再現性、不要ファイル混入 | 未設定 | Not Started | - | 0 | |

## セッションログ

| 日付 | 担当 | 対象 ID | 内容 | 結果 |
|---|---|---|---|---|
| 2026-04-11 | 未設定 | - | 進捗管理ドキュメント作成 | Open |

## Findings Log

| Finding ID | 日付 | 対象 ID | 重要度 | 状態 | 概要 | 対応 / 再確認メモ |
|---|---|---|---|---|---|---|
| F-001 | - | - | - | Open | ここにレビュー指摘を追記 | 修正コミット、確認者、再確認日を残す |

重要度の目安:

- `High`: リリース阻害。誤動作、データ破壊、重大な回帰、API 契約破綻。
- `Medium`: リリース前に直したい。仕様抜け、例外処理不足、競合の懸念、テスト不足。
- `Low`: 任意対応。可読性、将来保守、軽微な UX 改善。

状態の目安:

- `Open`: 未対応
- `Fixed`: 修正済み、未再確認
- `Verified`: 修正確認済み
- `Accepted`: リスクを理解して今回は許容

## 完了条件チェック

- [ ] R1 から R5 までステータスが更新されている
- [ ] Findings Log にレビュー結果が残っている
- [ ] `Fixed` の指摘に再確認結果が追記されている
- [ ] 残リスクまたは未確認事項が明記されている

## 残リスク / 保留事項

- なし
