"""DINOv2 + FAISS によるポケモンテンプレートのインデックス構築スクリプト.

全テンプレート PNG を DINOv2 ViT-S/14 に通して embedding を抽出し、
FAISS IndexFlatIP (cosine similarity) として保存する。

使い方::

    cd backend
    python -m tools.build_faiss_index

出力:
    templates/pokemon/faiss_index.bin   -- FAISS インデックス
    templates/pokemon/faiss_manifest.json -- ベクトル順の pokemon_key 配列
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from collections import defaultdict
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
_POKEMON_SNAPSHOT_PATH = (
    _PROJECT_ROOT / "data" / "showdown" / "champions-bss-reg-ma" / "pokemon.json"
)


def _alpha_to_bgr(img: np.ndarray) -> np.ndarray:
    """BGRA 画像を白背景の BGR に変換する."""
    alpha = img[:, :, 3:4] / 255.0
    bgr = img[:, :, :3]
    white = np.full_like(bgr, 255)
    composited = (bgr * alpha + white * (1 - alpha)).astype(np.uint8)
    return composited


def _load_sprite_manifest(template_dir: Path) -> dict[str, str]:
    manifest_path = template_dir / "manifest.json"
    if not manifest_path.exists():
        return {}

    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    if isinstance(payload, dict) and isinstance(payload.get("sprites"), dict):
        manifest = payload["sprites"]
    elif isinstance(payload, dict):
        manifest = payload
    else:
        return {}

    return {
        str(pokemon_key): str(filename)
        for pokemon_key, filename in manifest.items()
        if isinstance(pokemon_key, str) and isinstance(filename, str)
    }


def _load_pokemon_snapshot() -> dict[str, dict[str, object]]:
    if not _POKEMON_SNAPSHOT_PATH.exists():
        return {}

    payload = json.loads(_POKEMON_SNAPSHOT_PATH.read_text(encoding="utf-8"))
    return {
        str(pokemon_key): pdata
        for pokemon_key, pdata in payload.items()
        if isinstance(pokemon_key, str) and isinstance(pdata, dict)
    }


def _choose_representative_key(
    pokemon_keys: list[str],
    snapshot: dict[str, dict[str, object]],
) -> str:
    def sort_key(key: str) -> tuple[int, int, str]:
        pdata = snapshot.get(key, {})
        base_species_key = pdata.get("base_species_key")
        sprite_id = pdata.get("sprite_id")
        changes_from = pdata.get("changes_from")

        score = 0
        if key == base_species_key:
            score += 4
        if changes_from is None:
            score += 2
        if isinstance(sprite_id, str) and "-" not in sprite_id:
            score += 2

        return (-score, len(key), key)

    return min(pokemon_keys, key=sort_key)


def _collect_embedding_targets(
    template_dir: Path,
    sprite_manifest: dict[str, str],
    *,
    include_shiny: bool = False,
) -> list[tuple[Path, str]]:
    target_dir = template_dir / "shiny" if include_shiny else template_dir
    if not target_dir.is_dir():
        return []

    if not sprite_manifest:
        return [(path, path.stem) for path in sorted(target_dir.glob("*.png"))]

    snapshot = _load_pokemon_snapshot()
    grouped: dict[str, list[str]] = defaultdict(list)
    for pokemon_key, filename in sprite_manifest.items():
        grouped[filename].append(pokemon_key)

    targets: list[tuple[Path, str]] = []
    for filename in sorted(grouped):
        path = target_dir / filename
        if not path.exists():
            continue
        representative = _choose_representative_key(grouped[filename], snapshot)
        targets.append((path, representative))
    return targets


def _extract_embeddings_from_targets(
    targets: list[tuple[Path, str]],
    model: torch.nn.Module,
    transform: T.Compose,
    device: str,
    label: str = "",
) -> tuple[list[str], list[np.ndarray]]:
    """代表 pokemon_key と紐づく target PNG から embedding を抽出する."""
    if not targets:
        return [], []

    prefix = f"[{label}] " if label else ""
    logger.info("%s%d 枚を処理中...", prefix, len(targets))

    pokemon_keys: list[str] = []
    embeddings: list[np.ndarray] = []

    for png_path, pokemon_key in targets:
        img = cv2.imread(str(png_path), cv2.IMREAD_UNCHANGED)
        if img is None:
            logger.warning("読み込み失敗: %s", png_path)
            continue

        if img.ndim == 3 and img.shape[2] == 4:
            img = _alpha_to_bgr(img)

        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        tensor = transform(rgb).unsqueeze(0).to(device)

        with torch.no_grad():
            features = model(tensor)

        embedding = features.cpu().numpy().flatten()
        embedding = embedding / np.linalg.norm(embedding)

        pokemon_keys.append(pokemon_key)
        embeddings.append(embedding)

    return pokemon_keys, embeddings


def build_index(
    template_dir: Path = _DEFAULT_TEMPLATE_DIR,
    model_name: str = _DEFAULT_MODEL,
    device: str = "cuda",
    include_shiny: bool = True,
) -> None:
    """テンプレート画像群から FAISS インデックスを構築して保存する."""
    logger.info("DINOv2 モデル '%s' をロード中...", model_name)
    model = torch.hub.load("facebookresearch/dinov2", model_name)
    model = model.to(device).eval()
    sprite_manifest = _load_sprite_manifest(template_dir)

    # DINOv2 の前処理: 224x224, ImageNet 正規化
    transform = T.Compose([
        T.ToPILImage(),
        T.Resize((224, 224)),
        T.ToTensor(),
        T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])

    normal_targets = _collect_embedding_targets(template_dir, sprite_manifest)
    if not normal_targets:
        logger.error("テンプレート画像が見つかりません: %s", template_dir)
        sys.exit(1)

    t0 = time.perf_counter()

    # --- 通常色テンプレート ---
    normal_keys, normal_embeddings = _extract_embeddings_from_targets(
        normal_targets, model, transform, device, label="通常色",
    )

    # --- 色違いテンプレート ---
    shiny_keys: list[str] = []
    shiny_embeddings: list[np.ndarray] = []

    if include_shiny and (template_dir / "shiny").is_dir():
        shiny_targets = _collect_embedding_targets(
            template_dir, sprite_manifest, include_shiny=True,
        )
        shiny_keys, shiny_embeddings = _extract_embeddings_from_targets(
            shiny_targets, model, transform, device, label="色違い",
        )
    elif include_shiny:
        logger.info(
            "色違いディレクトリが見つかりません: %s (スキップ)",
            template_dir / "shiny",
        )

    # 結合
    pokemon_keys = normal_keys + shiny_keys
    embeddings = normal_embeddings + shiny_embeddings
    normal_count = len(normal_embeddings)
    shiny_count = len(shiny_embeddings)
    if not embeddings:
        logger.error("embedding を抽出できるテンプレート画像が見つかりません")
        sys.exit(1)

    elapsed = time.perf_counter() - t0
    logger.info(
        "%d 件の embedding を抽出 (通常=%d, 色違い=%d, %.1f秒, %.1fms/枚)",
        len(embeddings),
        normal_count,
        shiny_count,
        elapsed,
        elapsed / len(embeddings) * 1000,
    )

    # FAISS IndexFlatIP (内積 = 正規化済みベクトルの cosine similarity)
    embed_dim = embeddings[0].shape[0]
    embeddings_np = np.array(embeddings, dtype=np.float32)
    manifest_path = template_dir / "faiss_manifest.json"

    index = faiss.IndexFlatIP(embed_dim)
    index.add(embeddings_np)

    # 保存
    index_path = template_dir / "faiss_index.bin"

    faiss.write_index(index, str(index_path))
    manifest_path.write_text(
        json.dumps(pokemon_keys, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    logger.info("インデックス保存完了:")
    logger.info("  %s (%d vectors, %d dim)", index_path, index.ntotal, embed_dim)
    logger.info("  %s", manifest_path)

    # セルフリトリーバルテスト (同種族が最近傍なら正解)
    logger.info("セルフリトリーバルテスト実行中...")
    distances, indices = index.search(embeddings_np, 1)
    correct = sum(
        1
        for i, idx in enumerate(indices[:, 0])
        if pokemon_keys[idx] == pokemon_keys[i]
    )
    logger.info(
        "セルフリトリーバル精度: %d/%d (%.1f%%)",
        correct,
        len(embeddings),
        correct / len(embeddings) * 100,
    )

    # --- 色違い診断: 通常色と色違いの類似度分析 ---
    if shiny_count > 0:
        _report_shiny_similarity(
            normal_keys, normal_embeddings, shiny_keys, shiny_embeddings,
        )


def _report_shiny_similarity(
    normal_ids: list[str],
    normal_embeddings: list[np.ndarray],
    shiny_ids: list[str],
    shiny_embeddings: list[np.ndarray],
) -> None:
    """通常色と色違いの同種族ペアの cosine similarity を報告する."""
    normal_map: dict[str, np.ndarray] = dict(zip(normal_ids, normal_embeddings))
    high_sim = 0
    low_sim = 0
    pairs = 0

    for pid, shiny_emb in zip(shiny_ids, shiny_embeddings):
        normal_emb = normal_map.get(pid)
        if normal_emb is None:
            continue
        sim = float(np.dot(normal_emb, shiny_emb))
        pairs += 1
        if sim > 0.95:
            high_sim += 1
        elif sim < 0.80:
            low_sim += 1

    logger.info(
        "色違い類似度分析: %d ペア中 高類似(>0.95)=%d, 低類似(<0.80)=%d",
        pairs,
        high_sim,
        low_sim,
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
    parser.add_argument(
        "--no-shiny",
        action="store_true",
        help="色違いテンプレートを含めない",
    )
    args = parser.parse_args()

    build_index(
        template_dir=args.template_dir,
        model_name=args.model,
        device=args.device,
        include_shiny=not args.no_shiny,
    )


if __name__ == "__main__":
    main()
