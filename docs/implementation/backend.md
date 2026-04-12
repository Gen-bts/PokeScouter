# バックエンド実装仕様

## 技術スタック

| ライブラリ | 用途 |
|---|---|
| FastAPI + Uvicorn | Web フレームワーク / ASGI サーバー |
| opencv-python-headless | 画像処理（デコード・前処理・テンプレートマッチング） |
| PaddleOCR (PP-OCRv5 mobile) | 高速 OCR（HP数値読み取り等） |
| manga-ocr | 日本語特化 OCR（ポケモン名認識） |
| transformers + GLM-OCR 0.9B | VLM ベース OCR（チーム選択画面の一括認識） |
| NumPy / Pillow | 画像配列操作 |
| torch + CUDA | GPU 推論 |

Python 3.10+、RTX 5070 (12GB VRAM) 前提。

---

## ディレクトリ構成

```
backend/
├── app/
│   ├── main.py              FastAPI アプリ初期化・ルーター登録
│   ├── dependencies.py      RegionRecognizer シングルトン管理
│   ├── api/
│   │   ├── health.py        ヘルスチェック API
│   │   ├── devtools.py      DevTools REST API（録画・リージョン編集）
│   │   └── devtools_models.py  Pydantic モデル定義
│   ├── ocr/
│   │   ├── base.py          OCREngine 抽象クラス・共通型
│   │   ├── paddle_ocr.py    PaddleOCR 実装
│   │   ├── manga_ocr.py     manga-ocr 実装
│   │   ├── glm_ocr.py       GLM-OCR 実装
│   │   ├── pipeline.py      前処理→OCR→後処理パイプライン
│   │   ├── preprocessing.py 画像前処理関数群
│   │   ├── postprocessing.py テキスト後処理関数群
│   │   ├── region.py        リージョン認識（画面領域の切り出し + 一括 OCR）
│   │   └── __init__.py      遅延インポート
│   └── ws/
│       └── battle.py        WebSocket ハンドラ（リアルタイム OCR）
├── config/
│   └── regions.json         画面リージョン座標定義
├── data/
│   └── recordings/          録画セッション保存先
├── tests/
│   ├── conftest.py          pytest フィクスチャ
│   └── test_ocr_engines.py  OCR エンジン スモークテスト
└── tools/
    ├── live_ocr.py          リアルタイム OCR ビューア（開発用）
    ├── capture.py           フレームキャプチャ
    ├── crop.py              ROI 切り出し
    ├── hp_experiment.py     HP パース実験
    └── ocr_test.py          OCR テスト
```

---

## アプリケーション起動

### ライフサイクル (`app/main.py`)

```
起動: lifespan → init_recognizer() → RegionRecognizer シングルトン生成
  ↓
稼働: ルーター処理（REST / WebSocket）
  ↓
停止: lifespan → shutdown_recognizer() → 全エンジン解放・VRAM 開放
```

### ルーター登録

| プレフィックス | ルーター | 用途 |
|---|---|---|
| `/api` | `health_router` | ヘルスチェック |
| `/api/devtools` | `devtools_router` | 録画・リージョン管理 |
| `/ws` | `battle_router` | リアルタイム OCR |

CORS は全オリジン許可（ローカル開発用）。`frontend/dist/` を静的ファイルとして配信。

### シングルトン管理 (`app/dependencies.py`)

`RegionRecognizer` はアプリ全体で1インスタンス。`get_recognizer()` で取得。起動時に `init_recognizer()` で生成、停止時に `shutdown_recognizer()` で VRAM 解放。

---

## OCR エンジン

### 抽象クラス (`app/ocr/base.py`)

```python
class OCREngine(ABC):
    engine_name: str       # "paddle" | "manga" | "glm"
    is_loaded: bool        # モデルがVRAMにあるか

    def load() -> None          # モデルをVRAMにロード
    def unload() -> None        # VRAMから解放
    def recognize(image: np.ndarray, lang: str = "ja") -> list[OCRResult]
```

入力は BGR numpy 配列（OpenCV 標準）。出力は `OCRResult` のリスト。

### データ型

```python
@dataclass(frozen=True)
class BoundingBox:
    x_min: int; y_min: int; x_max: int; y_max: int

@dataclass(frozen=True)
class OCRResult:
    text: str                          # 認識テキスト
    confidence: float                  # 0.0〜1.0
    bounding_box: BoundingBox | None   # 座標（エンジンによっては None）
    raw: dict[str, Any]                # エンジン固有メタデータ
```

