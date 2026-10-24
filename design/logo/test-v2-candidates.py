import subprocess
import os

svg_header = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-labelledby="{title_id}">
  <title id="{title_id}">{title}</title>
{body}
</svg>"""

out_dir = "R:/More/Projects/Apps/Mobile/FreeWhen-logo/design/logo/candidates-v2"
os.makedirs(out_dir, exist_ok=True)

tests = {}

# 1. A1: The Original Benchmark (Concept A: The Focus Nexus)
tests["a1-original"] = svg_header.format(
    title_id="t-a1",
    title="A1 — The Focus Nexus (Original)",
    body="""  <g fill="none" stroke="#170E0A" stroke-width="44" stroke-linecap="round">
    <path d="M 40 168 V 84 A 44 44 0 0 1 84 40 H 168" />
    <path d="M 216 88 V 172 A 44 44 0 0 1 172 216 H 88" />
  </g>
  <circle cx="128" cy="128" r="30" fill="#170E0A" />"""
)

# 2. A2: The Four-Corner Viewfinder (Universal Target Lock)
# Four chunky rounded pill brackets (⌜ ⌝ ⌞ ⌟) framing the central Meet Point node.
# The literal camera focus / target lock: locking in the agreed venue and time.
tests["a2-four-corner"] = svg_header.format(
    title_id="t-a2",
    title="A2 — The Target Viewfinder",
    body="""  <g fill="none" stroke="#170E0A" stroke-width="36" stroke-linecap="round">
    <!-- Top-Left -->
    <path d="M 38 104 V 68 A 30 30 0 0 1 68 38 H 104" />
    <!-- Top-Right -->
    <path d="M 152 38 H 188 A 30 30 0 0 1 218 68 V 104" />
    <!-- Bottom-Right -->
    <path d="M 218 152 V 188 A 30 30 0 0 1 188 218 H 152" />
    <!-- Bottom-Left -->
    <path d="M 104 218 H 68 A 30 30 0 0 1 38 188 V 152" />
  </g>
  <circle cx="128" cy="128" r="28" fill="#170E0A" />"""
)

# 3. A3: The Dynamic Diagonal Offset (Asymmetric Motion Viewfinder)
# Two brackets where the top-left bracket is elongated and wraps further, creating directional torque/speed.
# Or: Brackets with a stadium pill node instead of a circle in the center!
tests["a3-pill-core"] = svg_header.format(
    title_id="t-a3",
    title="A3 — The Meet Point Pill Core",
    body="""  <g fill="none" stroke="#170E0A" stroke-width="44" stroke-linecap="round">
    <path d="M 40 168 V 84 A 44 44 0 0 1 84 40 H 168" />
    <path d="M 216 88 V 172 A 44 44 0 0 1 172 216 H 88" />
  </g>
  <!-- Central horizontal Meet Point Stadium Pill instead of a circle -->
  <rect x="94" y="104" width="68" height="48" rx="24" fill="#170E0A" />"""
)

# 4. A4: The Interlocking S-Clasp (Continuous Flow Viewfinder)
# Two L-brackets that curve toward each other like an interlocking S, creating dynamic energy.
tests["a4-nested-aperture"] = svg_header.format(
    title_id="t-a4",
    title="A4 — The Nested Aperture",
    body="""  <g fill="none" stroke="#170E0A" stroke-width="42" stroke-linecap="round">
    <!-- Top bracket with inward curl -->
    <path d="M 44 148 V 80 A 36 36 0 0 1 80 44 H 176 A 36 36 0 0 1 212 80" />
    <!-- Bottom bracket with inward curl -->
    <path d="M 212 108 V 176 A 36 36 0 0 1 176 212 H 80 A 36 36 0 0 1 44 176" />
  </g>
  <circle cx="128" cy="128" r="28" fill="#170E0A" />"""
)

# 5. A5: The Negative Space Solid Viewfinder (Solid Squircle with Optical Aperture Cut)
# A solid, massive squircle badge with a diagonal slot and center circle.
tests["a5-solid-badge"] = svg_header.format(
    title_id="t-a5",
    title="A5 — The Solid Viewfinder Badge",
    body="""  <g fill="#170E0A">
    <!-- Solid squircle container with real negative space cutouts -->
    <!-- Top-Left Solid Wing -->
    <path d="
      M 48 32
      H 136
      C 152 32 166 40 174 52
      L 52 174
      C 40 166 32 152 32 136
      V 48
      C 32 39.16 39.16 32 48 32 Z
    " />
    <!-- Bottom-Right Solid Wing -->
    <path d="
      M 208 224
      H 120
      C 104 224 90 216 82 204
      L 204 82
      C 216 90 224 104 224 120
      V 208
      C 224 216.84 216.84 224 208 224 Z
    " />
    <!-- Center floating Meet Point node -->
    <circle cx="128" cy="128" r="32" />
  </g>"""
)

# 6. A6: The Interlocking Stadium Loop (Two Pill Brackets that wrap tightly)
tests["a6-tight-lock"] = svg_header.format(
    title_id="t-a6",
    title="A6 — The Tight Focus Lock",
    body="""  <g fill="none" stroke="#170E0A" stroke-width="48" stroke-linecap="round">
    <path d="M 44 154 V 88 A 44 44 0 0 1 88 44 H 154" />
    <path d="M 212 102 V 168 A 44 44 0 0 1 168 212 H 102" />
  </g>
  <circle cx="128" cy="128" r="32" fill="#170E0A" />"""
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

print("Generated and rendered 6 v2 candidates.")
