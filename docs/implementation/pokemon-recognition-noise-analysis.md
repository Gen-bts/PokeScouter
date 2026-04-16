# ポケモンアイコン認識 ノイズ分析・対策

## 概要

DINOv2 + FAISS によるポケモンアイコン認識において、特定のポケモンが無関係な認識対象のノイズ候補として頻出する問題を調査・対策した。

## 事象

### ガオガエン → デスバーン誤検出（2026-04-13）

**ログ**: `debug/battle_logs/20260413_142708_0182_001.jsonl` (vs Willicked)

| 時刻 | イベント | 内容 |
|------|---------|------|
| 14:27:21 | pokemon_identified | position 2 を **デスバーン** (runerigus) と認識 (confidence 0.662) |
| 14:27:32 | pokemon_correction | ユーザーが手動で **ガオガエン** (incineroar) に補正 |

**候補スコア** (position 2):
- デスバーン: 0.662
- オーロット: 0.660
- クレッフィ: 0.657
- オンバーン: 0.656

top-4 の差が **0.006 以内** — 実質判別不能。ガオガエンは候補にすら入っていなかった。

### ノイズ候補として頻出するポケモン

#### デスバーン (runerigus)

- HOME 画像フォールバック対象（`pokemon-image-recognition-research.md` に高リスクとして記載）
- 他のポケモン認識時の候補に頻繁に浮上:
  - `20260412_091223`: オーロット認識時の候補 3 位 (0.687)
  - `20260412_125808`: ゾロアーク認識時の候補 2 位 (0.671)

#### オーロット (trevenant)

- 全 28 バトルログ中 15 ファイルで出現
- Top-1 認識結果: 3 試合 (confidence 0.705〜0.732 — いずれも低い)
- ノイズ候補 (2 位以下): 12 回

| 本来のポケモン | 混同回数 |
|---------------|---------|
| ドヒドイデ | 6 |
| アシレーヌ | 4 |
| マスカーニャ | 2 |
| ハッサム | 2 |
| デスバーン | 2 |
| ケケンカニ | 2 |

## 根本原因

### embedding 空間の統計

- FAISS index: 612 ベクトル (384 次元, DINOv2 ViT-S/14)
- ポケモン間平均コサイン類似度: **0.801** (中央値 0.798, σ=0.095)
- 類似度 ≥ 0.70 のペア: **9,323 組**
- trevenant ↔ runerigus 類似度: **0.715**

DINOv2 の特徴空間がポケモンのインスタンス識別ではなく視覚的セマンティクスに偏っているため、見た目が異なるポケモン同士でも高い類似度を示す。

### HOME 画像フォールバックの影響

26 種が Pokémon HOME の 3D レンダー画像をフォールバックとして使用。ゲーム画面のスプライトとスタイルが異なるため、embedding が不正確になりノイズ源となる。

## 実施済み対策

### A1. confidence margin チェック

top-1 と top-2 のスコア差（margin）が閾値未満の場合、認識結果を「不確定 (uncertain)」として棄却する。

- **設定**: `recognition.pokemon_matcher.margin_threshold = 0.03`
- **対象ファイル**:
  - `backend/app/recognition/pokemon_matcher.py` — `DetailedMatchResult.is_uncertain` プロパティ、`identify()` の margin チェック
  - `backend/app/ws/battle.py` — UNCERTAIN ステータスのログ出力、JSONL 監査レコードに margin 記録
  - `backend/app/recognition/party_register.py` — 同様の margin チェック
- **効果**: 今回のケース（margin 0.002 < 0.03）を確実に棄却。誤検出よりも「認識失敗」として手動補正を促す

### A3. リーガルポケモンフィルタのログ強化

FAISS 検索空間を Regulation MA 合法ポケモンに絞り込むフィルタの適用状況を可視化。

- **ログ出力**: フィルタ適用時に `"FAISS legal filter: 612 → 478 vectors (134 removed)"` を記録
- **対象ファイル**:
  - `backend/app/recognition/pokemon_matcher.py` — `set_legal_pokemon()`, `_rebuild_filtered_index()` にログ追加
  - `backend/app/dependencies.py` — フィルタ未適用時の warning
- **効果**: 134 の非合法ポケモン（Mega 形態等）を候補から除外し、ノイズの全体量を削減

## 未実施の対策案（優先度順）

### 高優先度

#### A2. 閾値の引き上げ
- 現行 0.60 → 0.72〜0.75
- 効果: trevenant/runerigus の 0.66〜0.73 帯をリジェクト
- リスク: 正当な認識の一部もリジェクトされ OCR fallback 頼みに
- コスト: 設定変更のみ

### 中優先度

#### B4. テンプレート画像の差し替え
- デスバーン (#867) の HOME フォールバック画像を Champions ゲーム画面キャプチャに差し替え
- FAISS index の再構築が必要
- 効果: ドメインギャップの根本解消

#### B5. 構築時の embedding 品質監査
- `build_faiss_index.py` で k-nearest neighbor を分析し、他種との類似度が異常に高いテンプレートを自動レポート
- 効果: 問題テンプレートの事前特定

#### B6. OCR との ensemble 強化
- 「不確定」な候補に対して OCR 名前照合を追加判定材料にする
- 現状はアイコン認識失敗時のみ OCR fallback

### 低優先度（高コスト）

#### C7. 2 段階マッチングパイプライン
- Stage 1: pHash / 色ヒストグラムで top-50 絞り込み
- Stage 2: DINOv2 でリランキング
- 効果: 異なる特徴量空間の組み合わせでノイズ回避

#### C8. コンテキスト情報の活用
- パーティ内重複排除
- バトルログの技名・特性情報との照合
