"""
RightBoard media pipeline.

Takes the source photos downloaded from the old Taplink site and produces:
  assets/img/<id>-<width>.avif  + .webp      responsive photo derivatives
  assets/img/logo-rightboard.png             logo lockup, transparent, graphite
  assets/img/logo-rightboard-light.png       same lockup recolored for dark surfaces
  assets/img/badge-distributor.png           "official distributor" lockup, transparent
  assets/favicon-32.png, -180.png, -512.png  favicons from the brand icon
  content/manifest.json                      source of truth for <img> width/height + palette

Run:  python tools/pipeline.py
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "content" / "images"
OUT = ROOT / "assets" / "img"
CONTENT = ROOT / "content"

TIERS = (400, 800, 1200, 1600)
AVIF_QUALITY = 46
WEBP_QUALITY = 80

# Graphics that are not photos: handled separately from the responsive tiers.
GRAPHICS = {
    "69852163",  # RightBoard wordmark lockup, dark ink on white
    "69852070",  # "official distributor" lockup, dark ink on white
    "_favicon",
}


def mean_color(im: Image.Image) -> str:
    small = im.convert("RGB").resize((16, 16), Image.LANCZOS)
    pixels = list(small.getdata())
    n = len(pixels)
    r = sum(p[0] for p in pixels) // n
    g = sum(p[1] for p in pixels) // n
    b = sum(p[2] for p in pixels) // n
    return f"#{r:02x}{g:02x}{b:02x}"


def key_out_white(im: Image.Image, cut: int = 232) -> Image.Image:
    """Turn a dark-ink-on-white graphic into ink on a transparent background."""
    rgb = im.convert("RGB")
    w, h = rgb.size
    src = rgb.load()
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    dst = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b = src[x, y]
            lum = (0.299 * r + 0.587 * g + 0.114 * b)
            if lum >= cut:
                continue
            alpha = int(min(255, max(0, (cut - lum) * 255 / cut)))
            dst[x, y] = (r, g, b, alpha)
    return out


def recolor(img: Image.Image, hex_color: str) -> Image.Image:
    """Recolor a transparent ink graphic to a flat colour, keeping its alpha."""
    r = int(hex_color[1:3], 16)
    g = int(hex_color[3:5], 16)
    b = int(hex_color[5:7], 16)
    out = Image.new("RGBA", img.size, (r, g, b, 255))
    out.putalpha(img.getchannel("A"))
    return out


def trim(img: Image.Image, pad: int = 6) -> Image.Image:
    bbox = img.getchannel("A").getbbox()
    if not bbox:
        return img
    x0, y0, x1, y1 = bbox
    x0 = max(0, x0 - pad)
    y0 = max(0, y0 - pad)
    x1 = min(img.width, x1 + pad)
    y1 = min(img.height, y1 + pad)
    return img.crop((x0, y0, x1, y1))


def build_graphic(src_name: str, dst_name: str, crop=None, cut=232, light=None,
                  max_width: int = 600) -> dict:
    im = Image.open(SRC / src_name).convert("RGB")
    if crop:
        im = im.crop(crop)
    keyed = trim(key_out_white(im, cut))
    if keyed.width > max_width:
        scale = max_width / keyed.width
        keyed = keyed.resize((max_width, round(keyed.height * scale)), Image.LANCZOS)
    # WebP with alpha keeps the lockup crisp and light (~10x smaller than PNG here).
    keyed.save(OUT / dst_name, format="WEBP", quality=90, method=6, alpha_quality=100)
    info = {
        "file": dst_name,
        "width": keyed.width,
        "height": keyed.height,
    }
    if light:
        light_img = recolor(keyed, light)
        light_name = dst_name.replace(".webp", "-light.webp")
        light_img.save(OUT / light_name, format="WEBP", quality=90, method=6,
                       alpha_quality=100)
        info["light"] = light_name
    return info


def build_photo(stem: str) -> dict | None:
    source = None
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        candidate = SRC / f"{stem}{ext}"
        if candidate.exists():
            source = candidate
            break
    if source is None:
        return None

    im = Image.open(source).convert("RGB")
    sw, sh = im.size
    widths = sorted({min(t, sw) for t in TIERS} | {sw})
    widths = [w for w in widths if w >= 240]

    variants = []
    for width in widths:
        height = round(sh * width / sw)
        resized = im if width == sw else im.resize((width, height), Image.LANCZOS)
        avif = OUT / f"{stem}-{width}.avif"
        webp = OUT / f"{stem}-{width}.webp"
        try:
            resized.save(avif, format="AVIF", quality=AVIF_QUALITY)
        except Exception as exc:  # pragma: no cover - encoder availability
            print(f"  ! avif failed for {stem}-{width}: {exc}")
            avif = None
        resized.save(webp, format="WEBP", quality=WEBP_QUALITY, method=6)
        variants.append(
            {
                "width": width,
                "height": height,
                "avif": avif.name if avif else None,
                "webp": webp.name,
            }
        )

    return {
        "id": stem,
        "width": sw,
        "height": sh,
        "ratio": round(sw / sh, 4),
        "orientation": "portrait" if sh > sw else ("landscape" if sw > sh else "square"),
        "color": mean_color(im),
        "variants": variants,
    }


def build_favicons() -> list[dict]:
    source = SRC / "_favicon.png"
    if not source.exists():
        return []
    im = Image.open(source).convert("RGBA")
    made = []
    for size in (32, 180, 512):
        target = ROOT / "assets" / f"favicon-{size}.png"
        im.resize((size, size), Image.LANCZOS).save(target, optimize=True)
        made.append({"size": size, "file": target.name})
    return made


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    photos, graphics = [], {}

    photo_sources = sorted(
        p for p in SRC.iterdir()
        if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}
        and p.stem not in GRAPHICS
    )

    print(f"photos: {len(photo_sources)}")
    for path in photo_sources:
        entry = build_photo(path.stem)
        if entry:
            photos.append(entry)
            print(f"  {path.stem}: {entry['width']}x{entry['height']} {entry['color']} "
                  f"({len(entry['variants'])} tiers)")

    print("graphics:")
    graphics["logo"] = build_graphic(
        "69852163.jpg",
        "logo-rightboard.webp",
        crop=(16, 4, 380, 134),
        cut=234,
        light="#F6F2EA",
        max_width=560,
    )
    print(f"  logo {graphics['logo']['width']}x{graphics['logo']['height']}")
    graphics["badge"] = build_graphic(
        "69852070.jpg",
        "badge-distributor.webp",
        crop=None,
        cut=240,
        light="#F6F2EA",
        max_width=520,
    )
    print(f"  badge {graphics['badge']['width']}x{graphics['badge']['height']}")

    favicons = build_favicons()
    print(f"favicons: {len(favicons)}")

    manifest = {
        "generated_by": "tools/pipeline.py",
        "tiers": list(TIERS),
        "avif_quality": AVIF_QUALITY,
        "webp_quality": WEBP_QUALITY,
        "photo_count": len(photos),
        "graphics": graphics,
        "favicons": favicons,
        "photos": photos,
    }
    manifest_path = CONTENT / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")

    total = sum(f.stat().st_size for f in OUT.iterdir() if f.is_file())
    print(f"\nvariant files: {sum(len(p['variants']) * 2 for p in photos)}")
    print(f"assets/img total: {total / 1024 / 1024:.1f} MB")
    print(f"manifest: {manifest_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
