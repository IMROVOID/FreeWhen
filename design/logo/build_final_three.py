import subprocess
import os

svg_header = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-labelledby="{title_id}">
  <title id="{title_id}">{title}</title>
{body}
</svg>"""

out_dir = "R:/More/Projects/Apps/Mobile/FreeWhen-logo/design/logo/final-concepts"
os.makedirs(out_dir, exist_ok=True)

# ------------------------------------------------------------------------------
# CONCEPT A: "The Focus Nexus" (The Meet Point Viewfinder)
# ------------------------------------------------------------------------------
# Mathematical perfection:
# Center (128, 128)
# Top-Left Bracket: starts at (64, 156), up to (64, 96), arc r=32 to (96, 64), right to (156, 64).
# Bottom-Right Bracket: starts at (192, 100), down to (192, 160), arc r=32 to (160, 192), left to (100, 192).
# Stroke width 36, rounded caps.
# Center circle: r=24 at (128, 128).
concept_a_svg = svg_header.format(
    title_id="title-concept-a",
    title="FreeWhen — Concept A: The Focus Nexus",
    body="""  <g fill="none" stroke="#170E0A" stroke-width="36" stroke-linecap="round">
    <!-- Top-Left Pill Bracket -->
    <path d="M 64 156 V 96 A 32 32 0 0 1 96 64 H 156" />
    <!-- Bottom-Right Pill Bracket -->
    <path d="M 192 100 V 160 A 32 32 0 0 1 160 192 H 100" />
  </g>
  <!-- Central Meet Point Node -->
  <circle cx="128" cy="128" r="24" fill="#170E0A" />"""
)

# ------------------------------------------------------------------------------
# CONCEPT B: "The Overlap Knot" (Time & Place Intersection)
# ------------------------------------------------------------------------------
# Two bold, tactile squircle frames (stroke 26) intersecting diagonally.
# One squircle represents Time ("When"), the other Place ("Where").
# Where they cross, an illuminated central Meet Point node marks the agreed gathering.
concept_b_svg = svg_header.format(
    title_id="title-concept-b",
    title="FreeWhen — Concept B: The Overlap Knot",
    body="""  <g fill="none" stroke="#170E0A" stroke-width="26" stroke-linejoin="round" stroke-linecap="round">
    <!-- Top-Left Squircle Loop (When) -->
    <rect x="42" y="42" width="112" height="112" rx="36" />
    <!-- Bottom-Right Squircle Loop (Where) -->
    <rect x="102" y="102" width="112" height="112" rx="36" />
  </g>
  <!-- Central Agreement Node (Meet Point) -->
  <circle cx="128" cy="128" r="18" fill="#170E0A" />"""
)

# ------------------------------------------------------------------------------
# CONCEPT C: "The Four Lenses" (Equilibrium Compass / Spark)
# ------------------------------------------------------------------------------
# Four bold, chunky rounded pill spokes arranged in an X-axis convergence
# around a central Meet Point sphere.
# Represents FreeWhen's 4 social choice lenses (Balanced, Fastest, Fairest, Cheapest)
# converging from all corners to find the fair sweet spot.
concept_c_svg = svg_header.format(
    title_id="title-concept-c",
    title="FreeWhen — Concept C: The Four Lenses (Equilibrium Spark)",
    body="""  <g fill="#170E0A" transform="rotate(45 128 128)">
    <!-- Top Pill spoke -->
    <rect x="108" y="24" width="40" height="74" rx="20" />
    <!-- Bottom Pill spoke -->
    <rect x="108" y="158" width="40" height="74" rx="20" />
    <!-- Left Pill spoke -->
    <rect x="24" y="108" width="74" height="40" rx="20" />
    <!-- Right Pill spoke -->
    <rect x="158" y="108" width="74" height="40" rx="20" />
    <!-- Central Meet Point Hub -->
    <circle cx="128" cy="128" r="18" />
  </g>"""
)

files = {
    "concept-a.svg": concept_a_svg,
    "concept-b.svg": concept_b_svg,
    "concept-c.svg": concept_c_svg
}

for filename, content in files.items():
    filepath = os.path.join(out_dir, filename)
    with open(filepath, "w") as f:
        f.write(content)
    subprocess.run([
        "python", ".agents/skills/logo-design/scripts/render_png.py",
        filepath,
        "--out-dir", out_dir,
        "--size", "512"
    ], check=True)

print("Final three master SVGs and PNGs generated.")
