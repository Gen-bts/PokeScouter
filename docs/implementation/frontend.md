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
│   ├── BattleInfoOverlay.tsx  バトル情報（種族値・ダメージ・すばやさ等のオーバーレイ）
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
│       ├── BattleInfoOverlay  バトル情報オーバーレイ（ツールバー「バトル情報」で表示切替。`App.css` で通常時 opacity 薄め・ホバー/フォーカス/ドラッグで不透明）
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
| `selectedDeviceId` | `string` | localStorage `pokescouter:settings` | 選択済み映像デバイス |
| `selectedAudioDeviceId` | `string` | 同上 | 選択済み音声デバイス |
| `volume` | `number` | 同上 | 音量 (0.0〜1.0) |
| `muted` | `boolean` | 同上 | ミュート状態 |
| `jpegQuality` | `number` | 同上 | キャプチャ JPEG 画質 (0.3〜1.0) |
| `autoPauseMinutes` | `number` | 同上 | 自動停止タイムアウト (分) |
| `debugOverlay` | `boolean` | 同上 | デバッグオーバーレイ表示 |
| `debugCrops` | `boolean` | 同上 | クロップ画像表示 |
| `showBattleInfo` | `boolean` | 同上 | バトル情報オーバーレイの表示/非表示 |
| `battleInfoPosition` | `{ x, y }` | 同上 | バトル情報オーバーレイのドラッグ位置（`persist` バージョン 3 でキー整理。v2 以前の `showBattleInfoOverlay` / `battleInfoOverlayPosition` は migrate で引き継ぎ） |

**設計意図**: デバイス選択や音量などはタブ切替（BattleView のアンマウント）やページリロードを跨いで保持する必要があるため、Zustand + persist で管理。

**ストア追加の基準**: 新しい共有状態が必要になったら `stores/` に `use<Name>Store.ts` を作成し、同じパターン（`create` + `persist`）で実装する。

#### 相手パーティ・素早さ推定（`useOpponentTeamStore` / `useSpeedInferenceStore`）

- **`useSpeedInferenceStore`**: 同一優先度の技の行動順から、相手の理論すばやしさレンジ（努力・性格の幅）を狭める推定 `inferredBounds` を保持する。
- **`OpponentSlot.inferredSpeedBounds`**: 上記推定を **相手ポケモン ID 単位**でコピーした参照用フィールド。推定ストア更新・リセットのたびに `applyInferredSpeedMap` で同期する。UI（バトル情報オーバーレイの種族値 S 行・相手パネルツールチップなど）は主にここを見て「戦闘中の実数値」レンジを表示する。

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

キャプチャーボード映像・音声の取得と Canvas 描画を管理。

**ライフサイクル:**
1. マウント時に `navigator.mediaDevices.getUserMedia({ video: true, audio: true })` で権限取得（ラベル解決のため）
2. `enumerateDevices()` で `videoinput` / `audioinput` デバイス一覧を取得
3. `navigator.mediaDevices` の `devicechange` イベントで一覧を自動更新
4. `startCapture(deviceId, audioDeviceId?)` で指定デバイスの映像・音声ストリームを開始
5. `loadedmetadata` / `resize` を待って `videoWidth` / `videoHeight` が確定してから canvas サイズを設定する
6. キャプチャ成功後に `enumerateDevices()` を再実行（権限確定後に ID/ラベルが安定する場合への対応）
7. `requestAnimationFrame` ループで video → canvas に描画

**返却値:**

| 名前 | 型 | 用途 |
|---|---|---|
| `videoRef` | `RefObject<HTMLVideoElement>` | 非表示 video 要素 |
| `canvasRef` | `RefObject<HTMLCanvasElement>` | 描画先 canvas |
| `devices` | `MediaDeviceInfo[]` | 利用可能な映像デバイス一覧 |
| `audioDevices` | `MediaDeviceInfo[]` | 利用可能な音声デバイス一覧 |
| `isCapturing` | `boolean` | キャプチャ中かどうか |
| `startCapture(deviceId, audioDeviceId?)` | `(string, string?) => Promise<void>` | キャプチャ開始 |
| `stopCapture()` | `() => void` | キャプチャ停止 |
| `captureFrame(quality)` | `(number) => Promise<Blob \| null>` | 現在フレームを JPEG Blob で取得 |
| `setVolume(v)` | `(number) => void` | 音量設定 |
| `setMuted(m)` | `(boolean) => void` | ミュート設定 |
| `refreshDevices()` | `() => Promise<void>` | デバイス一覧を手動で再取得 |

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

**useConnectionStore（`stores/useConnectionStore.ts`）:** WebSocket 接続オープン時と `scene_change` で `top_level === "pre_match"` のとき、`set_player_party` を送る。バックエンドの `match_teams.player_team` はこの並びを優先し、選出画面の味方名 OCR は使わない。また、`scene_change` で `scene === "team_select"` のとき `useOpponentTeamStore.clear()` を呼び、前試合の相手パーティ情報をクリアする（`match_teams` 受信より先に届くため）。

