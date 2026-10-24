"""Generates the FreeWhen app icon set from the brand logo kit.

The mark is "The Focus Nexus" — two tangerine brackets locking onto the central
Meet Point node. Its geometry lives in `design/logo/kit/`, which is the single
source of truth; this script rasterises those vectors rather than redrawing the
mark in PIL. A redrawn glyph drifts from the masters the first time either side
is edited, and nobody notices until a store listing and the app disagree.

    python scripts/generate-icons.py

Rasterisation uses resvg via sharp, because the mark is built from SVG arc
segments that PIL cannot draw. The script is a one-off asset generator, not a
runtime dependency: re-run it only when the brand kit changes.
"""

from __future__ import annotations

import io
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "images"
KIT = ROOT / "design" / "logo" / "kit"
SYMBOL_VARIANTS = KIT / "variants" / "symbol"

# Style Guide §2.1 / src/theme/tokens.ts. Dark is `bg`, light is `bg_light`;
# both tile colours come from the brand guidelines' approved pairings.
ESPRESSO = "#170E0A"
TANGERINE = "#FF7A2F"
VOLT = "#D4FF3A"
BG_DARK = "#120A07"
BG_LIGHT = "#FBF5EF"

# Android adaptive icons mask the outer third of the canvas, so the mark has to
# sit inside a 66 % safe zone or the corners get clipped on a round launcher.
ADAPTIVE_SAFE_SCALE = 0.62

# Splash canvas matches the 1284x2778 default the old generator shipped.
SPLASH_SIZE = (1284, 2778)


def _node() -> str:
    node = os.environ.get("MIMO_NODE")
    if not node:
        raise SystemExit("MIMO_NODE is unset; sharp needs the bundled Node runtime")
    return node


def render(svg: str, size: int) -> bytes:
    """Rasterise an SVG string to PNG bytes at `size` x `size`."""
    node = _node()
    script = """
const sharp = require('sharp');
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', async () => {
  const input = Buffer.concat(chunks).toString('utf8');
  const payload = JSON.parse(input);
  const out = await sharp(Buffer.from(payload.svg), { density: 384 })
    .resize(payload.size, payload.size)
    .png({ compressionLevel: 9 })
    .toBuffer();
  process.stdout.write(out);
});
"""
    payload = json.dumps({"svg": svg, "size": size})
    result = subprocess.run(
        [node, "-e", script],
        input=payload.encode("utf-8"),
        capture_output=True,
        timeout=180,
    )
    if result.returncode != 0:
        raise SystemExit(result.stderr.decode("utf-8", "replace"))
    return result.stdout


def master_symbol() -> tuple[list[str], str]:
    """The 256-unit geometry split into (bracket paths, node circle).

    Split so the two parts can take different inks for the full-colour mark,
    without string-surgery on the master's markup.
    """
    raw = (KIT / "masters" / "freewhen-symbol.svg").read_text(encoding="utf-8")
    paths = re.findall(r'<path d="([^"]+)"\s*/>', raw)
    circle = re.search(r'<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"\s*/>', raw)
    if not paths or not circle:
        raise SystemExit("unexpected geometry in freewhen-symbol.svg")
    cx, cy, r = circle.groups()
    return paths, f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{{ink}}"/>'


def brackets(paths: list[str], ink: str) -> str:
    return "".join(f'<path d="{d}" fill="{ink}"/>' for d in paths)


def tile(parts: tuple[list[str], str], *, background: str | None, ink: str, scale: float = 1.0) -> str:
    """A square canvas with the whole mark centred, optionally scaled down."""
    paths, node = parts
    offset = (256 * (1 - scale)) / 2
    rect = f'<rect width="256" height="256" fill="{background}"/>' if background else ""
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">'
        f'{rect}<g transform="translate({offset} {offset}) scale({scale})">'
        f'{brackets(paths, ink)}{node.format(ink=ink)}</g>'
        "</svg>"
    )


def two_tone(parts: tuple[list[str], str], *, background: str, bracket: str, node: str) -> str:
    """Full-colour mark: brackets and Meet Point node in separate inks."""
    paths, node_shape = parts
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">'
        f'<rect width="256" height="256" fill="{background}"/>'
        f'{brackets(paths, bracket)}{node_shape.format(ink=node)}'
        "</svg>"
    )


