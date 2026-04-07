# OCR構成

## 3エンジン同時起動（ローカルGPU完結）

1対戦あたり約33回のOCR呼び出しが発生するため、クラウドAPI（Azure月5,000回/Google月1,000回）では本番運用不可。ローカル実行一択。

| エンジン              | 役割                         | VRAM        | 速度/回 | ライセンス    |
| --------------------- | ---------------------------- | ----------- | ------- | ------------- |
| PaddleOCR PP-OCRv5    | HP数値読取り（リアルタイム） | ~0.5 GB     | ~50ms   | Apache 2.0    |
| manga-ocr             | ポケモン名認識（日本語特化） | ~0.5 GB     | ~30ms   | Apache 2.0    |
| GLM-OCR (0.9B)        | 選出画面の一括高精度認識     | ~2.5 GB     | ~300ms  | MIT           |
| (PyTorch等ランタイム) | —                            | ~2.0 GB     | —       | —             |
| **合計**              |                              | **~6.0 GB** |         | **空き ~6GB** |

## 処理フロー

```
選出画面           対戦画面（ターンごと）
GLM-OCR ──→  manga-ocr/PaddleOCR（名前）+ PaddleOCR（HP）
~300ms/1回        ~30-50ms/回
1回/試合           ~17-31回/試合
```

**M0テスト時のみ Azure Computer Vision（月5,000回無料）で精度上限を測定。**

## 第2ラウンド候補（精度不十分な場合）

Qwen2.5-VL (2B)、Dots.OCR (3B)、GOT-OCR (0.6B)

## OCRエンジン抽象化

```python
class OCREngine(ABC):
    @abstractmethod
    def recognize_text(self, image: np.ndarray, lang: str = "ja") -> list[OCRResult]: ...

class PaddleOCREngine(OCREngine): ...
class MangaOCREngine(OCREngine): ...
class GLMOCREngine(OCREngine): ...
```
