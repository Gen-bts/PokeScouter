# ポケモン画像認識 調査レポート

選出画面での相手ポケモン認識に必要な、画像ベースのポケモン判定手法について調査した結果をまとめる。

---

## 1. 先行事例

### Poke-Controller / Poke-Controller-Modified（最も関連性が高い）

- GitHub: [KawaSwitch/Poke-Controller](https://github.com/KawaSwitch/Poke-Controller), [Moi-poke/Poke-Controller-Modified](https://github.com/Moi-poke/Poke-Controller-Modified)
- Nintendo Switch自動化ツール。シリアル通信 + キャプチャボードで映像取得
- OpenCVテンプレートマッチング (`isContainTemplate()`) を使用
- マッチング指標: **ZNCC (Zero-mean Normalized Cross-Correlation)** — クリーンキャプチャで約99%の一致率
- テンプレート画像は `Template/` フォルダにPNG形式で格納、キャプチャ解像度 **1280x720** に合わせる必要あり
- 拡張版: [futo030/Poke-Controller-Modified-Extension](https://github.com/futo030/Poke-Controller-Modified-Extension)

### Qiita記事: 対戦画面からの6体抽出（ararabo氏）

- [記事リンク](https://qiita.com/ararabo/items/30080bcdcb4426ec0f77)
- OpenCVテンプレートマッチング + **HOG (Histogram of Oriented Gradients)** 特徴量抽出
- 初期精度は約50%にとどまる
- 課題として以下5点を特定:
  1. キャプチャボード由来の画像ノイズ
  2. 画面の傾き
  3. アイコン位置の特定
  4. 類似ポケモン間の分類
  5. 計算速度の制約

### YOLO + Tesseract 研究論文

- [ResearchGate論文](https://www.researchgate.net/publication/398898204): "Computer vision for Pokemon Battles: A YOLO and Tesseract-Based System"
- YOLOでスプライト検出 + Tesseract OCRで技名・ステータステキスト認識
- 公開ポケモンスプライトを拡張して15,000枚以上の学習データセットを作成
- 制御環境・実環境ともに高精度を達成

### FindThatPokemon（OpenCV テンプレートマッチング）

- GitHub: [WolfeTyler/FindThatPokemon-OpenCV-Template-Matching](https://github.com/WolfeTyler/FindThatPokemon-OpenCV-Template-Matching)
- `cv2.matchTemplate()` + `cv2.TM_CCOEFF` メソッド
- 前処理: 50%にリサイズ → グレースケール変換
- `cv2.minMaxLoc()` で最高一致位置を検出

### その他（画像認識ではないアプローチ）

| ツール | 手法 | 備考 |
|--------|------|------|
| Pokemon Battle Scope (公式, TPC + HEROZ) | ゲームデータ直接受信（将棋AIベース） | 非公開、画面認識ではない |
| CaptureSight | Switch本体メモリ直接読み取り | 改造前提、キャプボ非対応 |
| Pokemon Stream Tool | エミュレータメモリ読み取り | エミュレータ専用 |
| GoIV (Pokemon GO) | 固定UI座標 + OCR | 画面レイアウトが固定のPokemon GO専用 |

---

## 2. アプローチ比較

| 手法 | 精度 | 速度 | 学習データ | 適用場面 |
|------|------|------|------------|----------|
| **テンプレートマッチング (OpenCV)** | ~99% (固定レイアウト) | 高速 | 不要（テンプレート画像のみ） | 選出画面など固定UIレイアウト |
| **pHash (知覚ハッシュ)** | 前段フィルタとして有効 | 非常に高速 | 不要 | 候補絞り込み（全件比較回避） |
| **HOG特徴量** | ~50% (初期) | 中速 | 不要 | 照明変化がある環境 |
| **SIFT/ORB特徴量** | スケール・回転不変 | 低速 | 不要 | 可変スケールの場面（固定UIには過剰） |
| **YOLO / CNN** | 95%+ | GPU依存 | 必要（15,000枚〜） | バトル中の可変位置3Dモデル認識 |
| **メモリ直接読み取り** | 100% | リアルタイム | 不要 | 改造・エミュレータ環境のみ |

---

## 3. テンプレート画像の調達先

### スプライト・レンダー画像リポジトリ

| ソース | 解像度 | 内容 | URL |
|--------|--------|------|-----|
| **PokeAPI/sprites** (HOME) | 512x512 PNG | 全世代網羅。HOME公式レンダー含む | [GitHub](https://github.com/PokeAPI/sprites) |
| **Koi-3088/HomeImages** | 128x128 / 512x512 PNG | Pokemon HOMEレンダー特化 | [GitHub](https://github.com/Koi-3088/HomeImages) |
| **msikma/pokesprite** | 68x56 PNG | ボックスアイコン（PCボックス風） | [GitHub](https://github.com/msikma/pokesprite) |
| **smogon/sprites** | 各種 PNG/WebP | Showdownバトルスプライト | [GitHub](https://github.com/smogon/sprites) |
| **veekun/pokedex-media** | 世代別 | Gen I〜V スプライト tarball | [GitHub](https://github.com/veekun/pokedex-media) |
| **The Spriters Resource** | 各種 | コミュニティリッピング。全ゲーム網羅 | [Web](https://www.spriters-resource.com/) |
| **PokemonDB** | 各種 | 全ゲームのスプライトギャラリー | [Web](https://pokemondb.net/sprites) |

### Champions固有の状況（2026年4月時点）

- Championsは本日リリースのため、ゲーム固有のデータマインはまだ存在しない
- Pokemon HOMEとの連携があるため、HOME公式レンダーがゲーム内UIに近い可能性が高い
- The Spriters Resourceには今後数週間でリッピングが登場する見込み

### ライセンスについて

- 全てのポケモンスプライト/レンダーは **Nintendo / Creatures Inc. / GAME FREAK Inc. / TPC** の著作物
- コミュニティリポジトリ（PokeAPI, pokesprite等）はグレーゾーンで運用されている
- 個人・非商用ツールでの利用はリスク低だが、アセットの再配布は避けるべき
- テンプレート画像はバージョン管理から除外し（`.gitignore`）、ローカルのみで保持する

---

## 4. PokeScouter での採用方針

### 選出画面: pHash前段フィルタ + テンプレートマッチング

**理由:**
1. 選出画面はレイアウト固定 → 座標クロップ後のテンプレートマッチングが最も実用的
2. Poke-Controllerが同手法で Switch + キャプボ環境での実績あり（~99%精度）
3. 既存の `SceneDetector.match_template()` を拡張して実装コストを抑えられる
4. pHashで278種から上位10件に絞り込み → テンプレートマッチングは候補のみ実行で高速化

### テンプレート画像: PokeAPI/sprites Gen 9 SV画像

**理由:**
1. 256x256 PNGの3Dモデルレンダー、128x128にリサイズして使用
2. Champions登場の全ポケモンをカバー
3. National Dex番号でURLアクセス可能 → 一括DLスクリプトが容易
4. Championsの選出画面アイコンに最も近いスタイル（実機比較で確認済み）

### キャプチャボード固有の課題と対策

| 課題 | 対策 |
|------|------|
| モアレパターン | ZNCC（輝度正規化済み）を使用 |
| 輝度・コントラスト変動 | テンプレートマッチング前にヒストグラム正規化 |
| UI要素の微小な位置ずれ | クロップ領域にマージンを設定 |
| 圧縮アーティファクト | PNGテンプレート使用 + 閾値で吸収 |

### スプライト取得結果 (2026-04-08)

1025件中、大半は Gen 9 SV で取得成功。以下26体は Gen 7〜9 に画像がなく HOME にフォールバック:

| No. | ポケモン名 | 備考 |
|-----|-----------|------|
| 808 | メルタン | Let's Go 初出 |
| 809 | メルメタル | Let's Go 初出 |
| 824 | サッチムシ | 剣盾限定 (SV未登場) |
| 825 | レドームシ | 同上 |
| 826 | イオルブ | 同上 |
| 827 | クスネ | 同上 |
| 828 | フォクスライ | 同上 |
| 829 | ヒメンカ | 同上 |
| 830 | ワタシラガ | 同上 |
| 831 | ウールー | 同上 |
| 832 | バイウールー | 同上 |
| 835 | ワンパチ | 同上 |
| 836 | パルスワン | 同上 |
| 850 | ヤクデ | 同上 |
| 851 | マルヤクデ | 同上 |
| 852 | タタッコ | 同上 |
| 853 | オトスパス | 同上 |
| 862 | タチフサグマ | ガラルのすがた進化 |
| 864 | サニゴーン | ガラルのすがた進化 |
| 865 | ネギガナイト | ガラルのすがた進化 |
| 866 | バリコオル | ガラルのすがた進化 |
| 867 | デスバーン | ガラルのすがた進化 |
| 880 | パッチラゴン | 化石ポケモン (剣盾限定) |
| 881 | パッチルドン | 同上 |
| 882 | ウオノラゴン | 同上 |
| 883 | ウオチルドン | 同上 |

HOME画像は3Dレンダースタイルが異なるため、これらのポケモンはテンプレートマッチングの精度が低下する可能性がある。Championsに登場する場合は自前キャプチャでの差し替えを検討。

### 将来の拡張パス

- ゲーム固有アセットがリッピングされ次第、テンプレート画像を差し替え可能な構造にする
- バトル中の3Dモデル認識が必要になった場合は、YOLOv8ファインチューニングに移行
- HOME画像は学習データとしても利用可能
