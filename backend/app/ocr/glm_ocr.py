"""GLM-OCR (0.9B) エンジンラッパー."""

from __future__ import annotations

import numpy as np
from PIL import Image

from app.ocr.base import OCREngine, OCRResult

_DEFAULT_PROMPT = "画像内のテキストを全て読み取ってください。"


class GLMOCREngine(OCREngine):
    """GLM-OCR (0.9B) による高精度テキスト認識.

    主な用途: 選出画面の一括認識（~300ms/回, 1回/試合）
    Vision-Language Model のためプロンプト指定が可能。
    """

    def __init__(
        self,
        *,
        model_id: str = "zai-org/GLM-OCR",
        prompt: str = _DEFAULT_PROMPT,
        max_new_tokens: int = 512,
    ) -> None:
        self._model_id = model_id
        self._prompt = prompt
        self._max_new_tokens = max_new_tokens
        self._processor: object | None = None
        self._model: object | None = None

    @property
    def engine_name(self) -> str:
        return "glm"

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    def load(self) -> None:
        if self._model is not None:
            return
        import torch
        from transformers import AutoProcessor, GlmOcrForConditionalGeneration

        self._processor = AutoProcessor.from_pretrained(self._model_id)
        self._model = GlmOcrForConditionalGeneration.from_pretrained(
            self._model_id,
            torch_dtype=torch.bfloat16,
            device_map="auto",
        )

    def unload(self) -> None:
        self._model = None
        self._processor = None
        import gc

        import torch
        gc.collect()
        torch.cuda.empty_cache()

    @property
    def prompt(self) -> str:
        return self._prompt

    @prompt.setter
    def prompt(self, value: str) -> None:
        self._prompt = value

    def recognize(self, image: np.ndarray, lang: str = "ja") -> list[OCRResult]:
        if self._model is None or self._processor is None:
            raise RuntimeError("エンジン未ロード。先に load() を呼んでください。")

        # BGR (OpenCV) → RGB (PIL)
        rgb = image[:, :, ::-1]
        pil_image = Image.fromarray(rgb)

        generated_text = self._run_inference(pil_image)

        # 改行で分割して複数結果に
        lines = [line.strip() for line in generated_text.split("\n") if line.strip()]
        if not lines:
            return []

        return [
            OCRResult(
                text=line,
                confidence=1.0,  # 生成モデルのため個別信頼度なし
                bounding_box=None,
                raw={"generated_text": generated_text},
            )
            for line in lines
        ]

    def _run_inference(self, pil_image: Image.Image) -> str:
        """PIL 画像に対して推論を実行し、生成テキストを返す."""
        import torch

        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": pil_image},
                    {"type": "text", "text": self._prompt},
                ],
            }
        ]

        text_input = self._processor.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
        inputs = self._processor(
            text=[text_input],
            images=[pil_image],
            return_tensors="pt",
            padding=True,
        ).to(self._model.device)

        with torch.inference_mode():
            output_ids = self._model.generate(
                **inputs,
                max_new_tokens=self._max_new_tokens,
            )

        # 入力トークン部分を除去してデコード
        input_len = inputs["input_ids"].shape[1]
        generated_ids = output_ids[:, input_len:]
        text: str = self._processor.batch_decode(
            generated_ids, skip_special_tokens=True
        )[0]
        return text.strip()
