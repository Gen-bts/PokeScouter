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
- **フロントエンド**: React + TypeScript + Vite + Zustand
  - 状態管理: Zustand（persist middleware で localStorage 自動永続化）
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
frontend/          ブラウザUI（React + TypeScript + Vite）
  src/             Reactソースコード
    stores/        Zustand ストア（状態管理）
    hooks/         カスタムHook（useVideoCapture, useWebSocket）
    components/    Reactコンポーネント
data/              3層ポケモンデータ
  base/            Layer 1: PokeAPIベースデータ
  champions_override/  Layer 2: Champions固有の差分
  seasons/         Layer 3: シーズン定義
  names/           多言語名辞書（OCR照合用）
templates/         テンプレートマッチング用画像
```

## HOW

### 起動・テスト

```
# フロントエンド開発サーバー起動（frontend/ ディレクトリで実行）
cd frontend
npm install                 # 初回のみ
npm run dev                 # Vite 開発サーバー (http://localhost:5173)

# フロントエンドビルド（本番用）
cd frontend
npm run build               # frontend/dist/ に出力

# バックエンド起動（backend/ ディレクトリで実行）
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# 開発時: http://localhost:5173 を開く（Vite がバックエンドにプロキシ）
# 本番時: http://localhost:8000 を開く（バックエンドが frontend/dist/ を配信）

# テスト実行
cd backend
pytest                      # 全テスト
pytest -m "not gpu"         # GPU なし
pytest -m "not slow"        # 高速テストのみ

# 使用率データ取得（リポジトリルート）
# ソース切り替え: backend/config/settings.toml の [data] usage_source
# 詳細: docs/usage-data-sources.md

# pokechamdb (最優先データソース。種族値・実数値・技/持ち物/特性/性格/努力値を網羅)
python scripts/fetch_pokechamdb.py               # 全件取得 (約210体)
python scripts/fetch_pokechamdb.py --probe       # HTML構造確認 (2体のみ)

# Pikalytics (フォールバック)
python scripts/fetch_pikalytics_usage.py

# pokemon-champions-stats (性格・努力値を含む)
# 依存: pip install beautifulsoup4
python scripts/fetch_champions_stats.py          # 全件取得
python scripts/fetch_champions_stats.py --probe  # HTML構造確認 (2体のみ)

# ポケモン徹底攻略 (yakkun.com, fallback用「人気」技リスト)
# 依存: pip install beautifulsoup4
python scripts/fetch_yakkun_usage.py             # 全件取得 (約185体)
python scripts/fetch_yakkun_usage.py --probe     # HTML構造確認 (2体のみ)
```

### 詳細ドキュメント

- 要件定義書 → `docs/requirements/README.md`（目次・各ドキュメントへのリンク）
  - 機能要件（FR-001〜FR-007）→ `docs/requirements/02-functional-requirements.md`
  - OCR構成・3エンジン設計 → `docs/requirements/05-ocr-architecture.md`
  - データ3層アーキテクチャ → `docs/requirements/06-data-design.md`
  - 開発ロードマップ（M0〜M6）→ `docs/requirements/07-risks-and-roadmap.md`
- 実装仕様 → `docs/implementation/`
  - フロントエンド実装仕様 → `docs/implementation/frontend.md`
  - バックエンド実装仕様 → `docs/implementation/backend.md`
- 使用率データソース運用 → `docs/usage-data-sources.md`

## 設計原則

- OCRエンジンは必ず抽象クラス (`OCREngine`) 経由で使う — エンジンの差し替え・追加を容易にする
- テンプレート画像・UI座標は config 化し、ハードコードしない
- データは パッチ方式 で管理（`base/` を直接書き換えず `champions_override/` で上書き）
- Python は型ヒント必須
