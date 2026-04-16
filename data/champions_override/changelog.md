# Champions Override Changelog

## 2026-04-12 - 技名日本語補完 (`move_names_ja.json`)
- `names/ja.json` に無い Showdown 技キー向けに、PokeAPI CSV 由来の日本語名を 645 件マージ（`GameData.load` で `names.ja.moves` に統合）
- 再生成: `python tools/build_move_names_ja_from_pokeapi_csv.py`

## 2026-04-09 - NCP VGC Calc データ抽出
- 新メガシンカ: 46 種
- 種族値変更: 5 件（Meditite, Medicham, Mega Mawile, Mega Medicham, Mega Starmie）
- 技変更: 339 件（威力/クールダウン）
- 新技: 0 件
- 新とくせい: 4 件
- ソース: NCP VGC Damage Calculator (github.com/nerd-of-now/NCP-VGC-Damage-Calculator)
