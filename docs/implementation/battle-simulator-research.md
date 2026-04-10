# バトルシミュレーター・ダメージ計算エンジン 調査レポート

PokeScouter に内蔵するダメージ計算エンジン / バトルシミュレーターについて、既存の OSS プロジェクトを調査した結果をまとめる。

調査日: 2026-04-10

---

## 1. 現状の整理

PokeScouter は M3-M4 段階。ポケモン/技/特性/道具/タイプのデータ層、パーティ登録（OCR）、タイプ相性計算は実装済みだが、**ダメージ計算エンジンは未実装**（M4 で予定）。

将来的にはバトルシミュレーター（ターン制の状態管理・予測）まで拡張する可能性がある。

---

## 2. 主要な既存プロジェクト

### 2.1 Pokémon Showdown（フルバトルシミュレーター）

- **GitHub**: [smogon/pokemon-showdown](https://github.com/smogon/pokemon-showdown)
- **言語**: TypeScript / JavaScript (Node.js)
- **ライセンス**: MIT
- **概要**: 最も有名かつ広く使われているポケモンバトルシミュレーター。シングル・ダブル・トリプル対応、Gen 1〜9 まで全世代をサポート
- **特徴**:
  - 完全なダメージ計算式の実装
  - 全特性・道具・技の効果を網羅
  - 天候・フィールド・ステータス変化の管理
  - CLI ツールあり（非 JS プログラムからも利用可能）
  - Web API・ゲームサーバー基盤を含む
- **統合のしやすさ**: モノリス構成で巨大なため直接統合は困難。リファレンス実装として最適
- **メンテナンス状況**: 非常に活発
- **Champions 対応**: 2026年5-6月頃の見込み（現時点で未対応）

### 2.2 @smogon/calc（ダメージ計算特化ライブラリ）

- **GitHub**: [smogon/damage-calc](https://github.com/smogon/damage-calc)
- **npm**: [@smogon/calc](https://www.npmjs.com/package/@smogon/calc)
- **言語**: TypeScript / JavaScript
- **ライセンス**: MIT
- **概要**: Showdown チームによるダメージ計算に特化した軽量ライブラリ
- **特徴**:
  - Generation・攻撃側/防御側ポケモン・技・フィールド状態を入力として受け取る
  - ダメージ範囲・乱数・確定数・反動/吸収情報を返す
  - `@smogon/calc/adaptable` で任意のデータ層と組み合わせ可能
  - ブラウザ・サーバー両対応
- **統合のしやすさ**: 軽量で統合しやすい。Node.js マイクロサービス or Python 移植の2択
- **メンテナンス状況**: 活発（2026年3月に最新版公開）
- **Champions 対応**: 未対応

### 2.3 @pkmn/sim（Showdown のモジュラー抽出）

- **npm**: [@pkmn/sim](https://www.npmjs.com/package/@pkmn/sim)
- **言語**: TypeScript / JavaScript
- **ライセンス**: MIT
- **概要**: Showdown からシミュレーター部分だけを抽出したモジュラーパッケージ
- **特徴**:
  - 全世代を自動ロード
  - ブラウザ互換、WebAssembly サポート
  - Showdown 本体より統合しやすい
- **統合のしやすさ**: フルバトルシミュレーションが必要な場合に有効

### 2.4 pkmn/engine（超高速バトルエンジン）

- **GitHub**: [pkmn/engine](https://github.com/pkmn/engine)
- **npm**: [@pkmn/engine](https://www.npmjs.com/package/@pkmn/engine)
- **言語**: Zig（コア）+ TypeScript（リファレンスドライバ）
- **ライセンス**: OSS
- **概要**: Showdown 比 1000 倍速のバトルエンジン。AI・高頻度シミュレーション向け
- **特徴**:
  - WebAssembly 対応
  - 決定的テスト用の FixedRNG サポート
  - パフォーマンスクリティカルなアプリケーション向き
- **統合のしやすさ**: 低レベル API。修正には Zig の知識が必要
- **メンテナンス状況**: 活発

### 2.5 poke-env（Python / Showdown 連携）

- **GitHub**: [hsahovic/poke-env](https://github.com/hsahovic/poke-env)
- **PyPI**: [poke-env](https://pypi.org/project/poke-env/)
- **言語**: Python 3.10+
- **概要**: Showdown サーバーへの Python インターフェース。強化学習（Farama Gymnasium）との統合に特化
- **統合のしやすさ**: ボット開発向け。単体のダメージ計算エンジンとしては不向き

### 2.6 poke-engine / SirSkaro（Python バトルエンジン）

- **GitHub**: [SirSkaro/poke-engine](https://github.com/SirSkaro/poke-engine)
- **言語**: Python
- **概要**: Showdown ボットから抽出されたバトルエンジン。状態探索機能あり
- **メンテナンス状況**: 不活発
- **用途**: Python 実装のリファレンス

### 2.7 poke-battle-sim（Python バトルシミュレーター）

- **GitHub**: [hiimvincent/poke-battle-sim](https://github.com/hiimvincent/poke-battle-sim)
- **言語**: Python
- **概要**: カスタマイズ可能なバトルシミュレーション。Gen IV（DP/Pt）特化
- **用途**: Python 実装のリファレンス（世代が古い点に注意）

### 2.8 その他

- **[pikalytics/pikalytics-calc](https://github.com/pikalytics/pikalytics-calc)** — @smogon/calc ベースの VGC 特化ダメージ計算機（TypeScript, MIT）
- **[Kermalis/PokemonBattleEngine](https://github.com/Kermalis/PokemonBattleEngine)** — C# のフルバトルエミュレーション。包括的なバトルシステム設計のリファレンス

---

## 3. Champions 特化ツール（非 OSS）

| ツール | 概要 |
|---|---|
| Porygon Labs (porygonlabs.com) | Champions VGC ダメージ計算機（Web） |
| ChampDex (iOS / Android) | ダメージ・素早さ計算機アプリ |
| Pokesample (pokesample.com) | Champions 対応ダメージ計算機 |
| Game8 (game8.co) | 日本語対応のダメージ計算機 |

OSS ライブラリとしては公開されていない。

---

## 4. Champions 固有の考慮事項

既存シミュレーターではいずれも Champions に完全対応していない。主な差分:

- **IV（個体値）廃止**: ステータス計算式が異なる
- **ステータスポイント制**: 66 ポイント自由配分（従来の努力値とは別体系）
- **レベル上限**: 50 固定
- **ギミック共存**: メガ進化 + テラスタル + Z技 + ダイマックスが同一対戦内で共存（Omni Ring）
- **PP 値変更**: 一部の技の PP が変更
- **新規メガ進化**: 58 体（Champions 限定含む）、タイミング変更（交代前に発動）

---

## 5. 追加調査: @smogon/calc の直接利用可能性（2026-04-10 追記）

### 5.1 @smogon/calc の技術詳細

- **依存ゼロ**、3.34MB、完全自己完結
- `Pokemon` コンストラクタで **stat override が可能**（内部のステータス計算をバイパスし、任意の実数値を直接渡せる）
- `/adaptable` エントリポイントでカスタムデータ層を注入可能
- ダメージ計算式自体は Champions（Gen 10相当）でも標準世代と同一

### 5.2 Champions 特化 OSS の追加発見

| プロジェクト | OSS | Champions 対応 | ライブラリ利用 |
|---|---|---|---|
| **[NCP VGC Damage Calculator](https://github.com/nerd-of-now/NCP-VGC-Damage-Calculator)** | MIT | 対応済み | 不可（vanilla JS + jQuery の Web UI。モジュール化されていない） |
| **[pokemon-vgc-calc-mcp](https://github.com/jpbullalayao/pokemon-vgc-calc-mcp)** | MIT | @smogon/calc ベース | MCP サーバーとして利用可能 |
| **[@pkmn/dmg](https://github.com/pkmn/dmg)** | OSS | 汎用（データ層分離） | ライブラリ利用可 |

### 5.3 NCP VGC Calculator から判明した Champions ステータス計算式

NCP は Champions を Gen 10 として扱い、以下の計算式を使用:

```
HP:    floor((2 * base + 31) * 50 / 100 + 50 + 10) + stat_points
他:    floor((2 * base + 31) * 50 / 100 + 5) + stat_points
性格:  ×1.1（上昇）/ ×0.9（下降）を上記に適用
```

- `base` = 種族値
- `31` = 固定（IV が廃止されたが計算式上は 31 相当）
- `stat_points` = 0〜32（各ステータスに自由配分、合計66ポイント）
- レベル = 50 固定

### 5.4 Python から @smogon/calc を呼ぶ方法

| 方法 | 実用性 | 特徴 |
|---|---|---|
| **Node.js マイクロサービス（推奨）** | ◎ | Express で API を立てる。既存のマルチプロセス構成に合致 |
| subprocess | ○ | `subprocess.Popen(['node', 'calc.js', json])` — シンプルだが毎回プロセス起動 |
| PythonMonkey | △ | SpiderMonkey を Python に組み込み。MVP 段階で未成熟 |
| PyExecJS | × | 非推奨・メンテ終了 |
| WASM | × | @smogon/calc は WASM コンパイル非対応 |

---

## 6. 統合設計（推奨アプローチ）

**前回調査の「選択肢 D: Python 移植」から方針転換。@smogon/calc を Node.js マイクロサービスとしてそのまま利用する。**

理由:
1. ダメージ計算式は Champions でも標準世代と同一 → @smogon/calc の Gen 9 計算式がそのまま使える
2. Champions 固有のステータス計算は @smogon/calc の **外側** で行い、結果を stat override として渡すだけ
3. Python に移植する必要がない — 8年以上の検証済みロジックをそのまま活用
4. Showdown が Champions 対応した時点で依存パッケージの更新だけで済む

### 6.1 アーキテクチャ

```
Frontend (React :5173)
  │
  │  POST /api/damage  (Vite proxy → :8000)
  ▼
Python Backend (FastAPI :8000)
  │  - GameData でデータ補完（種族値、タイプ、特性、技情報）
  │  - 相手ポケモンのステータス推定
  │  - Champions ステータス計算
  │
  │  POST /calc/damage  (HTTP → :3100)
  ▼
Calc Service (Node.js + Express :3100)
  │  - @smogon/calc の Gen 9 をベースに使用
  │  - 受け取った実数値を stat override として注入
  │  - ダメージ範囲・確定数を計算して返却
  ▼
Response → Python Backend → Frontend
```

Python バックエンドが中間に入る理由:
- GameData（種族値・タイプ・特性・技・習得技）が Python 側のメモリに常駐
- 相手ポケモンの未知情報（持ち物・特性・努力値）の推定ロジックを Python 側で管理
- バトル状態（天候・フィールド・ランク変化）も Python 側の WebSocket セッションが保持
- フロントエンドからは `/api/damage` の1エンドポイントのみ（既存の proxy 設定で完結）

### 6.2 ディレクトリ構成

```
PokeScouter/
  calc-service/               # NEW: Node.js マイクロサービス
    package.json
    tsconfig.json
    src/
      index.ts                # Express サーバー (port 3100)
      routes/
        damage.ts             # POST /calc/damage
        health.ts             # GET /calc/health
      calc/
        champions-stats.ts    # Champions ステータス計算式
        damage-calc.ts        # @smogon/calc ラッパー
        opponent-sets.ts      # 相手の推定セット生成
      types.ts
    tests/
      champions-stats.test.ts
      damage-calc.test.ts
  backend/
    app/
      api/
        damage.py             # NEW: /api/damage エンドポイント（calc-service へプロキシ）
      damage/
        __init__.py
        client.py             # NEW: httpx で calc-service を呼ぶ非同期クライアント
  frontend/
    src/
      stores/
        useDamageCalcStore.ts # NEW: ダメージ計算結果の状態管理
      hooks/
        useDamageCalc.ts      # NEW: 計算トリガー + debounce
      components/
        DamagePanel.tsx       # NEW: ダメージ表示パネル（BattleView に組み込み）
        DamageBar.tsx         # NEW: ダメージバー（色分け表示）
```

### 6.3 API コントラクト

#### POST `/calc/damage`（calc-service）

**リクエスト:**
```json
{
  "attacker": {
    "species_id": 6,
    "name": "Charizard",
    "types": ["fire", "flying"],
    "stats": { "hp": 153, "atk": 104, "def": 98, "spa": 161, "spd": 105, "spe": 152 },
    "ability": "blaze",
    "item": "charizardite-y",
    "boosts": { "atk": 0, "spa": 0 }
  },
  "defenders": [
    {
      "species_id": 149,
      "name": "Dragonite",
      "types": ["dragon", "flying"],
      "stats": { "hp": 197, "atk": 186, "def": 115, "spa": 120, "spd": 120, "spe": 100 },
      "ability": "multiscale",
      "item": null
    }
  ],
  "moves": [
    { "move_id": 394, "name": "Flamethrower", "type": "fire", "power": 90, "damage_class": "special" }
  ],
  "field": {
    "weather": null,
    "terrain": null,
    "is_doubles": false,
    "attacker_side": { "reflect": false, "light_screen": false },
    "defender_side": { "reflect": false, "light_screen": false }
  }
}
```

**レスポンス:**
```json
{
  "results": [
    {
      "defender_species_id": 149,
      "defender_hp": 197,
      "moves": [
        {
          "move_id": 394,
          "move_name": "Flamethrower",
          "damage": { "min": 72, "max": 85 },
          "min_percent": 36.5,
          "max_percent": 43.1,
          "guaranteed_ko": 3,
          "type_effectiveness": 0.5,
          "description": "36.5% - 43.1% (確3)"
        }
      ]
    }
  ]
}
```

#### POST `/api/damage`（Python Backend — フロントエンド向け軽量版）

フロントエンドは最小限のデータを送り、Python が GameData で補完して calc-service に転送:

```json
{
  "attacker_position": 1,
  "defender_species_ids": [149, 248, 445]
}
```

### 6.4 データフロー

```
パーティ登録完了 (useMyPartyStore)
  + 相手チーム認識 (useOpponentTeamStore)
     │
     ▼
useDamageCalc hook（debounce 300ms）
     │  POST /api/damage { attacker_position, defender_species_ids }
     ▼
Python /api/damage エンドポイント
     │  1. useMyPartyStore のデータから攻撃側の実数値・技・特性・持ち物を取得
     │  2. 相手の species_id → GameData で種族値・タイプ取得
     │  3. Champions 式で相手のステータス推定（stat_points 分布ヒューリスティクス）
     │  4. メガ進化判定（is_mega_stone → メガ種族値に差し替え）
     │  5. calc-service に enriched リクエスト送信
     ▼
calc-service /calc/damage
     │  1. @smogon/calc の Gen 9 で calculate()
     │  2. Pokemon オブジェクトに stat override を適用
     │  3. 4技 × N体 のダメージ範囲を一括計算
     ▼
レスポンス → Python → Frontend → useDamageCalcStore → DamagePanel 表示
```

### 6.5 相手ポケモンの未知情報の扱い

| 情報 | 自パーティ | 相手 |
|---|---|---|
| 種族 | OCR で確定 | アイコンマッチで確定 |
| ステータス | OCR で実数値取得済み | 種族値 + 推定 stat_points 配分で計算 |
| 技 | OCR で確定 | 不明（自パーティの技で攻撃した場合のダメージを計算） |
| 特性 | OCR で確定 | 不明 → 全候補で計算し worst/best case を表示 |
| 持ち物 | OCR で確定 | 不明 → なし前提（保守的） |
| 性格 | OCR で確定 | 不明 → 補正なし前提 |

stat_points 配分の推定ヒューリスティクス:
- 種族値から役割を推定（物理アタッカー、特殊アタッカー、耐久型など）
- 役割に応じて 66 ポイントを配分（例: 物理アタッカー → 32 atk / 32 spe / 2 hp）

### 6.6 Champions 新特性の扱い

@smogon/calc が知らない Champions 新特性は、calc-service 内で前処理/後処理:

| 特性 | 処理方法 |
|---|---|
| Dragonize | calculate() 前にノーマル技をドラゴンタイプに変更 + 1.2x 威力 |
| Mega Sol | Field に weather: "sun" をセット |
| Piercing Drill | まもる貫通の注釈を付与（ダメージ計算自体は変わらない） |
| Spicy Spray | 接触技でやけどの注釈を付与 |

### 6.7 dev.bat の更新

```batch
echo Starting calc-service (port 3100)...
start "PokeScouter Calc" cmd /k "cd /d %~dp0calc-service && npm run dev"
```

### 6.8 実装フェーズ

| Phase | 内容 | 目安 |
|---|---|---|
| 1 | calc-service 基盤（Express + @smogon/calc + Champions ステータス計算） | 3-4日 |
| 2 | Python Backend 連携（/api/damage + httpx client + データ補完） | 2-3日 |
| 3 | Frontend 連携（store + hook + DamagePanel） | 3-4日 |
| 4 | 相手ポケモン推定・逆算（相手の攻撃ダメージ予測） | 2日 |
| 5 | 開発環境整備（dev.bat 更新、テスト、ドキュメント） | 1日 |

---

## 7. まとめ

| 観点 | 結論 |
|---|---|
| OSS の充実度 | TypeScript エコシステム（Smogon 系）が圧倒的に成熟。Python 系は不活発 |
| Champions 対応 | 2026年4月時点でどの OSS ライブラリも未対応。NCP VGC Calculator（Web UI）が先行 |
| **採用アプローチ** | **@smogon/calc を Node.js マイクロサービスとしてそのまま利用** |
| 統合方法 | Gen 9 をベースに使用し、Champions ステータスは外側で計算して stat override で注入 |
| リファレンス | ステータス計算式 → NCP VGC Calculator、ダメージ計算 → @smogon/calc |
| 拡張性 | Showdown の Champions 対応（5-6月頃）後にパッケージ更新で自動追従可能 |
