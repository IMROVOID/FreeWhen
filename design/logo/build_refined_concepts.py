import subprocess
import os

svg_header = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-labelledby="{title_id}">
  <title id="{title_id}">{title}</title>
{body}
</svg>"""

concepts = {}

# ==============================================================================
# CONCEPT A: "The Meet Point" (Orbital Convergence & Focus)
# ==============================================================================
# Two bold, heavy semicircular pill brackets (stroke 36, rounded caps) rotating
# around a prominent, solid central core.
# Communicates: Scattered schedules converging smoothly from all sides into ONE
# unified decision. Generous negative space eliminates any "eye" reading.
# Highly dynamic, balanced, unmistakably mobile-app ready.
concepts["concept-a-orbit"] = svg_header.format(
    title_id="title-a",
    title="FreeWhen Concept A — The Meet Point (Orbital Convergence)",
    body="""  <g fill="none" stroke="#170E0A" stroke-width="36" stroke-linecap="round">
    <!-- Top Arc (sweeping over top, generous 46-degree gaps at left & right) -->
    <path d="M 58 100 A 76 76 0 0 1 198 100" />
    <!-- Bottom Arc (sweeping under bottom) -->
    <path d="M 198 156 A 76 76 0 0 1 58 156" />
  </g>
  <!-- Central Meet Point Core (bold solid focal node) -->
  <circle cx="128" cy="128" r="26" fill="#170E0A" />"""
)

# Let's also do a variation of Concept A where the two arcs are dynamic interlocking brackets (like two interlocking pills)
concepts["concept-a-brackets"] = svg_header.format(
    title_id="title-a-b",
    title="FreeWhen Concept A2 — Interlocking Brackets",
    body="""  <g fill="none" stroke="#170E0A" stroke-width="38" stroke-linecap="round">
    <!-- Top-Left Pill Bracket -->
    <path d="M 68 154 V 94 A 26 26 0 0 1 94 68 H 154" />
    <!-- Bottom-Right Pill Bracket -->
    <path d="M 188 102 V 162 A 26 26 0 0 1 162 188 H 102" />
  </g>
  <!-- Central Focal Nexus -->
  <circle cx="128" cy="128" r="22" fill="#170E0A" />"""
)

# ==============================================================================
# CONCEPT B: "The Overlap Knot" (Venn Squircles / Shared Time & Place)
# ==============================================================================
# Two bold squircle loops (representing Time "When" and Place "Where")
# that interlock seamlessly. In their shared intersection, a solid focal
# circle marks the agreed-upon gathering.
# Soft, warm, tactile — directly derives from FreeWhen's squircle card language.
concepts["concept-b-overlap"] = svg_header.format(
    title_id="title-b",
    title="FreeWhen Concept B — The Overlap Knot (Time & Place)",
    body="""  <!-- Background / outer geometry: Two interlocking rounded square frames -->
  <g fill="none" stroke="#170E0A" stroke-width="28" stroke-linejoin="round" stroke-linecap="round">
    <!-- Top-Left Squircle Loop (Time) -->
    <rect x="42" y="42" width="112" height="112" rx="36" />
    <!-- Bottom-Right Squircle Loop (Place) -->
    <rect x="102" y="102" width="112" height="112" rx="36" />
  </g>
  <!-- Central Intersection Core (The Agreement) -->
  <circle cx="128" cy="128" r="18" fill="#170E0A" />"""
)

# Let's also create an ultra-bold solid version of Concept B where the two squircles overlap with an optical cut
concepts["concept-b-solid-overlap"] = svg_header.format(
    title_id="title-b-s",
    title="FreeWhen Concept B2 — Solid Overlapping Tiles",
    body="""  <g fill="#170E0A">
    <!-- Left Squircle Tile -->
    <rect x="36" y="56" width="112" height="112" rx="36" />
    <!-- Right Squircle Tile with negative-space knockout border -->
    <!-- Knockout gap (white border) -->
    <rect x="108" y="88" width="112" height="112" rx="36" fill="none" stroke="#FFFFFF" stroke-width="16" />
    <!-- Right Squircle Tile fill -->
    <rect x="108" y="88" width="112" height="112" rx="36" />
    <!-- Center focal indicator -->
    <circle cx="128" cy="128" r="14" fill="#FFFFFF" />
  </g>"""
)

# ==============================================================================
# CONCEPT C: "The Four Lenses" / "The Social Nexus"
# ==============================================================================
# Four bold rounded pill segments converging in perfect equilibrium around
# a central negative-space aperture / spark.
# Represents FreeWhen's 4 core decision lenses:
# Balanced, Fastest, Fairest, Cheapest.
# Ultra-bold, geometric, unmistakably distinctive at 16px.
concepts["concept-c-nexus"] = svg_header.format(
    title_id="title-c",
    title="FreeWhen Concept C — The Four Lenses Nexus",
    body="""  <g fill="#170E0A">
    <!-- Top Pill: vertical, rounded -->
    <rect x="106" y="28" width="44" height="76" rx="22" />
    <!-- Bottom Pill: vertical, rounded -->
    <rect x="106" y="152" width="44" height="76" rx="22" />
    <!-- Left Pill: horizontal, rounded -->
    <rect x="28" y="106" width="76" height="44" rx="22" />
    <!-- Right Pill: horizontal, rounded -->
    <rect x="152" y="106" width="76" height="44" rx="22" />
    <!-- Central Meeting Point Core -->
    <circle cx="128" cy="128" r="16" />
  </g>"""
)

# Let's also do a 45-degree rotated version (X-axis convergence / focal spark):
concepts["concept-c-spark"] = svg_header.format(
    title_id="title-c-s",
    title="FreeWhen Concept C2 — The Diagonal Convergence Spark",
    body="""  <g fill="#170E0A" transform="rotate(45 128 128)">
    <!-- Top Pill -->
    <rect x="106" y="28" width="44" height="76" rx="22" />
    <!-- Bottom Pill -->
    <rect x="106" y="152" width="44" height="76" rx="22" />
    <!-- Left Pill -->
    <rect x="28" y="106" width="76" height="44" rx="22" />
    <!-- Right Pill -->
    <rect x="152" y="106" width="76" height="44" rx="22" />
    <!-- Central Meeting Point Core -->
    <circle cx="128" cy="128" r="16" />
  </g>"""
)

# ==============================================================================
# CONCEPT D: "The Equalizer / Horizon Clasp"
# ==============================================================================
# Two bold stadium pills arranged horizontally in dynamic balance, with an
# interlocking step or central convergence spark.
# A horizontal pill (time) meeting a vertical pill (place) in an asymmetrical L-join.
concepts["concept-d-clasp"] = svg_header.format(
    title_id="title-d",
    title="FreeWhen Concept D — The Horizon Clasp",
    body="""  <g fill="none" stroke="#170E0A" stroke-width="36" stroke-linecap="round" stroke-linejoin="round">
    <!-- Flowing S-curve / infinity interlocking pill -->
    <path d="M 60 100 C 60 64, 110 64, 128 100 C 146 136, 196 136, 196 100" />
    <path d="M 196 156 C 196 192, 146 192, 128 156 C 110 120, 60 120, 60 156" />
  </g>
  <circle cx="128" cy="128" r="18" fill="#170E0A" />"""
)

out_dir = "R:/More/Projects/Apps/Mobile/FreeWhen-logo/design/logo/showcase"
os.makedirs(out_dir, exist_ok=True)

for name, svg_text in concepts.items():
    svg_path = os.path.join(out_dir, f"{name}.svg")
    with open(svg_path, "w") as f:
        f.write(svg_text)
    subprocess.run([
        "python", ".agents/skills/logo-design/scripts/render_png.py",
        svg_path,
        "--out-dir", out_dir,
        "--size", "512"
    ], check=True)

print("Showcase concepts generated and rendered.")