### エンジン一覧

| エンジン | クラス | 主な用途 | 速度目安 | 特徴 |
|---|---|---|---|---|
| PaddleOCR | `PaddleOCREngine` | HP 数値読み取り | ~50ms/frame | 検出+認識。BoundingBox あり |
| manga-ocr | `MangaOCREngine` | ポケモン名認識 | ~30ms/frame | 日本語特化。単一行前提。confidence 固定 1.0 |
| GLM-OCR | `GLMOCREngine` | チーム選択一括認識 | ~300ms/frame | VLM。プロンプトでカスタマイズ可能 |

### 遅延ロード (`app/ocr/__init__.py`)

GPU 依存パッケージの import はエンジンクラスが初めて参照された時点で実行される（`__getattr__` による遅延インポート）。未使用エンジンの VRAM 消費を避ける。

---

## OCR パイプライン (`app/ocr/pipeline.py`)

前処理 → エンジン認識 → 後処理を1つのフローにまとめる。

```
画像 → preprocess(image) → engine.recognize(image) → postprocess(text) → OCRResult
```

### プリセット

| プリセット名 | 前処理 | 後処理 | 用途 |
|---|---|---|---|
| `raw` | なし | なし | 汎用 |
| `hp` | なし | hp_parse | HP 数値の正規化 |
| `hp_upscale` | upscale（2倍 + CLAHE + 二値化） | hp_parse | 小さい HP 表示の読み取り |
| `name` | なし | なし | ポケモン名 |

### 前処理関数 (`app/ocr/preprocessing.py`)

すべて `np.ndarray → np.ndarray`（BGR → BGR）。

| 関数名 | 処理 |
|---|---|
| `none` | パススルー |
| `binary` | グレースケール → 大津の二値化 |
| `adaptive` | 適応的ガウシアン二値化 |
| `clahe` | CLAHE コントラスト強調 → 二値化 |
| `invert` | 暗背景上の白文字用（反転 → 二値化） |
| `upscale` | 2倍拡大（INTER_CUBIC）→ CLAHE → 二値化 |

### 後処理関数 (`app/ocr/postprocessing.py`)

| 関数名 | 処理 |
|---|---|
| `none` | パススルー |
| `hp_parse` | HP 文字列の正規化 |

**`hp_parse` の処理フロー:**

```
入力: "215/215", "2151215", "215:215", "１００％" など
  ↓
1. 既に "数値/数値" or "数値%" なら即 return
2. 全角→半角変換
3. ":" → "/" 置換
4. 数字のみ抽出 → _guess_hp_split() で分割を推定
5. "/" が "1" に誤認識されたケースを _guess_slash_as_one() で補正
   - ポケモンの HP 上限 (714) を制約として利用
  ↓
出力: "current/max" or "percentage%"（失敗時は元テキスト）
```

---

## リージョン認識 (`app/ocr/region.py`)

フルフレーム（1920x1080）を事前定義した領域に分割し、各領域を最適なエンジン+プリセットで OCR する。

### 座標定義 (`config/regions.json`)

```json
{
  "resolution": { "width": 1920, "height": 1080 },
  "battle": {
    "own_name":      { "x": 140,  "y": 934, "w": 240, "h": 43, "engine": "paddle", "preset": "name" },
    "own_hp":        { "x": 247,  "y": 1007, "w": 156, "h": 49, "engine": "paddle", "preset": "hp" },
    "opponent_name": { "x": 1602, "y": 47,  "w": 218, "h": 48, "engine": "paddle", "preset": "name" },
    "opponent_hp":   { "x": 1727, "y": 126, "w": 109, "h": 41, "engine": "paddle", "preset": "hp" }
  },
  "team_select": {
    "own_pokemon_1": { "x": ..., "y": 155, "w": 160, "h": 50, "engine": "paddle", "preset": "name" },
    "own_pokemon_2": { "x": ..., "y": 285, ... },
    ...（6枠）
  }
}
```

### クラス構成

