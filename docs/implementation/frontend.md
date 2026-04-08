# フロントエンド実装仕様

## 技術スタック

| ライブラリ | バージョン | 用途 |
|---|---|---|
| React | 19.x | UI |
| TypeScript | 5.x | 型安全 |
| Vite | 6.x | ビルド / 開発サーバー |
| Zustand | 5.x | 状態管理（persist middleware で localStorage 自動永続化） |

UIフレームワーク・CSSライブラリは未導入。素の CSS (`App.css`) を使用。

---

## ディレクトリ構成

```
frontend/src/
├── api/               REST API クライアント
│   └── devtools.ts    DevTools 用エンドポイント
├── stores/            Zustand ストア
│   └── useSettingsStore.ts   アプリ設定（デバイス選択等）
├── hooks/             カスタム Hook
│   ├── useVideoCapture.ts    映像キャプチャ管理
│   └── useWebSocket.ts       WebSocket 接続管理
├── components/        React コンポーネント
│   ├── BattleView.tsx         バトル画面（メイン）
│   ├── VideoCanvas.tsx        映像表示 Canvas
│   ├── ControlPanel.tsx       操作パネル（デバイス選択・設定）
│   ├── StatusIndicator.tsx    接続状態表示
│   ├── OcrResults.tsx         OCR 結果表示
│   ├── DevToolsView.tsx       開発ツール画面
│   └── devtools/
│       ├── RecordingPanel.tsx  フレーム録画
│       ├── FrameViewer.tsx     録画フレーム閲覧
│       └── CropEditor.tsx      OCR リージョン編集
├── types.ts           共通型定義
└── App.tsx            ルートコンポーネント
```

---

## コンポーネントツリー

```
App
├── useVideoCapture()          映像デバイス列挙・キャプチャ制御
├── useSettingsStore()         保存済みデバイスID読み取り（自動復元用）
│
├── [tab: バトル]
│   └── BattleView
│       ├── useWebSocket()     WebSocket 接続・フレーム送信
│       ├── useSettingsStore() デバイスID 読み書き
│       ├── VideoCanvas        映像表示（video → canvas 描画ループ）
│       ├── StatusIndicator    接続状態（disconnected / connecting / connected / processing / reconnecting）
│       ├── ControlPanel       デバイス選択、シーン、送信間隔、画質、一時停止、接続ボタン
│       └── OcrResults         OCR 結果テーブル表示
│
└── [tab: Dev Tools]
    └── DevToolsView
        ├── [subtab: 録画]     RecordingPanel — フレーム録画・セッション管理
        ├── [subtab: ビューア]  FrameViewer — 録画セッション閲覧
        └── [subtab: クロップ]  CropEditor — OCR リージョン矩形定義
```

---

## 状態管理

### 方針

- **Zustand ストア**: 複数コンポーネントから参照する共有状態、永続化が必要な状態
- **useState**: コンポーネント内で完結するローカル UI 状態（フォーム入力、描画状態など）

### ストア一覧

#### `useSettingsStore` (`stores/useSettingsStore.ts`)

| 状態 | 型 | 永続化 | 用途 |
|---|---|---|---|
| `selectedDeviceId` | `string` | localStorage `pokescouter:settings` | 選択済みキャプチャデバイス |

**設計意図**: デバイス選択はタブ切替（BattleView のアンマウント）やページリロードを跨いで保持する必要があるため、Zustand + persist で管理。

**ストア追加の基準**: 新しい共有状態が必要になったら `stores/` に `use<Name>Store.ts` を作成し、同じパターン（`create` + `persist`）で実装する。

### ローカル状態（useState）

| コンポーネント | 状態 | 用途 |
|---|---|---|
| App | `activeTab` | 表示中のタブ（battle / devtools） |
| BattleView | `scene`, `intervalMs`, `quality`, `paused`, `videoReady`, `sending` | バトル画面固有の操作状態 |
| DevToolsView | `subTab`, `cropSessionId`, `cropFrame` | DevTools サブタブ・クロップ編集への遷移 |
| RecordingPanel | `sessions`, `recording`, `currentSession`, `frameCount`, `elapsed`, `intervalMs` | 録画セッション管理 |
| FrameViewer | `sessions`, `selectedSession`, `frames`, `selectedFrame`, `sliderIndex` | フレーム閲覧 |
| CropEditor | `sessions`, `selectedSession`, `frames`, `selectedFrame`, `scene`, `regions`, `drawing`, `isDrawing`, `newName`, `newEngine`, `newPreset`, `drawnRect` | リージョン編集 |

---

## カスタム Hook

### `useVideoCapture` (`hooks/useVideoCapture.ts`)

キャプチャーボード映像の取得と Canvas 描画を管理。

**ライフサイクル:**
1. マウント時に `navigator.mediaDevices.getUserMedia({ video: true })` で権限取得（ラベル解決のため）
2. `enumerateDevices()` で `videoinput` デバイス一覧を取得
3. `startCapture(deviceId)` で指定デバイスの映像ストリームを開始
4. `requestAnimationFrame` ループで video → canvas に描画

