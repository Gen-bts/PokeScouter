# データ収集：調査結果と方針

## 調査日: 2026-04-09

チャンピオンズ発売日（2026-04-08）翌日時点での調査結果。

---

## 1. データソース調査結果

### Layer 1（base/）向け: PokeAPI

- **リポジトリ**: `PokeAPI/pokeapi` の `data/v2/csv/` に178個のCSVファイル
- **取得方法**: `git clone` で一括取得可能
- **ライセンス**: BSD-3
- **チャンピオンズ対応**: なし（Gen9/SVまで）
- **用途**: ベースデータとして最適。チャンピオンズの201体の大半は本編と種族値・技が共通

主要CSVファイル:

| ファイル | 内容 |
|---------|------|
| `pokemon_stats.csv` | 種族値（HP/Atk/Def/SpA/SpD/Spe） |
| `moves.csv` + `move_meta.csv` | 技データ（威力/タイプ/分類/命中） |
| `type_efficacy.csv` | タイプ相性表 |
| `items.csv` + `item_prose.csv` | もちもの |
| `abilities.csv` + `ability_prose.csv` | とくせい |
| `pokemon_species_names.csv` | 多言語名（OCR照合用） |

### Layer 2（champions_override/）向け: コミュニティソース

| ソース | 内容 | データ取得可能性 |
|--------|------|-----------------|
| **NCP VGC Damage Calc** (GitHub OSS) | VGCダメ計、JS内にデータあり | OSS、データ抽出可能 |
| **Porygon Labs** | ダメ計+チームビルダー、Reg Ma対応 | クローズドソース |
| **Champions Lab** | 201体Pokedex、58メガ、200万戦シミュ | クローズドソース |
| **ポケモン徹底攻略** (yakkun.com) | 種族値・技・とくせい網羅、チャンピオンズ対応済 | APIなし、HTML |
| **Pikalytics** | 使用率統計・ティアリスト | Web UIのみ |

### ダメージ計算式参考: Smogon

- `smogon/damage-calc` の TypeScript ソースに世代別ダメージ計算式が網羅
- `@smogon/calc/adaptable` でカスタムデータ層を接続可能

---

## 2. Pokémon Showdown 対応状況

### 現状（2026-04-09）

- `smogon/pokemon-showdown` の `formats.ts` に **Champions フォーマット定義なし**
- Smogon は SV OU に Champions OU サスペクトラダーを開始（メガシンカのみテスト）
- **IV廃止・Lv50制限は「技術的制約で未実装」** と明記

### 過去の対応実績

| ゲーム | 発売日 | Showdown対応 |
|--------|--------|-------------|
| SV (Gen9) | 2022/11/18 | 発売当日 |
| 剣盾 (Gen8) | 2019/11/15 | ほぼ同時 |

### チャンピオンズが遅れている理由

1. 新世代ではなくスピンオフ的立ち位置（新ポケモン追加なし）
2. メカニクスの大幅変更（IV廃止、PP変更、メガ優先度変更、オムニリング）
3. シミュレータのコア部分に手を入れる必要がある

### 予測タイムライン

| 時期 | 見込み |
|------|--------|
| 〜4月下旬 | データマイン完了、コミュニティでデータ整理 |
| 5〜6月 | Showdown に Champions mod として基本対応 |
| 〜8月 | WCS向けに安定対応（WCSがChampionsで開催） |

---

## 3. チャンピオンズ固有の差分ポイント

ダメージ計算・データ構造に影響する変更点:

- **個体値（IV）廃止** → ステータス計算式の変更
- **PP仕様の変更** → 技ごとのPP値パッチが必要
- **新規メガシンカ** → 58種（一部チャンピオンズ限定の可能性）
- **メガシンカ優先度** → 交代より先にメガシンカ発動
- **オムニリング** → 全ギミック使用可能（テラスタル、Z技、ダイマックス等）
- **一部ポケモンの種族値変更** の可能性

---

## 4. 採用方針

### 即時実行（Phase 1）

```
PokeAPI CSV → Python変換スクリプト → data/base/ (JSON)
```

1. PokeAPI の CSV を取得
2. 変換スクリプトで `pokemon.json`, `moves.json`, `abilities.json`, `types.json` を生成
3. `pokemon_species_names.csv` から `data/names/ja.json` 等を生成

### 差分パッチ（Phase 2）

```
NCP VGC Calc + ポケ徹参照 → data/champions_override/ (JSON)
```

1. NCP VGC Damage Calc のJS内データを抽出・照合
2. ポケ徹で差分を確認（種族値変更・新メガシンカ・PP変更）
3. `pokemon_patch.json`, `moves_patch.json`, `new_entries.json` に手動パッチ

### 将来的な補正（Phase 3）

```
Showdown対応後 → データ照合・補正
```

Showdown が Champions 対応した時点で `@pkmn/dex` 等からクリーンなデータを取得し、
既存データと照合・補正する。
