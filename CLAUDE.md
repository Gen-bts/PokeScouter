# CLAUDE.md

このプロジェクトのCLAUDE.mdは以下のベストプラクティスに基づいて作成されている。追加・編集する際もこれを守る。
https://www.humanlayer.dev/blog/writing-a-good-claude-md

---

## WHY

Pokémon Champions の対戦映像をキャプチャーボード経由で取得し、画像認識（OCR + テンプレートマッチング）で解析してダメージ計算を自動化するツール。
対戦中にリアルタイムで相手ポケモンの認識・HP読み取り・ダメージ範囲/確定数の表示を行い、プレイヤーの意思決定を支援する。

現在のスコープは Phase 1 = シングルバトルの自動ダメージ計算。詳細は `docs/requirements/README.md` を参照。

## WHAT

### アーキテクチャ

ブラウザ（映像取得・表示・UI）↔ WebSocket / REST ↔ Python バックエンド（OCR・認識・計算）

- **バックエンド**: Python 3.10+ / FastAPI + Uvicorn / CUDA (RTX 5070, 12GB VRAM)
  - OCR: PaddleOCR PP-OCRv5 / manga-ocr / GLM-OCR (0.9B) — 3エンジン同時起動、ローカルGPU完結
  - テンプレートマッチング: OpenCV
- **フロントエンド**: HTML + CSS + JavaScript（フレームワークなし）
  - 映像: `navigator.mediaDevices` + Canvas API
  - 通信: WebSocket（リアルタイム）+ fetch（REST）
- **データ**: JSON 3層構造 — base（PokeAPI）→ champions_override（差分パッチ）→ seasons（シーズンフィルタ）

### ディレクトリ構成

```
backend/           Python バックエンド（FastAPI）
  app/
    ocr/           OCRエンジン（抽象クラス + 各実装）
    recognition/   場面識別・ポケモン認識
    damage/        ダメージ計算エンジン
    api/           REST APIルーター
    ws/            WebSocketハンドラ
frontend/          ブラウザUI（HTML/CSS/JS）
data/              3層ポケモンデータ
  base/            Layer 1: PokeAPIベースデータ
  champions_override/  Layer 2: Champions固有の差分
  seasons/         Layer 3: シーズン定義
  names/           多言語名辞書（OCR照合用）
templates/         テンプレートマッチング用画像
```

## HOW

### 起動・テスト

<!-- M0/M1完了後に追記 -->
```
# バックエンド起動
TODO: M1で確定

# テスト実行
TODO: M1で確定
```

### 詳細ドキュメント

- 要件定義書 → `docs/requirements/README.md`（目次・各ドキュメントへのリンク）
  - 機能要件（FR-001〜FR-007）→ `docs/requirements/02-functional-requirements.md`
  - OCR構成・3エンジン設計 → `docs/requirements/05-ocr-architecture.md`
  - データ3層アーキテクチャ → `docs/requirements/06-data-design.md`
  - 開発ロードマップ（M0〜M6）→ `docs/requirements/07-risks-and-roadmap.md`

## 設計原則

- OCRエンジンは必ず抽象クラス (`OCREngine`) 経由で使う — エンジンの差し替え・追加を容易にする
- テンプレート画像・UI座標は config 化し、ハードコードしない
- データは パッチ方式 で管理（`base/` を直接書き換えず `champions_override/` で上書き）
- Python は型ヒント必須
