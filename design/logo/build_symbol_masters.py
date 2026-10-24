import subprocess
import os

kit_dir = "R:/More/Projects/Apps/Mobile/FreeWhen-logo/design/logo/kit"
masters_dir = os.path.join(kit_dir, "masters")
os.makedirs(masters_dir, exist_ok=True)

# 1. freewhen-symbol.svg (Master filled vector, single-colour espresso #170E0A)
symbol_master_svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-labelledby="title-symbol">
  <title id="title-symbol">FreeWhen — Brand Symbol (The Focus Nexus)</title>
  <!-- Pure filled outline geometry (no strokes) for universal CAD, cutting, and vector tool compatibility -->
  <g fill="#170E0A">
    <!-- Top-Left Focus Bracket -->
    <path d="M 18 168 V 84 A 66 66 0 0 1 84 18 H 168 A 22 22 0 0 1 168 62 H 84 A 22 22 0 0 0 62 84 V 168 A 22 22 0 0 1 18 168 Z" />
    <!-- Bottom-Right Focus Bracket -->
    <path d="M 238 88 V 172 A 66 66 0 0 1 172 238 H 88 A 22 22 0 0 1 88 194 H 172 A 22 22 0 0 0 194 172 V 88 A 22 22 0 0 1 238 88 Z" />
    <!-- Central Meet Point Node -->
    <circle cx="128" cy="128" r="30" />
  </g>
</svg>"""

with open(os.path.join(masters_dir, "freewhen-symbol.svg"), "w", encoding="utf-8") as f:
    f.write(symbol_master_svg)

# 2. freewhen-symbol-color.svg (Brand dual-colour: Tangerine #FF7A2F brackets + Volt #D4FF3A Meet Point on dark ink)
symbol_color_svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-labelledby="title-symbol-color">
  <title id="title-symbol-color">FreeWhen — Brand Symbol (Full Colour)</title>
  <g>
    <!-- Focus Brackets in Primary Tangerine -->
    <path fill="#FF7A2F" d="M 18 168 V 84 A 66 66 0 0 1 84 18 H 168 A 22 22 0 0 1 168 62 H 84 A 22 22 0 0 0 62 84 V 168 A 22 22 0 0 1 18 168 Z" />
    <path fill="#FF7A2F" d="M 238 88 V 172 A 66 66 0 0 1 172 238 H 88 A 22 22 0 0 1 88 194 H 172 A 22 22 0 0 0 194 172 V 88 A 22 22 0 0 1 238 88 Z" />
    <!-- Meet Point Consensus Node in Decision Volt -->
    <circle fill="#D4FF3A" cx="128" cy="128" r="30" />
  </g>
</svg>"""

with open(os.path.join(masters_dir, "freewhen-symbol-color.svg"), "w", encoding="utf-8") as f:
    f.write(symbol_color_svg)

# 3. freewhen-symbol-small.svg (Optimized small-size cut for 16-24px favicon / app status bar)
# Thinned gaps, slightly enlarged center node (r=32) for maximum small-scale punch
symbol_small_svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-labelledby="title-symbol-small">
  <title id="title-symbol-small">FreeWhen — Brand Symbol (Small Scale Cut 16-32px)</title>
  <g fill="#170E0A">
    <!-- Top-Left Bracket (tuned stroke 48) -->
    <path d="M 16 164 V 84 A 68 68 0 0 1 84 16 H 164 A 24 24 0 0 1 164 64 H 84 A 20 20 0 0 0 64 84 V 164 A 24 24 0 0 1 16 164 Z" />
    <!-- Bottom-Right Bracket -->
    <path d="M 240 92 V 172 A 68 68 0 0 1 172 240 H 92 A 24 24 0 0 1 92 192 H 172 A 20 20 0 0 0 192 172 V 92 A 24 24 0 0 1 240 92 Z" />
    <!-- Enlarged Meet Point core -->
    <circle cx="128" cy="128" r="34" />
  </g>
</svg>"""

with open(os.path.join(masters_dir, "freewhen-symbol-small.svg"), "w", encoding="utf-8") as f:
    f.write(symbol_small_svg)

# Let's test render all three symbol files
for filename in ["freewhen-symbol.svg", "freewhen-symbol-color.svg", "freewhen-symbol-small.svg"]:
    filepath = os.path.join(masters_dir, filename)
    subprocess.run([
        "python", ".agents/skills/logo-design/scripts/render_png.py",
        filepath,
        "--out-dir", masters_dir,
        "--size", "512"
    ], check=True)

print("Symbols created and rendered successfully.")