**メッセージプロトコル:**

| 方向 | 形式 | 内容 |
|---|---|---|
| 送信 | binary (ArrayBuffer) | JPEG フレームデータ |
| 送信 | JSON | `{ type: "config", scene?, paused?, debug_crops?, benchmark? }` |
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
  paused?: boolean;      // 一時停止
  debug_crops?: boolean; // デバッグ用クロップ画像送信
  benchmark?: boolean;   // ベンチマークモード
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

### デバイス選択の永続化と自動復元

```
1. 初回起動: useSettingsStore が localStorage から selectedDeviceId / selectedAudioDeviceId を復元（Zustand persist hydration）
2. useVideoCapture: マウント時にデバイス一覧を取得し、初回列挙完了後に `devicesReady = true`、devicechange リスナーを登録
3. App の useEffect（自動復元）:
   a. hydration 完了と `devicesReady` を待つ
   b. 保存済み映像 deviceId があれば、一覧との厳密一致を待たずに startCapture を試行
   c. 音声 audioDeviceId は一覧に存在する場合のみ使用、なければ undefined でフォールバック
   d. startCapture は同時に 1 回だけ走らせ、成功時に isCapturing = true、失敗時に autoRestoreFailed = true を設定
   e. 失敗時は refreshDevices() で一覧を再取得し、UI で再選択を促す
4. ユーザーがデバイス変更: handleDeviceChange → store.setDeviceId() → persist middleware が自動保存
5. タブ切替: BattleView がアンマウントされても store は App レベルで生存
6. ページリロード: persist middleware が localStorage から自動復元
7. デバイス抜き差し: devicechange イベントで一覧を自動更新
```

**設計意図**: ブラウザの `deviceId` はタイミングや権限状態によって列挙結果と一致しない場合がある。一覧に存在するかどうかの厳密チェックだけに頼らず、まず保存 ID で `getUserMedia` を試し、失敗した場合のみ再選択導線を提示することで、復元の堅牢性を高める。

### マイパーティ（`MyPartyPanel.tsx`）

パーティ登録完了後、スロット横のポケモン名は `slot.name`（アイコン識別に基づく図鑑名）だけでなく、**`fields["名前"]` の OCR 補正結果（`validated` / `raw`）を優先**して表示する。ツールチップ内の「名前」行はレイアウト上省略されがちなため、補正の見えやすい箇所がスロット名になる。

### マッチログの HP 正規化

自分側ポケモンの体力遷移（`player_active` メッセージ由来）は、バックエンドから送られる OCR 読み取り値ではなく、**パーティ登録時の HP 実数値を基準に正規化**する。

- **最大 HP**: `useConnectionStore` が `player_active` を受信した際、`getEffectivePlayerMaxHp()` でパーティスロットの `fields["HP実数値"]` を参照（メガシンカ中は `megaForm.base_stats.hp` + `fields["HP努力値"]` で `calcChampionsHp` を用いて再計算）。取得できない場合のみ OCR の `max_hp` にフォールバック。
- **現在 HP**: パーティ基準の最大 HP でクランプし、パーセンテージもそこから再計算。これにより OCR の最大値ブレによる「減少と上昇の同時発生」のような不整合を抑制。
- **コアレスの方向判定**: `addHpChange` 内で `actualHp`（整数現在 HP）がある場合はパーセンテージではなく整数差で変化方向を判定し、連続する同一方向の変化をマージ。

### わざ情報ホバーチップ（`MoveInfoChip.tsx`）

わざ名にホバーすると日本語のわざ詳細（タイプ・分類・威力・命中・PP・説明）をツールチップ表示する。

**使用箇所:**

| コンポーネント | 対象 |
|---|---|
| `OpponentPanel` | 相手スロットの判明技4枠 |
| `BattleInfoOverlay` | 与ダメージ・被ダメージ一覧の各技行 |
| `MyPartyPanel` | 自分パーティスロットのツールチップ内わざ一覧 |

**データフロー:**

```
MoveInfoChip (ホバー時)
  ↓
useMoveDetail(moveKey) → GET /api/move/{move_key}?lang=ja
  ↓
キャッシュ保持（同一 move_key は再取得しない）
  ↓
createPortal でツールチップを body に描画
```

**API レスポンス例:**

```json
{
  "move_key": "thunderbolt",
  "move_name": "Thunderbolt",
  "move_name_ja": "10まんボルト",
  "type": "electric",
  "type_name_ja": "でんき",
  "damage_class": "special",
  "damage_class_name_ja": "特殊",
  "power": 90,
  "accuracy": 100,
  "pp": 15,
  "priority": 0,
  "target": "normal",
  "makes_contact": false,
  "short_desc": "10% chance to paralyze the target.",
  "short_desc_ja": "10%の確率で相手を「まひ」状態にする。"
}
```

**日本語フォールバック:** 技説明の日本語がない場合は英語 `short_desc` にフォールバックする。`data/champions_override/move_descs_ja.json` に日本語説明を追加すると優先される。
