"""Fetch Bulbagarden Champions menu sprites and rebuild the local manifest.

This script treats Bulbagarden's "Champions menu sprites" category as the
authoritative list of distinct menu sprites. It downloads the normal sprites
from the category, verifies that a corresponding shiny sprite exists for every
normal sprite, downloads both variants, and rebuilds
`templates/pokemon/manifest.json` so app keys resolve to the Champions art.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "templates" / "pokemon"
DEFAULT_SNAPSHOT_PATH = PROJECT_ROOT / "data" / "showdown" / "champions-bss-reg-ma" / "pokemon.json"
DEFAULT_FORMAT_PATH = PROJECT_ROOT / "data" / "showdown" / "champions-bss-reg-ma" / "format.json"
DEFAULT_OVERRIDE_PATH = PROJECT_ROOT / "data" / "champions_override" / "sprite_form_overrides.json"
DEFAULT_AUDIT_PATH = DEFAULT_OUTPUT_DIR / "champions_audit.json"
API_URL = "https://archives.bulbagarden.net/w/api.php"
CATEGORY_TITLE = "Category:Champions menu sprites"
USER_AGENT = "PokeScouter/0.1 (+https://github.com/openai/codex)"
REQUEST_DELAY = 0.02
TITLE_RE = re.compile(r"^File:Menu CP (\d{4})(?:-(.*))?\.png$")


@dataclass(frozen=True, slots=True)
class MenuSprite:
    title: str
    num: int
    form_label: str | None
    form_slug: str | None

    @property
    def filename(self) -> str:
        if self.form_slug:
            return f"{self.num}-{self.form_slug}.png"
        return f"{self.num}.png"

    @property
    def shiny_title(self) -> str:
        return self.title.removesuffix(".png") + " shiny.png"


def slugify_label(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_only.lower()).strip("-")
    return re.sub(r"-{2,}", "-", slug)


def parse_menu_cp_title(title: str) -> MenuSprite:
    match = TITLE_RE.match(title)
    if match is None:
        raise ValueError(f"Unsupported Bulbagarden title: {title}")

    num = int(match.group(1))
    form_label = match.group(2) or None
    form_slug = slugify_label(form_label) if form_label else None
    return MenuSprite(title=title, num=num, form_label=form_label, form_slug=form_slug)


def _api_get(params: dict[str, Any]) -> dict[str, Any]:
    url = f"{API_URL}?{urlencode(params)}"
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def fetch_category_titles(category_title: str = CATEGORY_TITLE) -> list[str]:
    titles: list[str] = []
    continuation: dict[str, Any] | None = None

    while True:
        params: dict[str, Any] = {
            "action": "query",
            "format": "json",
            "list": "categorymembers",
            "cmtitle": category_title,
            "cmtype": "file",
            "cmlimit": "500",
            "cmprop": "title",
        }
        if continuation:
            params.update(continuation)

        payload = _api_get(params)
        titles.extend(item["title"] for item in payload["query"]["categorymembers"])
        continuation = payload.get("continue")
        if not continuation:
            break

    return titles


def fetch_imageinfo(titles: list[str], batch_size: int = 25) -> dict[str, dict[str, Any]]:
    imageinfo: dict[str, dict[str, Any]] = {}
    for start in range(0, len(titles), batch_size):
        batch = titles[start : start + batch_size]
        payload = _api_get({
            "action": "query",
            "format": "json",
            "titles": "|".join(batch),
            "prop": "imageinfo",
            "iiprop": "url|size",
        })

        for page in payload["query"]["pages"].values():
            title = page.get("title")
            if not isinstance(title, str):
                continue
            entry = {"missing": "missing" in page}
            image_data = (page.get("imageinfo") or [{}])[0]
            if isinstance(image_data, dict):
                entry.update({
                    "url": image_data.get("url"),
                    "width": image_data.get("width"),
                    "height": image_data.get("height"),
                })
            imageinfo[title] = entry
    return imageinfo


def download_file(url: str, target_path: Path) -> None:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=60) as response:
        data = response.read()

    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_bytes(data)


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_form_overrides(path: Path) -> dict[str, dict[str, str]]:
    payload = load_json(path)
    return {
        "compact_suffix_to_form_slug": payload.get("compact_suffix_to_form_slug", {}),
        "key_form_slug_overrides": payload.get("key_form_slug_overrides", {}),
    }


def _candidate_suffixes_from_snapshot(key: str, pdata: dict[str, Any]) -> list[str]:
    suffixes: list[str] = []

    sprite_id = pdata.get("sprite_id")
    if isinstance(sprite_id, str) and "-" in sprite_id:
        suffix = "-".join(sprite_id.split("-")[1:])
        if suffix:
            suffixes.append(suffix.replace("-", ""))

    base_species_key = pdata.get("base_species_key")
    if isinstance(base_species_key, str) and key.startswith(base_species_key) and key != base_species_key:
        suffix = key[len(base_species_key) :]
        if suffix:
            suffixes.append(suffix)

    changes_from = pdata.get("changes_from")
    if isinstance(changes_from, str) and key.startswith(changes_from) and key != changes_from:
        suffix = key[len(changes_from) :]
        if suffix:
            suffixes.append(suffix)

    deduped: list[str] = []
    seen: set[str] = set()
    for suffix in suffixes:
        compact = re.sub(r"[^a-z0-9]+", "", suffix.lower())
        if not compact or compact in seen:
            continue
        seen.add(compact)
        deduped.append(compact)
    return deduped


def compact_suffix_to_form_slug(compact_suffix: str, overrides: dict[str, dict[str, str]]) -> str | None:
    compact = re.sub(r"[^a-z0-9]+", "", compact_suffix.lower())
    if not compact:
        return None

    override = overrides["compact_suffix_to_form_slug"].get(compact)
    if override:
        return override

    if compact == "f":
        return "female"

    return compact


def candidate_form_slugs_for_key(
    key: str,
    pdata: dict[str, Any],
    overrides: dict[str, dict[str, str]],
) -> list[str | None]:
    candidates: list[str | None] = []

    explicit = overrides["key_form_slug_overrides"].get(key)
    if explicit:
        candidates.append(explicit)

    for suffix in _candidate_suffixes_from_snapshot(key, pdata):
        slug = compact_suffix_to_form_slug(suffix, overrides)
        if slug:
            candidates.append(slug)

    candidates.append(None)

    deduped: list[str | None] = []
    seen: set[str | None] = set()
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        deduped.append(candidate)
    return deduped


def choose_sprite_for_key(
    key: str,
    pdata: dict[str, Any],
    available: dict[tuple[int, str | None], MenuSprite],
    overrides: dict[str, dict[str, str]],
) -> tuple[MenuSprite | None, str]:
    num = pdata.get("num")
    if not isinstance(num, int):
        return None, "missing_num"

    for form_slug in candidate_form_slugs_for_key(key, pdata, overrides):
        sprite = available.get((num, form_slug))
        if sprite is None:
            continue
        if form_slug is None:
            return sprite, "base_alias"
        return sprite, "distinct"
    return None, "unresolved"


def build_manifest_mapping(
    snapshot: dict[str, Any],
    available: dict[tuple[int, str | None], MenuSprite],
    overrides: dict[str, dict[str, str]],
) -> tuple[dict[str, str], dict[str, str]]:
    manifest: dict[str, str] = {}
    resolution_mode: dict[str, str] = {}

    for key, pdata in snapshot.items():
        if not isinstance(key, str) or not isinstance(pdata, dict):
            continue
        sprite, mode = choose_sprite_for_key(key, pdata, available, overrides)
        if sprite is None:
            continue
        manifest[key] = sprite.filename
        resolution_mode[key] = mode

    return manifest, resolution_mode


def collect_required_keys(snapshot: dict[str, Any], format_payload: dict[str, Any]) -> list[str]:
    required = list(format_payload.get("legal_pokemon_keys", []))
    legal_set = set(required)

    for key, pdata in snapshot.items():
        if not isinstance(key, str) or not isinstance(pdata, dict):
            continue
        sprite_id = pdata.get("sprite_id")
        base_species_key = pdata.get("base_species_key")
        if not isinstance(sprite_id, str) or "mega" not in sprite_id:
            continue
        if isinstance(base_species_key, str) and base_species_key in legal_set:
            required.append(key)

    deduped: list[str] = []
    seen: set[str] = set()
    for key in required:
        if key in seen:
            continue
        seen.add(key)
        deduped.append(key)
    return deduped


def verify_required_keys(required_keys: list[str], manifest: dict[str, str]) -> list[str]:
    return [key for key in required_keys if key not in manifest]


def rebuild_manifest(
    output_dir: Path,
    manifest: dict[str, str],
    category_titles: list[str],
    audit_path: Path,
    missing_shiny: list[str],
    required_missing: list[str],
    resolution_mode: dict[str, str],
) -> None:
    payload = {
        "_meta": {
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "key_format": "showdown",
            "source": "bulbagarden_champions_menu_sprites",
            "category_title": CATEGORY_TITLE,
            "distinct_normal_sprite_count": len(category_titles),
            "mapped_key_count": len(manifest),
        },
        "sprites": dict(sorted(manifest.items())),
    }
    (output_dir / "manifest.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    audit_payload = {
        "_meta": payload["_meta"],
        "normal_category_titles": category_titles,
        "missing_shiny_titles": missing_shiny,
        "required_missing_keys": required_missing,
        "resolution_mode_counts": {
            mode: count
            for mode, count in sorted(
                ((mode, list(resolution_mode.values()).count(mode)) for mode in set(resolution_mode.values())),
                key=lambda item: item[0],
            )
        },
        "mapped_keys": dict(sorted(manifest.items())),
    }
    audit_path.write_text(
        json.dumps(audit_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def run(args: argparse.Namespace) -> int:
    output_dir: Path = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    shiny_dir = output_dir / "shiny"
    shiny_dir.mkdir(parents=True, exist_ok=True)

    overrides = load_form_overrides(args.override_path)
    snapshot = load_json(args.snapshot_path)
    format_payload = load_json(args.format_path)

    category_titles = fetch_category_titles()
    menu_sprites = [parse_menu_cp_title(title) for title in category_titles]
    available = {(sprite.num, sprite.form_slug): sprite for sprite in menu_sprites}

    normal_info = fetch_imageinfo([sprite.title for sprite in menu_sprites])
    shiny_info = fetch_imageinfo([sprite.shiny_title for sprite in menu_sprites])

    missing_normal = [sprite.title for sprite in menu_sprites if normal_info.get(sprite.title, {}).get("missing")]
    missing_shiny = [sprite.shiny_title for sprite in menu_sprites if shiny_info.get(sprite.shiny_title, {}).get("missing")]
    if missing_normal or missing_shiny:
        print("Bulbagarden sprite audit failed.")
        if missing_normal:
            print(f"  missing normal: {len(missing_normal)}")
            for title in missing_normal[:20]:
                print(f"    {title}")
        if missing_shiny:
            print(f"  missing shiny: {len(missing_shiny)}")
            for title in missing_shiny[:20]:
                print(f"    {title}")
        rebuild_manifest(
            output_dir=output_dir,
            manifest={},
            category_titles=category_titles,
            audit_path=args.audit_path,
            missing_shiny=missing_shiny,
            required_missing=[],
            resolution_mode={},
        )
        return 1

    manifest, resolution_mode = build_manifest_mapping(snapshot, available, overrides)
    required_keys = collect_required_keys(snapshot, format_payload)
    required_missing = verify_required_keys(required_keys, manifest)
    if required_missing:
        print("Required Champions sprite mappings are missing.")
        for key in required_missing[:30]:
            print(f"  {key}")
        rebuild_manifest(
            output_dir=output_dir,
            manifest=manifest,
            category_titles=category_titles,
            audit_path=args.audit_path,
            missing_shiny=[],
            required_missing=required_missing,
            resolution_mode=resolution_mode,
        )
        return 1

    if not args.skip_download:
        for sprite in menu_sprites:
            normal_url = normal_info[sprite.title]["url"]
            shiny_url = shiny_info[sprite.shiny_title]["url"]
            if not isinstance(normal_url, str) or not isinstance(shiny_url, str):
                print(f"Missing image URL for {sprite.title}")
                return 1

            download_file(normal_url, output_dir / sprite.filename)
            time.sleep(REQUEST_DELAY)
            download_file(shiny_url, shiny_dir / sprite.filename)
            time.sleep(REQUEST_DELAY)

    rebuild_manifest(
        output_dir=output_dir,
        manifest=manifest,
        category_titles=category_titles,
        audit_path=args.audit_path,
        missing_shiny=[],
        required_missing=[],
        resolution_mode=resolution_mode,
    )

    unique_files = len(set(manifest.values()))
    print("Champions menu sprite fetch completed.")
    print(f"  category sprites: {len(menu_sprites)}")
    print(f"  manifest keys: {len(manifest)}")
    print(f"  canonical files: {unique_files}")
    print(f"  audit: {args.audit_path}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Fetch Bulbagarden Champions menu sprites and rebuild manifest.json",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"Sprite output directory (default: {DEFAULT_OUTPUT_DIR})",
    )
    parser.add_argument(
        "--snapshot-path",
        type=Path,
        default=DEFAULT_SNAPSHOT_PATH,
        help=f"Champions snapshot pokemon.json path (default: {DEFAULT_SNAPSHOT_PATH})",
    )
    parser.add_argument(
        "--format-path",
        type=Path,
        default=DEFAULT_FORMAT_PATH,
        help=f"Champions format.json path (default: {DEFAULT_FORMAT_PATH})",
    )
    parser.add_argument(
        "--override-path",
        type=Path,
        default=DEFAULT_OVERRIDE_PATH,
        help=f"Override JSON path (default: {DEFAULT_OVERRIDE_PATH})",
    )
    parser.add_argument(
        "--audit-path",
        type=Path,
        default=DEFAULT_AUDIT_PATH,
        help=f"Audit report path (default: {DEFAULT_AUDIT_PATH})",
    )
    parser.add_argument(
        "--skip-download",
        action="store_true",
        help="Run audit and manifest generation without downloading image files",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    try:
        raise SystemExit(run(args))
    except (HTTPError, URLError) as exc:
        print(f"Network error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