def write(name: str, png: bytes) -> None:
    (OUT / name).write_bytes(png)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    parts = master_symbol()

    # --- iOS / universal -------------------------------------------------
    # Opaque tile: iOS applies its own mask and rejects transparency. Volt is
    # only legible on dark ink, which is why the dark tile is espresso and the
    # light tile swaps the node to espresso (brand guideline "approved
    # pairings" 1 and 2).
    write("icon.png", render(two_tone(parts, background=ESPRESSO, bracket=TANGERINE, node=VOLT), 1024))
    write("icon-light.png", render(two_tone(parts, background=BG_LIGHT, bracket=TANGERINE, node=ESPRESSO), 1024))
    # The tinted variant is flattened to greyscale by iOS and then tinted, so it
    # ships as a single-ink mark on the light ground: no colour survives anyway.
    write("icon-tinted.png", render(tile(parts, background=BG_LIGHT, ink=ESPRESSO), 1024))

    # --- Android adaptive ------------------------------------------------
    # Foreground must be transparent and pre-shrunk into the safe zone; the
    # background is a flat colour declared in app.json so the mask can move.
    foreground = tile(parts, background=None, ink=TANGERINE, scale=ADAPTIVE_SAFE_SCALE)
    write("adaptive-icon.png", render(foreground, 1024))
    write("foreground-image.png", render(foreground, 1024))

    # --- Android themed icon (monochrome layer) ---------------------------
    # Themed icons are recoloured by the launcher from a single-colour alpha
    # layer, so this is the mark at full opacity with no tile and no colour of
    # its own. Baking tangerine in here would defeat the launcher's tint.
    write(
        "monochrome-icon.png",
        render(tile(parts, background=None, ink="#FFFFFF", scale=ADAPTIVE_SAFE_SCALE), 1024),
    )

    # --- Splash ----------------------------------------------------------
    splash = Image.new("RGBA", SPLASH_SIZE, BG_DARK)
    glyph = Image.open(io.BytesIO(render(tile(parts, background=None, ink=TANGERINE), 1024)))
    side = int(min(SPLASH_SIZE) * 0.34)
    splash.alpha_composite(
        glyph.convert("RGBA").resize((side, side), Image.LANCZOS),
        ((SPLASH_SIZE[0] - side) // 2, int(SPLASH_SIZE[1] * 0.33)),
    )
    splash.save(OUT / "splash.png")

    # --- Web: favicons, PWA, Apple touch ---------------------------------
    write("favicon.png", render(tile(parts, background=BG_DARK, ink=TANGERINE), 48))

    web_icons = {
        "favicon-16.png": 16,
        "favicon-32.png": 32,
        "apple-touch-icon.png": 180,
        "icon-192.png": 192,
        "icon-512.png": 512,
    }
    for name, size in web_icons.items():
        write(name, render(tile(parts, background=BG_DARK, ink=TANGERINE), size))

    # Maskable PWA icon: the launcher may crop to a circle, so the mark is
    # inset well inside the 80 % maskable safe zone.
    write(
        "maskable-512.png",
        render(tile(parts, background=BG_DARK, ink=TANGERINE, scale=0.55), 512),
    )

    # Scalable favicon — browsers with SVG support get a sharp icon at any DPI.
    (OUT / "favicon.svg").write_text(
        tile(parts, background=BG_DARK, ink=TANGERINE), encoding="utf-8"
    )

    # --- Multi-resolution ICO --------------------------------------------
    frames = [Image.open(OUT / f).convert("RGBA") for f in ("favicon-16.png", "favicon-32.png")]
    frames += [Image.new("RGBA", (48, 48), BG_DARK)]
    frames[-1].alpha_composite(
        Image.open(io.BytesIO(render(tile(parts, background=None, ink=TANGERINE), 48))).convert("RGBA")
    )
    frames[-1].save(
        OUT / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
        append_images=frames[:2],
    )

    manifest = {
        "name": "FreeWhen",
        "short_name": "FreeWhen",
        "start_url": "/",
        "display": "standalone",
        "icons": [
            {"src": "/icon-192.png", "sizes": "192x192", "type": "image/png"},
            {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png"},
            {
                "src": "/maskable-512.png",
                "sizes": "512x512",
                "type": "image/png",
                "purpose": "maskable",
            },
        ],
        "theme_color": ESPRESSO,
        "background_color": BG_DARK,
    }
    (OUT / "site.webmanifest").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )

    # Expo copies `public/` verbatim into `dist/` on export, which is the only
    # way a file lands at the app's web root. `app.json`'s `web.favicon` covers
    # `favicon.ico` alone; the SVG, the per-size PNGs, the Apple touch icon and
    # the manifest all have to be served from here.
    public = ROOT / "public"
    public.mkdir(parents=True, exist_ok=True)
    for name in (
        "favicon.ico",
        "favicon.svg",
        "favicon-16.png",
        "favicon-32.png",
        "apple-touch-icon.png",
        "icon-192.png",
        "icon-512.png",
        "maskable-512.png",
        "site.webmanifest",
    ):
        shutil.copyfile(OUT / name, public / name)

    # The hand-written static pages in `web/` are served from a different root
    # than the app export, so they carry their own copy.
    static = ROOT / "web" / "icons"
    static.mkdir(parents=True, exist_ok=True)
    for name in ("favicon.ico", "favicon.svg", "apple-touch-icon.png"):
        shutil.copyfile(OUT / name, static / name)

    for path in sorted(OUT.iterdir()):
        if path.suffix in {".png", ".ico"}:
            with Image.open(path) as im:
                print(f"{path.name}: {im.size}")


if __name__ == "__main__":
    main()
