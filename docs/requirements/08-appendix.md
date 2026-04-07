# 付録

## 付録A: 技術スタック

### バックエンド

| 項目                   | 技術                                            |
| ---------------------- | ----------------------------------------------- |
| 言語                   | Python 3.10+                                    |
| Webフレームワーク      | FastAPI + Uvicorn                               |
| GPU                    | RTX 5070 / CUDA                                 |
| OCR                    | PaddleOCR PP-OCRv5 / manga-ocr / GLM-OCR (0.9B) |
| テンプレートマッチング | OpenCV                                          |
| データ                 | JSON（3層構造）                                 |

### フロントエンド

| 項目           | 技術                                |
| -------------- | ----------------------------------- |
| 映像キャプチャ | navigator.mediaDevices + Canvas API |
| UI             | HTML / CSS / JavaScript             |
| 通信           | WebSocket + fetch (REST)            |

---

## 付録B: 参考リンク

- [PBASV 自動ダメージ計算サイト](https://pbasv.cloudfree.jp/)（ソースコード公開）
- [PBASV 技術解説ブログ](https://hfps4469.hatenablog.com/entry/2024/04/02/020442)
- [PokeAPI](https://pokeapi.co/)（ベースデータ取得元）
- [Pokémon Champions 公式サイト](https://www.pokemonchampions.jp/ja/)

---

## 付録C: OCR候補一覧（調査結果）

M0のテスト対象として選定した3エンジン以外に、以下を調査済み。精度不十分時の代替候補。

| 候補          | パラメータ | 日本語精度 | 速度   | ライセンス | 備考                                   |
| ------------- | ---------- | ---------- | ------ | ---------- | -------------------------------------- |
| Tesseract     | —          | △          | ◎(CPU) | Apache 2.0 | 先行事例での定番。日本語精度に難       |
| EasyOCR       | —          | ○          | △(CPU) | Apache 2.0 | 導入容易だがPaddleOCRに全面劣後        |
| Surya         | —          | ○〜◎       | ○      | GPLv3      | 多機能だがライセンスに注意             |
| GOT-OCR       | 0.6B       | ○〜◎       | ○      | Apache 2.0 | 軽量VLM。第2ラウンド候補               |
| Qwen2.5-VL    | 2B         | ◎          | △〜○   | Apache 2.0 | 画面理解+OCR。第2ラウンド候補          |
| MiniCPM-o     | 8B         | ◎          | △      | Apache 2.0 | VRAM 12GBでは厳しい                    |
| Dots.OCR      | 3B         | ◎          | ○      | Apache 2.0 | ベンチマークトップ級。第2ラウンド候補  |
| Azure Vision  | —          | ◎◎         | ◎      | 月5k無料   | M0ベンチマーク用。本番不可（回数制限） |
| Google Vision | —          | ◎◎         | ◎      | 月1k無料   | Azureより無料枠少。不採用              |
