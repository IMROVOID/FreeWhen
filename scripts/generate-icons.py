"""Generates the FreeWhen app icon set from the brand palette.

The tokens here are the Style Guide §2.1 palette values — the same ones in
src/theme/tokens.ts. This script is a one-off asset generator, not a runtime
dependency; re-run it only when the brand colours change.

    python scripts/generate-icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

ESPRESSO = (23, 14, 10, 255)
TANGERINE = (255, 122, 47, 255)
VOLT = (212, 255, 58, 255)
PEACH = (255, 211, 184, 255)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "images"


def rounded_square(size: int, radius_ratio: float, fill) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=int(size * radius_ratio), fill=fill
    )
    return img


def three_avatars(size: int) -> Image.Image:
    """Three overlapping participant discs — the product's core metaphor."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    unit = size / 100.0

    discs = [
        (38, 62, 20, PEACH),
        (62, 62, 20, TANGERINE),
        (50, 38, 24, VOLT),
    ]
    for cx, cy, r, colour in discs:
        draw.ellipse(
            (
                (cx - r) * unit,
                (cy - r) * unit,
                (cx + r) * unit,
                (cy + r) * unit,
            ),
            fill=colour,
        )
    return img


def build_icon(size: int) -> Image.Image:
    base = rounded_square(size, 0.22, ESPRESSO)
    base.alpha_composite(three_avatars(size))
    return base


def build_adaptive(size: int) -> Image.Image:
    """Android adaptive foreground: the glyph inside the 66% safe zone."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glyph = three_avatars(int(size * 0.62))
    offset = (size - glyph.width) // 2
    img.alpha_composite(glyph, (offset, offset))
    return img


def build_splash(width: int, height: int) -> Image.Image:
    img = Image.new("RGBA", (width, height), ESPRESSO)
    draw = ImageDraw.Draw(img)

    # Peach Glow, top to ~55% height (Style Guide §2.6).
    for y in range(height):
        t = y / max(1, height * 0.55)
        t = min(1.0, t)
        colour = tuple(
            int(PEACH[i] * (1 - t) + ESPRESSO[i] * t) for i in range(4)
        )
        draw.line([(0, y), (width, y)], fill=colour)

    glyph = three_avatars(int(min(width, height) * 0.34))
    offset = ((width - glyph.width) // 2, int(height * 0.33))
    img.alpha_composite(glyph, offset)
    return img


def build_favicon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glyph = three_avatars(size)
    img.alpha_composite(glyph)
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    build_icon(1024).save(OUT / "icon.png")
    build_adaptive(1024).save(OUT / "adaptive-icon.png")
    build_adaptive(1024).save(OUT / "foreground-image.png")
    build_splash(1284, 2778).save(OUT / "splash.png")
    build_favicon(48).save(OUT / "favicon.png")

    for path in sorted(OUT.glob("*.png")):
        with Image.open(path) as im:
            print(f"{path.name}: {im.size}")


if __name__ == "__main__":
    main()
