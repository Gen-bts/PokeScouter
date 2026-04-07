# OCR エンジン セットアップ手順書

PokeScouter で使用する 3 つの OCR エンジンを動作可能な状態にするまでの手順。

## 前提環境

| 項目 | 要件 |
|------|------|
| OS | Windows 11 |
| GPU | RTX 5070 (12GB VRAM) |
| Python | 3.10 以上 |
| CUDA | 12.9 以上（ドライバレベル） |

---

## Step 1: NVIDIA ドライバの確認

```bash
nvidia-smi
```

出力の右上に表示される `CUDA Version` が **12.9 以上** であることを確認する。

```
+-------------------------+
| NVIDIA-SMI 570.xx       |
| CUDA Version: 12.9      |
+-------------------------+
```

12.9 未満の場合は [NVIDIA ドライバ](https://www.nvidia.com/drivers/) を更新する。

---

## Step 2: Python 仮想環境の作成

```bash
cd c:\Code\personal\PokeScouter
python -m venv .venv
.venv\Scripts\activate
```

以降の全コマンドはこの仮想環境内で実行する。

---

## Step 3: PyTorch のインストール（CUDA 12.9）

```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu129
```

> **重要**: この手順を必ず最初に行う。後続の manga-ocr が依存解決で PyTorch を引っ張ると CPU 版がインストールされてしまう。

### 動作確認

```python
import torch
print(torch.cuda.is_available())       # True
print(torch.cuda.get_device_name(0))   # NVIDIA GeForce RTX 5070 等
print(torch.version.cuda)              # 12.9
```

---

## Step 4: PaddlePaddle GPU のインストール

```bash
pip install paddlepaddle-gpu==3.3.0 -i https://www.paddlepaddle.org.cn/packages/stable/cu129/
```

> **重要**: 標準 PyPI (`pip install paddlepaddle-gpu`) では古い CUDA 10.2 版がインストールされる。**必ず `-i` で PaddlePaddle 公式インデックスを指定する**こと。

### 動作確認

```python
import paddle
print(paddle.device.is_compiled_with_cuda())  # True
print(paddle.device.cuda.device_count())      # 1 以上
```

---

## Step 5: OCR エンジンのインストール

### 5-1. PaddleOCR（HP 数値読取り用）

```bash
pip install paddleocr
```

### 5-2. manga-ocr（ポケモン名認識用）

```bash
pip install manga-ocr
```

### 5-3. GLM-OCR 用ライブラリ（選出画面一括認識用）

```bash
pip install "transformers>=5.3.0" accelerate
```

---

## Step 6: プロジェクト依存のインストール

```bash
pip install fastapi uvicorn opencv-python-headless websockets numpy Pillow
```

---

## Step 7: モデルの初回ダウンロード・動作確認

初回実行時に各エンジンがモデルを自動ダウンロードする。ネットワーク環境によっては数分かかる。

### 7-1. PaddleOCR PP-OCRv5

```python
from paddleocr import PaddleOCR

ocr = PaddleOCR(
    text_detection_model_name="PP-OCRv5_mobile_det",
    text_recognition_model_name="PP-OCRv5_mobile_rec",
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=False,
    device="gpu:0",
)

# テスト用画像で動作確認（任意の画像パスに置き換える）
# result = ocr.predict("test_image.png")
print("PaddleOCR: OK")
```

- モデルサイズ: ~100MB
- `device="gpu:0"` を省略すると **CPU で動作する** ので注意

### 7-2. manga-ocr

```python
from manga_ocr import MangaOcr

mocr = MangaOcr()  # 初回は ~400MB のモデルをダウンロード

# テスト用画像で動作確認
# from PIL import Image
# text = mocr(Image.open("test_pokemon_name.png"))
# print(text)
print("manga-ocr: OK")
```

- CUDA を自動検出するため GPU 設定は不要
- インスタンス生成は起動時に 1 回だけ行い、使い回す

### 7-3. GLM-OCR (0.9B)

```python
from transformers import AutoProcessor, GlmOcrForConditionalGeneration
import torch

model_id = "zai-org/GLM-OCR"
processor = AutoProcessor.from_pretrained(model_id)  # 初回ダウンロード
model = GlmOcrForConditionalGeneration.from_pretrained(
    model_id,
    torch_dtype=torch.bfloat16,
    device_map="auto",
)

print(f"GLM-OCR: OK (device={model.device})")
```

- モデルサイズ: ~1.8GB
- `torch.bfloat16` で VRAM ~1.8GB に抑える（RTX 5070 は BF16 対応済み）

---

## VRAM 使用量の目安

全エンジンを同時にロードした場合:

| エンジン | VRAM |
|---------|------|
| PaddleOCR PP-OCRv5 (mobile) | ~0.5 GB |
| manga-ocr | ~0.5 GB |
| GLM-OCR (BF16) | ~1.8 GB |
| PyTorch 等ランタイム | ~2.0 GB |
| **合計** | **~4.8 GB** |
| **RTX 5070 空き** | **~7.2 GB** |

---

## トラブルシューティング

### `torch.cuda.is_available()` が False

- PyTorch が CPU 版でインストールされている。仮想環境を作り直し、Step 3 から再実行する
- `pip install torch` を `--index-url` なしで実行していないか確認

### PaddlePaddle が GPU を認識しない

- `pip show paddlepaddle-gpu` でバージョンが 3.2.1 以上であることを確認
- 公式インデックス (`-i https://www.paddlepaddle.org.cn/packages/stable/cu129/`) を指定してインストールし直す

### manga-ocr のモデルダウンロードが失敗する

- HuggingFace のキャッシュディレクトリ（デフォルト: `~/.cache/huggingface/`）に十分な空き容量があるか確認
- プロキシ環境の場合は `HF_ENDPOINT` 環境変数の設定が必要な場合がある

### GLM-OCR で `GlmOcrForConditionalGeneration` が見つからない

- `pip show transformers` でバージョンが 5.3.0 以上であることを確認
- `pip install --upgrade "transformers>=5.3.0"` で更新する

### bitsandbytes が Windows で動かない（GLM-OCR 量子化時のみ）

- bitsandbytes は Windows で不安定な場合がある
- 量子化なし（BF16）で運用すれば問題ない（VRAM は十分に余裕がある）

---

## 参考: 各エンジンの役割

| エンジン | 用途 | 速度目標 | 呼び出し頻度 |
|---------|------|---------|------------|
| PaddleOCR PP-OCRv5 | HP 数値読取り | ~50ms/回 | 毎ターン（17-31回/試合） |
| manga-ocr | ポケモン名認識（日本語） | ~30ms/回 | 毎ターン（17-31回/試合） |
| GLM-OCR (0.9B) | 選出画面の一括認識 | ~300ms/回 | 1回/試合 |
