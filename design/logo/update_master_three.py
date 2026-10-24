import subprocess
import os

svg_header = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-labelledby="{title_id}">
  <title id="{title_id}">{title}</title>
{body}
</svg>"""

out_dir = "R:/More/Projects/Apps/Mobile/FreeWhen-logo/design/logo/final-concepts"

# ------------------------------------------------------------------------------
# CONCEPT A: "The Focus Nexus" (The Meet Point Viewfinder / Clasp)
# ------------------------------------------------------------------------------
concept_a_svg = svg_header.format(
    title_id="title-concept-a",
    title="FreeWhen Concept A — The Focus Nexus (Meet Point Viewfinder)",
    body="""  <g fill="none" stroke="#170E0A" stroke-width="44" stroke-linecap="round">
    <!-- Top-Left Pill Bracket (Autofocus & Convergence) -->
    <path d="M 40 168 V 84 A 44 44 0 0 1 84 40 H 168" />
    <!-- Bottom-Right Pill Bracket -->
    <path d="M 216 88 V 172 A 44 44 0 0 1 172 216 H 88" />
  </g>
  <!-- Central Meet Point Node (The Locked Decision) -->
  <circle cx="128" cy="128" r="30" fill="#170E0A" />"""
)

# ------------------------------------------------------------------------------
# CONCEPT B: "The Overlap Knot" (Time & Place Interlock)
# ------------------------------------------------------------------------------
concept_b_svg = svg_header.format(
    title_id="title-concept-b",
    title="FreeWhen Concept B — The Overlap Knot (When & Where Intersection)",
    body="""  <g fill="none" stroke="#170E0A" stroke-width="28" stroke-linejoin="round" stroke-linecap="round">
    <!-- Top-Left Squircle Loop (Time Window) -->
    <rect x="36" y="36" width="124" height="124" rx="42" />
    <!-- Bottom-Right Squircle Loop (Venue Space) -->
    <rect x="96" y="96" width="124" height="124" rx="42" />
  </g>
  <!-- Central Meet Point Node -->
  <circle cx="128" cy="128" r="18" fill="#170E0A" />"""
)

# ------------------------------------------------------------------------------
# CONCEPT C: "The Four Lenses" (Equilibrium Compass / Social Choice Nexus)
# ------------------------------------------------------------------------------
concept_c_svg = svg_header.format(
    title_id="title-concept-c",
    title="FreeWhen Concept C — The Four Lenses (Fairness Compass)",
    body="""  <g fill="#170E0A" transform="rotate(45 128 128)">
    <!-- Top Pill Spoke (Balanced Lens) -->
    <rect x="104" y="16" width="48" height="80" rx="24" />
    <!-- Bottom Pill Spoke (Cheapest Lens) -->
    <rect x="104" y="160" width="48" height="80" rx="24" />
    <!-- Left Pill Spoke (Fastest Lens) -->
    <rect x="16" y="104" width="80" height="48" rx="24" />
    <!-- Right Pill Spoke (Fairest Lens) -->
    <rect x="160" y="104" width="80" height="48" rx="24" />
    <!-- Central Consensus Node -->
    <circle cx="128" cy="128" r="20" />
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

print("Updated and re-rendered final three master files.")