```
RegionConfig          regions.json の読み込み・管理
  ├── get_regions(scene) → list[Region]
  └── reload()           設定の再読み込み（リアルタイム調整用）

RegionRecognizer      メインのオーケストレーション
  ├── _engines: dict[str, OCREngine]       エンジンキャッシュ
  ├── _pipelines: dict[str, OCRPipeline]   パイプラインキャッシュ
  ├── recognize(image, scene) → list[RegionResult]
  └── unload_all()                         全エンジン解放
```

### 処理フロー

```
フルフレーム (1920x1080)
  ↓
RegionRecognizer.recognize(frame, scene="battle")
  ↓
regions.json から battle のリージョン一覧を取得
  ↓
各リージョンについて:
  1. image[y:y+h, x:x+w] で切り出し
  2. _get_pipeline(engine, preset) でパイプライン取得（遅延生成・キャッシュ）
  3. pipeline.run(cropped) → [OCRResult, ...]
  4. テキスト結合・時間計測
  ↓
[RegionResult, RegionResult, ...] を返却
```

---

## WebSocket ハンドラ (`app/ws/battle.py`)

### エンドポイント: `ws://localhost:8000/ws/battle`

### メッセージプロトコル

| 方向 | 形式 | 内容 |
|---|---|---|
| クライアント→サーバー | binary (ArrayBuffer) | JPEG フレームデータ |
| クライアント→サーバー | JSON | `{ "type": "config", "scene?", "interval_ms?", "paused?" }` |
| サーバー→クライアント | JSON | `{ "type": "status", "status": "connected" \| "processing" }` |
| サーバー→クライアント | JSON | `{ "type": "ocr_result", "scene", "elapsed_ms", "regions": [...] }` |

### OCR 結果レスポンス例

```json
{
  "type": "ocr_result",
  "scene": "battle",
  "elapsed_ms": 123.4,
  "regions": [
    { "name": "own_name",      "text": "ピカチュウ", "confidence": 0.95, "elapsed_ms": 45.2 },
    { "name": "own_hp",        "text": "215/215",    "confidence": 0.88, "elapsed_ms": 32.1 },
    { "name": "opponent_name", "text": "リザードン", "confidence": 0.91, "elapsed_ms": 28.7 },
    { "name": "opponent_hp",   "text": "100%",       "confidence": 0.79, "elapsed_ms": 17.4 }
  ]
}
```

### 内部アーキテクチャ

```
クライアント接続
  ↓
BattleSession 生成 + frame_queue (maxsize=2)
  ↓
2つの非同期タスクを並行起動:

[receive_loop]                    [process_loop]
  ├ bytes → frame_queue に投入     ├ frame_queue からフレーム取得
  │  (古いフレームは破棄)           ├ paused / interval_ms でレート制限
  └ JSON → config 更新             ├ JPEG デコード
     scene, interval_ms, paused    ├ {"type":"status","status":"processing"} 送信
                                   ├ _ocr_lock 取得（GPU排他制御）
                                   ├ _run_ocr() をスレッドプールで実行
                                   └ OCR 結果 JSON 送信
```

**GPU 排他制御:** `asyncio.Lock` (`_ocr_lock`) で複数 WebSocket 接続からの同時推論を直列化。

**フレーム間引き:** `frame_queue` の maxsize=2 により、OCR が追いつかない場合は古いフレームを自動破棄。`interval_ms`（最小 100ms）でさらにレート制限。

---

## REST API

### ヘルスチェック (`app/api/health.py`)

| メソッド | パス | レスポンス |
|---|---|---|
| GET | `/api/health` | `{ "status": "ok", "engines_loaded": bool, "scenes": [...] }` |

### DevTools API (`app/api/devtools.py`)

#### 録画セッション

| メソッド | パス | 用途 |
|---|---|---|
| POST | `/api/devtools/recordings` | セッション作成 |
| GET | `/api/devtools/recordings` | 一覧取得（新しい順） |
| GET | `/api/devtools/recordings/{id}` | 詳細取得 |
| DELETE | `/api/devtools/recordings/{id}` | 削除 |
| POST | `/api/devtools/recordings/{id}/frames` | フレーム追加（JPEG バイナリ） |
| POST | `/api/devtools/recordings/{id}/complete` | 録画完了 |
| GET | `/api/devtools/recordings/{id}/frames` | フレーム一覧 |
| GET | `/api/devtools/recordings/{id}/frames/{filename}` | フレーム画像取得 |
| GET | `/api/devtools/recordings/{id}/frames/{filename}/thumbnail` | サムネイル（256px幅） |

