import subprocess
import os

svg_header = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-labelledby="{title_id}">
  <title id="{title_id}">{title}</title>
{body}
</svg>"""

out_dir = "R:/More/Projects/Apps/Mobile/FreeWhen-logo/design/logo/candidates-v3"
os.makedirs(out_dir, exist_ok=True)

tests = {}

# 1. A1: The Original Focus Nexus (User's Favorite)
tests["a1-focus-nexus"] = svg_header.format(
    title_id="t-a1",
    title="A1 — The Focus Nexus (Original)",
    body="""  <g fill="none" stroke="#170E0A" stroke-width="44" stroke-linecap="round">
    <path d="M 40 168 V 84 A 44 44 0 0 1 84 40 H 168" />
    <path d="M 216 88 V 172 A 44 44 0 0 1 172 216 H 88" />
  </g>
  <circle cx="128" cy="128" r="30" fill="#170E0A" />"""
)

# 2. A2: The Target Viewfinder (Four-Corner Lock)
# 4 symmetrical rounded brackets framing the central Meet Point node.
tests["a2-target-viewfinder"] = svg_header.format(
    title_id="t-a2",
    title="A2 — The Target Viewfinder (Four Corners)",
    body="""  <g fill="none" stroke="#170E0A" stroke-width="36" stroke-linecap="round">
    <path d="M 40 102 V 70 A 30 30 0 0 1 70 40 H 102" />
    <path d="M 154 40 H 186 A 30 30 0 0 1 216 70 V 102" />
    <path d="M 216 154 V 186 A 30 30 0 0 1 186 216 H 154" />
    <path d="M 102 216 H 70 A 30 30 0 0 1 40 186 V 154" />
  </g>
  <circle cx="128" cy="128" r="28" fill="#170E0A" />"""
)

# 3. A3: The Meet Point Stadium Core
# The exact brackets of A1, but the central node is a horizontal stadium pill —
# directly representing the app's signature "Meet Point" button where avatars snap in.
tests["a3-stadium-core"] = svg_header.format(
    title_id="t-a3",
    title="A3 — The Meet Point Stadium Core",
    body="""  <g fill="none" stroke="#170E0A" stroke-width="44" stroke-linecap="round">
    <path d="M 40 168 V 84 A 44 44 0 0 1 84 40 H 168" />
    <path d="M 216 88 V 172 A 44 44 0 0 1 172 216 H 88" />
  </g>
  <!-- Central Meet Point Stadium Pill (width 72, height 48, rx 24) -->
  <rect x="92" y="104" width="72" height="48" rx="24" fill="#170E0A" />"""
)

# 4. A4: The Diamond Viewfinder (45-degree Rotated Brackets)
# The two brackets rotated 45 degrees, creating a dynamic top/bottom diamond aperture.
tests["a4-diamond-viewfinder"] = svg_header.format(
    title_id="t-a4",
    title="A4 — The Diamond Viewfinder",
    body="""  <g fill="none" stroke="#170E0A" stroke-width="44" stroke-linecap="round" transform="rotate(45 128 128)">
    <path d="M 40 168 V 84 A 44 44 0 0 1 84 40 H 168" />
    <path d="M 216 88 V 172 A 44 44 0 0 1 172 216 H 88" />
  </g>
  <circle cx="128" cy="128" r="30" fill="#170E0A" />"""
)

# 5. A5: The Overlapping Aperture (Interlocking Offset Pill Brackets)
# One bracket slightly overlaps or interlocks with the other at the corner,
# creating a physical sense of locking together (like a mechanical latch).
# Top-left bracket extends to x=184, bottom-right bracket extends to x=72.
tests["a5-interlocking-latch"] = svg_header.format(
    title_id="t-a5",
    title="A5 — The Interlocking Latch",
    body="""  <g fill="none" stroke="#170E0A" stroke-width="40" stroke-linecap="round">
    <!-- Top-Left Bracket wrapping slightly further -->
    <path d="M 42 178 V 82 A 40 40 0 0 1 82 42 H 184" />
    <!-- Bottom-Right Bracket wrapping slightly further -->
    <path d="M 214 78 V 174 A 40 40 0 0 1 174 214 H 72" />
  </g>
  <circle cx="128" cy="128" r="28" fill="#170E0A" />"""
)

# 6. A6: The Magnetic Pulse (Nested Double Ring Nexus)
# An outer bracket pair embracing an inner concentric circular ring + core dot.
tests["a6-pulse-nexus"] = svg_header.format(
    title_id="t-a6",
    title="A6 — The Pulse Nexus",
    body="""  <g fill="none" stroke="#170E0A" stroke-linecap="round">
    <!-- Outer Viewfinder Brackets -->
    <path d="M 40 168 V 84 A 44 44 0 0 1 84 40 H 168" stroke-width="40" />
    <path d="M 216 88 V 172 A 44 44 0 0 1 172 216 H 88" stroke-width="40" />
    <!-- Inner Concentric Orbit Ring -->
    <circle cx="128" cy="128" r="46" stroke-width="18" />
  </g>
  <!-- Central Target Dot -->
  <circle cx="128" cy="128" r="20" fill="#170E0A" />"""
)

for name, svg_text in tests.items():
    svg_path = os.path.join(out_dir, f"{name}.svg")
    with open(svg_path, "w", encoding="utf-8") as f:
        f.write(svg_text)
    subprocess.run([
        "python", ".agents/skills/logo-design/scripts/render_png.py",
        svg_path,
        "--out-dir", out_dir,
        "--size", "512"
    ], check=True)

print("Generated and rendered 6 v3 candidates.")
