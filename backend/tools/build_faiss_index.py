"""DINOv2 + FAISS によるポケモンテンプレートのインデックス構築スクリプト.

全テンプレート PNG を DINOv2 ViT-S/14 に通して embedding を抽出し、
FAISS IndexFlatIP (cosine similarity) として保存する。

使い方::

    cd backend
    python -m tools.build_faiss_index

出力:
    templates/pokemon/faiss_index.bin   -- FAISS インデックス
    templates/pokemon/faiss_ids.npy     -- pokemon_id の対応配列
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path

import cv2
import faiss
import numpy as np
import torch
import torchvision.transforms as T

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).parent.parent.parent
_DEFAULT_TEMPLATE_DIR = _PROJECT_ROOT / "templates" / "pokemon"
_DEFAULT_MODEL = "dinov2_vits14"


def _alpha_to_bgr(img: np.ndarray) -> np.ndarray:
    """BGRA 画像を白背景の BGR に変換する."""
    alpha = img[:, :, 3:4] / 255.0
    bgr = img[:, :, :3]
    white = np.full_like(bgr, 255)
    composited = (bgr * alpha + white * (1 - alpha)).astype(np.uint8)
    return composited


def build_index(
    template_dir: Path = _DEFAULT_TEMPLATE_DIR,
    model_name: str = _DEFAULT_MODEL,
    device: str = "cuda",
) -> None:
    """テンプレート画像群から FAISS インデックスを構築して保存する."""
    logger.info("DINOv2 モデル '%s' をロード中...", model_name)
    model = torch.hub.load("facebookresearch/dinov2", model_name)
    model = model.to(device).eval()

    # DINOv2 の前処理: 224x224, ImageNet 正規化
    transform = T.Compose([
        T.ToPILImage(),
        T.Resize((224, 224)),
        T.ToTensor(),
        T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])

    png_files = sorted(template_dir.glob("*.png"))
    if not png_files:
        logger.error("テンプレート画像が見つかりません: %s", template_dir)
        sys.exit(1)

    logger.info("テンプレート %d 枚を処理中...", len(png_files))
    t0 = time.perf_counter()

    pokemon_ids: list[int] = []
    embeddings: list[np.ndarray] = []

    for png_path in png_files:
        try:
            pokemon_id = int(png_path.stem)
        except ValueError:
            logger.debug("スキップ (非数値ファイル名): %s", png_path.name)
            continue

        img = cv2.imread(str(png_path), cv2.IMREAD_UNCHANGED)
        if img is None:
            logger.warning("読み込み失敗: %s", png_path)
            continue

        # RGBA → BGR
        if img.ndim == 3 and img.shape[2] == 4:
            img = _alpha_to_bgr(img)

        # BGR → RGB
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

        # 前処理 → バッチ次元追加
        tensor = transform(rgb).unsqueeze(0).to(device)

        with torch.no_grad():
            features = model(tensor)  # (1, embed_dim)

        # L2 正規化
        embedding = features.cpu().numpy().flatten()
        embedding = embedding / np.linalg.norm(embedding)

        pokemon_ids.append(pokemon_id)
        embeddings.append(embedding)

    elapsed = time.perf_counter() - t0
    logger.info(
        "%d 件の embedding を抽出 (%.1f秒, %.1fms/枚)",
        len(embeddings),
        elapsed,
        elapsed / len(embeddings) * 1000,
    )

    # FAISS IndexFlatIP (内積 = 正規化済みベクトルの cosine similarity)
    embed_dim = embeddings[0].shape[0]
    embeddings_np = np.array(embeddings, dtype=np.float32)
    ids_np = np.array(pokemon_ids, dtype=np.int32)

    index = faiss.IndexFlatIP(embed_dim)
    index.add(embeddings_np)

    # 保存
    index_path = template_dir / "faiss_index.bin"
    ids_path = template_dir / "faiss_ids.npy"

    faiss.write_index(index, str(index_path))
    np.save(str(ids_path), ids_np)

    logger.info("インデックス保存完了:")
    logger.info("  %s (%d vectors, %d dim)", index_path, index.ntotal, embed_dim)
    logger.info("  %s", ids_path)

    # セルフリトリーバルテスト
    logger.info("セルフリトリーバルテスト実行中...")
    distances, indices = index.search(embeddings_np, 1)
    correct = sum(
        1
        for i, idx in enumerate(indices[:, 0])
        if ids_np[idx] == ids_np[i]
    )
    logger.info(
        "セルフリトリーバル精度: %d/%d (%.1f%%)",
        correct,
        len(embeddings),
        correct / len(embeddings) * 100,
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="DINOv2 + FAISS ポケモンテンプレートインデックス構築",
    )
    parser.add_argument(
        "--template-dir",
        type=Path,
        default=_DEFAULT_TEMPLATE_DIR,
        help="テンプレート画像ディレクトリ",
    )
    parser.add_argument(
        "--model",
        default=_DEFAULT_MODEL,
        help="DINOv2 モデル名 (default: dinov2_vits14)",
    )
    parser.add_argument(
        "--device",
        default="cuda" if torch.cuda.is_available() else "cpu",
        help="デバイス (default: cuda if available)",
    )
    args = parser.parse_args()

    build_index(
        template_dir=args.template_dir,
        model_name=args.model,
        device=args.device,
    )


if __name__ == "__main__":
    main()