**フレームファイル名規則:** `{index:06d}_{timestamp_ms:07d}.jpg`（例: `000042_0021500.jpg`）

**保存先:** `data/recordings/{session_id}/frames/`

#### リージョン編集

| メソッド | パス | 用途 |
|---|---|---|
| GET | `/api/devtools/regions` | 全リージョン取得 |
| POST | `/api/devtools/regions/{scene}/{name}` | リージョン追加/更新 |
| DELETE | `/api/devtools/regions/{scene}/{name}` | リージョン削除 |

### Pydantic モデル (`app/api/devtools_models.py`)

```python
class SessionCreate:
    description: str = ""

class SessionMetadata:
    session_id: str
    created_at: str          # ISO 8601
    frame_count: int
    duration_ms: int
    resolution: tuple[int, int]
    status: str              # "recording" | "completed"
    description: str

class FrameInfo:
    index: int
    filename: str
    timestamp_ms: int

class RegionUpdate:
    x: int; y: int; w: int; h: int
    engine: str = "paddle"
    preset: str = "raw"
```

---

## 開発ツール (`tools/`)

### `live_ocr.py` — リアルタイム OCR ビューア

キャプチャーボードから直接映像を取得し、OpenCV ウィンドウで OCR 結果をオーバーレイ表示する。WebSocket を介さない開発・デバッグ用ツール。

```bash
cd backend
python -m tools.live_ocr --device 0 --scene battle --interval 0.5
```

| オプション | デフォルト | 用途 |
|---|---|---|
| `--device` | 0 | ビデオキャプチャデバイス番号 |
| `--output-dir` | tests/fixtures/images | フレーム保存先 |
| `--scene` | battle | 初期シーン |
| `--interval` | 0.5 | OCR 間隔（秒） |

**キーバインド:**

| キー | 操作 |
|---|---|
| `q` | 終了 |
| `s` | フレーム保存 |
| `c` | ROI 選択（cv2.selectROI） |
| `1` / `2` | シーン切替（battle / team_select） |
| `r` | 即時 OCR 実行 |
| `p` | 一時停止/再開 |
| `d` | オーバーレイ表示/非表示 |

---

## バトルログパーサー (`app/recognition/battle_log_parser.py`)

メインテキスト OCR を結合し、正規表現でイベント化する。`BattleLogParser` は `app/ws/battle.py` のバトルシーン処理から利用される。

- **技名の照合**: 覚える技リスト（`data/champions_override/learnsets.json`）に対し `SequenceMatcher` で類似度を取る。デフォルト閾値は **0.88**（低すぎると別技に吸われるため）。閾値未満のときは `move_id` を付けず OCR 生テキストのまま送る。
- **ステータス変化**: ひらがな（こうげき）に加え、UI が **漢字（攻撃・防御 等）** のときも `stat_change` にマッチさせ、同じ行が `move_used` にならないようにする。
- **叙述行**: 「眠気を誘った」などわざ名ではないフレーズは `move_used` から除外する。
- **learnset データ**: Champions で実際に使用可能な技が `learnsets.json` に無いと照合できない（`move_id` が付かない）。不足は同ファイルへ追記する。

---

## テスト

### 実行

```bash
cd backend
pytest                 # 全テスト
pytest -m "not gpu"    # GPU なし（CI 向け）
pytest -m "not slow"   # 高速テストのみ
```

### フィクスチャ (`tests/conftest.py`)

| フィクスチャ | スコープ | 内容 |
|---|---|---|
| `fixtures_dir` | session | `tests/fixtures/` パス |
| `sample_images_dir` | session | `tests/fixtures/images/` パス |
| `dummy_text_image` | session | "12345" を描画した 100x300 テスト画像 |
| `paddle_engine` | session | PaddleOCREngine（ロード済み） |
| `manga_engine` | session | MangaOCREngine（ロード済み） |
| `glm_engine` | session | GLMOCREngine（ロード済み） |

### テストケース (`tests/test_ocr_engines.py`)

すべて `@pytest.mark.gpu`。

| クラス | テスト内容 |
|---|---|
| `TestPaddleOCREngine` | ロード、結果返却、数字検出、confidence 範囲、BoundingBox |
| `TestMangaOCREngine` | ロード、結果返却、テキスト非空 |
| `TestGLMOCREngine` | ロード、結果返却、テキスト非空 |
