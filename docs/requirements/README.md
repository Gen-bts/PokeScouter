# PokeScouter 要件定義書

**バージョン:** 1.0
**作成日:** 2026年4月7日
**対象ゲーム:** Pokémon Champions（Nintendo Switch / スマートフォン）
**開発環境GPU:** NVIDIA RTX 5070（VRAM 12GB）

---

## 目次

| # | ドキュメント | 内容 |
|---|---|---|
| 1 | [概要・スコープ](./01-overview-and-scope.md) | プロジェクト概要、先行事例、Champions考慮事項、フェーズ定義 |
| 2 | [機能要件](./02-functional-requirements.md) | FR-001〜FR-007（映像入力、場面識別、ポケモン認識、HP読み取り、ダメージ計算、パーティ登録、データベース） |
| 3 | [非機能要件](./03-non-functional-requirements.md) | パフォーマンス目標、ユーザビリティ、拡張性、信頼性 |
| 4 | [プラットフォーム・API](./04-platform-and-api.md) | アーキテクチャ図、映像フロー、API設計 |
| 5 | [OCR構成](./05-ocr-architecture.md) | 3エンジン同時起動、VRAM配分、処理フロー、抽象化設計 |
| 6 | [データ設計](./06-data-design.md) | 3層アーキテクチャ、ディレクトリ構造、パッチ方式 |
| 7 | [リスク・ロードマップ](./07-risks-and-roadmap.md) | リスク・課題、開発マイルストーン（M0〜M6）、未決定事項 |
| 8 | [付録](./08-appendix.md) | 技術スタック、参考リンク、OCR候補一覧 |

## ドキュメント間の主な参照関係

- 機能要件 FR-007（データベース）→ [データ設計](./06-data-design.md) で詳細定義
- 非機能要件のパフォーマンス目標 → [OCR構成](./05-ocr-architecture.md) の速度・VRAM見積もりと対応
- リスク・未決定事項のM0項目 → [OCR構成](./05-ocr-architecture.md) のテスト計画と対応
