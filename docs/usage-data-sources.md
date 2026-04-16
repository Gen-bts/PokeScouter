# 使用率データソース運用ガイド

## 概要

PokeScouter は外部サイトから取得したポケモンの使用率データ（技・持ち物・特性等の採用率）を
ダメージ計算や相手ポケモンの型推定に利用する。
データソースは設定で切り替え可能で、新しいソースの追加も容易な設計になっている。

## データフロー

```
[外部ソース]              [スクレイパー]                    [正規 JSON]
Pikalytics          → fetch_pikalytics_usage.py    → data/pikalytics/championspreview.json
champions-stats     → fetch_champions_stats.py     → data/champions_stats/single.json
                                                          │
                                          settings.toml   │  usage_source = "..."
                                                          ↓
                                          game_data.py: _USAGE_SOURCES[usage_source]
                                                          ↓
                                          REST API / WebSocket / ダメージ計算
```

各スクレイパーが正規フォーマットで出力する責務を持つ。中間変換レイヤーは不要。

---

## 正規フォーマット (Canonical Schema)

全てのソースが出力すべき統一 JSON 形式。

### 構造

```json
{
  "_meta": {
    "source": "(必須) ソース識別子 e.g. 'pikalytics', 'pokemon-champions-stats'",
    "format": "(必須) ゲームフォーマット e.g. 'single', 'double', 'championspreview'",
    "fetched_at": "(必須) ISO 8601 タイムスタンプ",
    "pokemon_count": "(必須) pokemon 辞書のエントリ数"
  },
  "pokemon": {
    "<showdown_key>": {
      "moves":      [{"move_key": "str", "usage_percent": 0.0}],
      "items":      [{"item_key": "str", "usage_percent": 0.0}],
      "abilities":  [{"ability_key": "str", "usage_percent": 0.0}],
      "teammates":  [{"pokemon_key": "str", "usage_percent": 0.0}],
      "usage_percent": 0.0,
      "natures":    [{"nature_key": "str", "usage_percent": 0.0}],
      "ev_spreads": [{"spread": {"hp": 0, "atk": 0, "def": 0, "spa": 0, "spd": 0, "spe": 0}, "usage_percent": 0.0}]
    }
  }
}
```

### フィールド定義

| フィールド | 必須/任意 | 説明 |
|---|---|---|
| `moves` | **必須** | 技の採用率。`move_key` は Showdown キー |
| `items` | **必須** | 持ち物の採用率。`item_key` は Showdown キー |
| `abilities` | **必須** | 特性の採用率。`ability_key` は Showdown キー |
| `teammates` | 任意 | 同じチームに入るポケモン。`pokemon_key` は Showdown キー |
| `usage_percent` | 任意 | ポケモン自体の使用率 (%) |
| `natures` | 任意 | 性格の採用率。`nature_key` は Showdown キー (e.g. `jolly`) |
| `ev_spreads` | 任意 | 努力値配分パターンと採用率 |

`game_data.py` は必須フィールドのみに依存する。任意フィールドは存在すれば透過的に API に渡される。

### キー形式

全ての `*_key` は **Showdown key 形式** (小文字英数字のみ、記号除去)。

例: `Garchomp` → `garchomp`, `Focus Sash` → `focussash`, `Rough Skin` → `roughskin`

---

## 利用可能なソース

### pikalytics (デフォルト)

- **URL**: https://pikalytics.com/ai/pokedex/championspreview
- **スクリプト**: `scripts/fetch_pikalytics_usage.py`
- **出力**: `data/pikalytics/championspreview.json`
- **提供データ**: moves, items, abilities, teammates, usage_percent
- **特徴**: AI 向け Markdown エンドポイントがあり安定。英語名で返されるため変換がシンプル
- **更新頻度**: サイト側の更新に依存

```bash
# 全件取得 (format.json の legal_pokemon_keys 全件)
python scripts/fetch_pikalytics_usage.py

# インデックス上位のみ (軽量)
python scripts/fetch_pikalytics_usage.py --source index

# フォーマット確認 (2-3体のみ)
python scripts/fetch_pikalytics_usage.py --probe
```

### champions_stats

- **URL**: https://pokemon-champions-stats.vercel.app/
- **スクリプト**: `scripts/fetch_champions_stats.py`
- **出力**: `data/champions_stats/single.json`
- **提供データ**: moves, items, abilities, teammates, **natures, ev_spreads**
- **特徴**: ゲーム内ランキングから手動集計。性格・努力値配分を含む唯一のソース
- **注意**: ファンサイト。HTML スクレイピングのため、サイト構造変更で要修正
- **依存**: `beautifulsoup4` (`pip install beautifulsoup4`)

```bash
# 全件取得 (シングル)
python scripts/fetch_champions_stats.py

# HTML構造確認 (2体のみ)
python scripts/fetch_champions_stats.py --probe

# リクエスト間隔変更
python scripts/fetch_champions_stats.py --delay 2.0
```

---

## ソース切り替え手順

1. `backend/config/settings.toml` を編集:

```toml
[data]
usage_source = "champions_stats"   # または "pikalytics"
```

2. バックエンドを再起動:

```bash
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

3. ログで確認:

```
使用率データ読み込み完了: source=champions_stats, 120 件
```

未知のソース名を指定した場合は警告ログが出て `pikalytics` にフォールバックする。

---

## 新しいソースを追加する手順

### 1. スクレイパースクリプトを作成

`scripts/fetch_<source_name>.py` を作成。以下を満たすこと:

- 出力が正規フォーマットに準拠（上記 Canonical Schema 参照）
- 全てのキーが Showdown key 形式
- `_meta` にソース情報とタイムスタンプを含む
- `--probe` モードで構造確認ができる
- 適切なリクエスト間隔 (ファンサイトは 1 秒以上推奨)

### 2. `game_data.py` にソースを登録

`backend/app/data/game_data.py` の `_USAGE_SOURCES` にエントリを追加:

```python
_USAGE_SOURCES: dict[str, str] = {
    "pikalytics": "pikalytics/championspreview.json",
    "champions_stats": "champions_stats/single.json",
    "new_source": "new_source/output.json",       # ← 追加
}
```

### 3. 設定テンプレートを更新

`backend/config/settings.example.toml` の `[data]` セクションのコメントに新ソースを追記。

### 4. このドキュメントを更新

「利用可能なソース」セクションに新ソースの情報を追記。

### 5. CLAUDE.md を更新

スクリプトの実行コマンドを追記。

---

## トラブルシューティング

### 使用率データが読み込まれない

1. JSON ファイルが存在するか確認: `ls data/<source>/`
2. `settings.toml` の `usage_source` がファイル名と一致しているか確認
3. JSON が正規フォーマットに準拠しているか確認 (`_meta` と `pokemon` キーが必要)

### スクレイピングが失敗する

- **429 エラー**: リクエスト間隔を増やす (`--delay 3.0`)
- **HTML 構造変更**: `--probe` で現在の構造を確認し、パーサーを修正
- **名前解決失敗**: スクリプト実行後の `Unresolved names` サマリーを確認。
  `data/names/ja.json` や `champions_override/` にエントリを追加

### ソース間のデータ差異

各ソースは異なる集計方法・母集団を持つ。数値が一致しないのは正常。
ソースの選択は用途に応じて判断する:
- **安定性重視** → pikalytics (API が安定)
- **性格・努力値が必要** → champions_stats (独自データ)
