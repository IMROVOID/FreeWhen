import subprocess
import os

svg_template = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img">
{content}
</svg>"""

candidates = {}

# Concept 1: "The Snap Pill" (Meet Point Clasp)
# An ultra-bold stadium capsule with an optical diagonal interlock / lightning snap in the center,
# symbolizing two schedules snapping together into one locked decision.
candidates["concept-1-snap-pill"] = """
  <!-- Concept 1: The Snap Pill / Clasp -->
  <g fill="#170E0A">
    <!-- Left clasp half -->
    <path d="
      M 72 84
      A 44 44 0 0 0 72 172
      H 116
      L 136 128
      L 116 84
      Z
    "/>
    <!-- Right clasp half -->
    <path d="
      M 184 84
      H 140
      L 120 128
      L 140 172
      H 184
      A 44 44 0 0 0 184 84
      Z
    "/>
    <!-- Central locked core dot/aperture -->
    <circle cx="128" cy="128" r="14" fill="#170E0A"/>
  </g>
"""

# Let's refine Concept 1 into a pure, smoother version:
# Two bold rounded pill segments that slide together with a uniform 16px diagonal gap,
# framing a central circular meet point.
candidates["concept-1-snap-pill-v2"] = """
  <!-- Concept 1 v2: Two curved pill jaws docking around a central Meet Point -->
  <g fill="#170E0A">
    <!-- Left pill bracket -->
    <path d="
      M 80 72
      H 116
      C 126 72 134 78 138 86
      L 110 128
      L 138 170
      C 134 178 126 184 116 184
      H 80
      A 56 56 0 0 1 80 72 Z
    "/>
    <!-- Right pill bracket -->
    <path d="
      M 176 184
      H 140
      C 130 184 122 178 118 170
      L 146 128
      L 118 86
      C 122 78 130 72 140 72
      H 176
      A 56 56 0 0 1 176 184 Z
    "/>
    <!-- Central Meet Point core -->
    <circle cx="128" cy="128" r="18"/>
  </g>
"""

# Concept 2: "The Fair Hub" (3-Way Convergence)
# Three bold, chunky rounded pill arms converging toward a central circle at 120 degrees.
# Highly balanced, warm, social. Like 3 friends meeting at a central table.
candidates["concept-2-fair-hub"] = """
  <!-- Concept 2: Threefold Convergence Hub -->
  <g fill="#170E0A" transform="translate(128, 134)">
    <!-- Arm 1: Top (0 deg) -->
    <g transform="rotate(0)">
      <rect x="-24" y="-102" width="48" height="72" rx="24"/>
    </g>
    <!-- Arm 2: Bottom-Right (120 deg) -->
    <g transform="rotate(120)">
      <rect x="-24" y="-102" width="48" height="72" rx="24"/>
    </g>
    <!-- Arm 3: Bottom-Left (240 deg) -->
    <g transform="rotate(240)">
      <rect x="-24" y="-102" width="48" height="72" rx="24"/>
    </g>
    <!-- Central focal nexus / Meet Point disc -->
    <circle cx="0" cy="0" r="22"/>
  </g>
"""

# Concept 3: "The Overlap Lens" (Venn Squircles)
# Two bold squircle rings (width 128, height 128, rx 40, stroke 26) intersecting diagonally.
# One represents Time ("When"), one represents Place ("Where").
# Intersection creates a shared central lens.
candidates["concept-3-overlap-lens"] = """
  <!-- Concept 3: Two Interlocking Squircles (Time + Place) -->
  <g fill="none" stroke="#170E0A" stroke-width="26" stroke-linejoin="round">
    <!-- Top-left squircle ring -->
    <rect x="42" y="42" width="116" height="116" rx="42"/>
    <!-- Bottom-right squircle ring -->
    <rect x="98" y="98" width="116" height="116" rx="42"/>
  </g>
  <!-- Central intersection focal dot -->
  <circle cx="128" cy="128" r="16" fill="#170E0A"/>
"""

# Concept 4: "The Common Horizon" / "The Equalizer"
# Two bold horizontal pills stacked with a central offset slider / focal nexus.
# Or: A bold circular disc with an inner negative-space pill hourglass / convergence.

os.makedirs("R:/More/Projects/Apps/Mobile/FreeWhen-logo/design/logo/candidates", exist_ok=True)
for name, content in candidates.items():
    svg_path = f"R:/More/Projects/Apps/Mobile/FreeWhen-logo/design/logo/candidates/{name}.svg"
    with open(svg_path, "w") as f:
        f.write(svg_template.format(content=content))
    subprocess.run([
        "python", ".agents/skills/logo-design/scripts/render_png.py",
        svg_path,
        "--out-dir", "R:/More/Projects/Apps/Mobile/FreeWhen-logo/design/logo/candidates",
        "--size", "512"
    ], check=True)

print("Rendered all candidates.")
