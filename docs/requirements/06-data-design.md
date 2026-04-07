# データ設計：3層アーキテクチャ

## ディレクトリ構造

```
data/
├── base/                       # Layer 1: PokeAPIから初回取得
│   ├── pokemon.json            #   種族値・タイプ・特性
│   ├── moves.json              #   技データ
│   ├── abilities.json          #   特性データ
│   ├── types.json              #   タイプ相性表
│   └── mega_evolutions.json    #   メガシンカデータ
├── champions_override/         # Layer 2: Champions固有の差分
│   ├── pokemon_patch.json      #   変更された種族値等
│   ├── moves_patch.json        #   変更された技威力等
│   ├── new_entries.json        #   新メガシンカ等
│   └── changelog.md
├── seasons/                    # Layer 3: シーズン定義
│   ├── current.json            #   現在のシーズン参照
│   └── season1.json            #   使用可能ポケモン・ルール
└── names/                      # 多言語名辞書（OCR照合用）
    ├── ja.json / en.json / ko.json / zh.json
```

## 読込フロー

base読込 → championsパッチをディープマージ → シーズンでフィルタ

## 更新ワークフロー

| イベント           | 作業                                             |
| ------------------ | ------------------------------------------------ |
| 技威力が変更された | `moves_patch.json` に差分1行追加                 |
| 新メガシンカ追加   | `new_entries.json` に追記                        |
| 新シーズン開始     | `seasons/` にファイル追加、`current.json` 書換え |

## パッチ例（champions_override/pokemon_patch.json）

```json
{
  "_meta": { "game_version": "1.0.0", "last_updated": "2026-04-08" },
  "6": { "base_stats": { "spe": 108 } }
}
```