**返却値:**

| 名前 | 型 | 用途 |
|---|---|---|
| `videoRef` | `RefObject<HTMLVideoElement>` | 非表示 video 要素 |
| `canvasRef` | `RefObject<HTMLCanvasElement>` | 描画先 canvas |
| `devices` | `MediaDeviceInfo[]` | 利用可能なデバイス一覧 |
| `startCapture(deviceId)` | `(string) => Promise<void>` | キャプチャ開始 |
| `stopCapture()` | `() => void` | キャプチャ停止 |
| `captureFrame(quality)` | `(number) => Promise<Blob \| null>` | 現在フレームを JPEG Blob で取得 |

### `useWebSocket` (`hooks/useWebSocket.ts`)

バックエンドとの WebSocket 接続を管理。

**接続先:** `ws://${location.host}/ws/battle`

**接続状態遷移:**
```
disconnected → connecting → connected ⇄ processing
                                ↓
                          reconnecting → connecting → ...
```

**再接続:** 意図しない切断時に指数バックオフ（1s → 2s → 4s → ... 最大 10s）で自動再接続。

**メッセージプロトコル:**

| 方向 | 形式 | 内容 |
|---|---|---|
| 送信 | binary (ArrayBuffer) | JPEG フレームデータ |
| 送信 | JSON | `{ type: "config", scene?, interval_ms?, paused? }` |
| 受信 | JSON | `{ type: "ocr_result", regions: Region[], elapsed_ms, scene }` |
| 受信 | JSON | `{ type: "status", status: "processing" \| "connected" }` |

---

## REST API クライアント (`api/devtools.ts`)

DevTools 機能用の REST API ラッパー。ベース URL: `/api/devtools`

### 録画セッション

| 関数 | HTTP | エンドポイント | 用途 |
|---|---|---|---|
| `createSession(description?)` | POST | `/recordings` | セッション作成 |
| `listSessions()` | GET | `/recordings` | 一覧取得 |
| `getSession(id)` | GET | `/recordings/:id` | 詳細取得 |
| `deleteSession(id)` | DELETE | `/recordings/:id` | 削除 |
| `uploadFrame(id, blob, timestampMs)` | POST | `/recordings/:id/frames` | フレーム追加 |
| `completeSession(id)` | POST | `/recordings/:id/complete` | 録画完了 |
| `listFrames(id)` | GET | `/recordings/:id/frames` | フレーム一覧 |
| `frameUrl(id, filename)` | — | `/recordings/:id/frames/:filename` | フレーム画像 URL |
| `thumbnailUrl(id, filename)` | — | `/recordings/:id/frames/:filename/thumbnail` | サムネイル URL |

### リージョン編集

| 関数 | HTTP | エンドポイント | 用途 |
|---|---|---|---|
| `getRegions()` | GET | `/regions` | 全リージョン取得 |
| `upsertRegion(scene, name, region)` | POST | `/regions/:scene/:name` | リージョン追加/更新 |
| `deleteRegion(scene, name)` | DELETE | `/regions/:scene/:name` | リージョン削除 |

---

## 共通型定義 (`types.ts`)

```typescript
type ConnectionState = "connected" | "disconnected" | "connecting" | "reconnecting" | "processing";

interface Region {
  name: string;       // リージョン名
  text: string;       // OCR 認識テキスト
  confidence: number; // 信頼度
  elapsed_ms: number; // 処理時間
}

interface OcrResult {
  type: "ocr_result";
  regions: Region[];
  elapsed_ms: number; // 全体処理時間
  scene: string;      // 認識シーン
}

interface WsConfig {
  scene?: string;        // 認識対象シーン
  interval_ms?: number;  // フレーム送信間隔
  paused?: boolean;      // 一時停止
}
```

---

## データフロー

### バトル画面のフレーム送信ループ

```
1. ControlPanel で「接続」ボタン押下
2. useWebSocket.connect() → WebSocket 接続確立
3. BattleView の useEffect が setInterval を開始
4. 毎 intervalMs ごとに:
   a. captureFrame(quality) → canvas から JPEG Blob を取得
   b. sendFrame(blob) → WebSocket で ArrayBuffer として送信
   c. バックエンド側で OCR 処理
   d. { type: "ocr_result", ... } を受信 → lastResult に保存
   e. OcrResults コンポーネントが結果を表示
```

### デバイス選択の永続化

```
1. 初回起動: useSettingsStore が localStorage から selectedDeviceId を復元
2. App の useEffect: devices 列挙完了後、保存済み deviceId がリストに存在すれば自動で startCapture
3. ユーザーがデバイス変更: handleDeviceChange → store.setDeviceId() → persist middleware が自動保存
4. タブ切替: BattleView がアンマウントされても store は App レベルで生存
5. ページリロード: persist middleware が localStorage から自動復元
```
