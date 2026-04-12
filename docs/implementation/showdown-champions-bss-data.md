# Showdown Champions BSS データ調査

## 調査日: 2026-04-11

## 結論

Showdown の公開データから、Champions BSS で必要になるデータはほぼ取得可能です。

ただし、`1つのJSONを取得すれば完了` ではありません。実際には以下が必要です。

- ベースデータと `champions` 差分データのマージ
- フォーマット定義とルールの確認
- 最終的な合法判定については validator 相当のロジック確認

実務上の整理としては、

> BSS 用データベースを作ることは可能。ただし、公開 JSON を 1 本読むだけでは足りず、Showdown の mod 構造を理解して取り込む必要がある。

---

## 1. 取得できるもの

### BSS フォーマット定義

- `[Gen 9 Champions] BSS Reg M-A` が `mod: 'champions'` として定義されている
- ルールは `Flat Rules` と `VGC Timer`

### ベースのポケモン・技・持ち物・通常 learnset

Showdown 公開データ配下から取得できる。

- `play.pokemonshowdown.com/data/pokedex.json`
- `play.pokemonshowdown.com/data/moves.json`
- `play.pokemonshowdown.com/data/items.js` または `items.json`
- `play.pokemonshowdown.com/data/learnsets.js` または `learnsets.json`

### Champions 差分の技・持ち物・learnset

GitHub 公開リポジトリの `data/mods/champions/` から取得できる。

- `data/mods/champions/moves.ts`
- `data/mods/champions/items.ts`
- `data/mods/champions/learnsets.ts`

Showdown の mod 構造では、`mods` 配下のデータは base data を override できる。

---

## 2. 重要な前提

`champions` 側の `moves.ts` や `items.ts` はフルデータではなく差分定義です。

たとえば `inherit: true` で既存データを継承したうえで、`isNonstandard` や威力などを変更しているケースがあります。つまり、完全な一覧を作るには以下が必要です。

1. base data を読む
2. `champions` 差分を読む
3. species / moves / items / learnsets ごとにマージする

単純に `data/mods/champions/*.ts` だけを見ても完全な一覧にはなりません。

---

## 3. 具体例

### learnset は取得できる

`data/mods/champions/learnsets.ts` には種族ごとの習得技が列挙されている。

例:

- Venusaur に `acidspray`
- Venusaur に `amnesia`
- Venusaur に `earthpower`
- Venusaur に `grassyglide`

### 技差分は取得できる

`data/mods/champions/moves.ts` では、Champions 固有の差分が公開されている。

例:

- `revivalblessing` に `isNonstandard: "Custom"`
- `saltcure` に継続ダメージ処理の変更

### 持ち物差分は取得できる

`data/mods/champions/items.ts` では、使える持ち物・使えない持ち物の差分が公開されている。

例:

- `abomasite` は `isNonstandard: null`
- `abilityshield` は `isNonstandard: "Past"`

つまり、持ち物の復帰・除外情報も差分として取得できる。

---

## 4. 静的データだけでは足りない点

`BSS で最終的に合法か` を Showdown と同じ精度で判定するには、静的データだけでは不十分です。

理由:

- `Flat Rules` が `Obtainable` を含む
- `Obtainable Moves` などは `team-validator.ts` 側のハードコード判定も利用する

そのため、`そのポケモンが learnset 上でその技を持てる` だけでは、Showdown と 100% 同一の合法判定にはなりません。

合法判定を完全一致させたい場合は、validator ロジック込みで確認する必要があります。

---

## 5. BSS で必要な観点ごとの整理

### 使用可能なポケモン

明示的な `Champions BSS legal species 一覧` という 1 ファイルがあるわけではありません。

以下から導出する形になります。

- `Flat Rules` の禁止条件
- `champions` 側の種族データ
- learnset
- 各種フラグ

結論としては `取得は可能だが、組み立てが必要` です。

### 持ち物

取得可能です。

- base `items`
- `champions/items.ts`

この差分マージで一覧化できます。

### 技

取得可能です。

- base `moves`
- `champions/moves.ts`

この差分マージで一覧化できます。

### そのポケモンがその技を使えるか

取得可能です。

- `champions/learnsets.ts`

を使って判定できます。

### 最終的な合法性判定

データだけでかなり近いところまではいけますが、Showdown と同一判定にするなら validator ロジックが必要です。

---

## 6. 実装上の示唆

PokeScouter で Champions BSS 用データベースを作る場合、最低限必要なのは以下です。

1. base データ取得
2. `champions` 差分取得
3. マージ済み `pokemon / moves / items / learnsets` の生成
4. 必要に応じて validator 相当の合法判定レイヤー追加

注意点:

- `play.pokemonshowdown.com/data/*.json` だけでは Champions 専用差分は足りない
- GitHub 側の `data/mods/champions/` も取得対象に含める必要がある
- `learnset がある` と `BSS で合法` は同義ではない

---

## 7. 最終結論

Yes:

- Showdown 公開情報から、Champions BSS に必要なポケモン・持ち物・技・learnset は取得できる

ただし:

- base data と `champions` 差分のマージが必要
- 合法判定は validator ロジック込みで見る必要がある
- `play.pokemonshowdown.com/data/*.json` だけでは不十分で、GitHub の `data/mods/champions/` も必要

このため、`公開 JSON を 1 本読むだけで完結する` という理解は誤りで、`Showdown の mod 構造を前提にデータ統合する` のが正しい。
