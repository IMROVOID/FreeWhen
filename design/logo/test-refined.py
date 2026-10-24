import subprocess
import os

svg_template = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img">
{content}
</svg>"""

refined = {}

# Concept A: "The Meet Point" (Diagonal Bracket Clasp & Nexus)
# A bold squircle badge divided by a dynamic 45-degree channel, framing a central Meet Point sphere.
# Highly tactile, solid, modern mobile icon feel.
refined["concept-a-meet-point"] = """
  <!-- Concept A: The Meet Point Clasp -->
  <g fill="#170E0A">
    <!-- Top-Left Bracket -->
    <path d="
      M 56 40
      C 47.16 40 40 47.16 40 56
      V 136
      C 40 148 46 158 56 164
      L 164 56
      C 158 46 148 40 136 40
      H 56 Z
    "/>
    <!-- Bottom-Right Bracket -->
    <path d="
      M 200 216
      C 208.84 216 216 208.84 216 200
      V 120
      C 216 108 210 98 200 92
      L 92 200
      C 98 210 108 216 120 216
      H 200 Z
    "/>
    <!-- Central Meet Point Core -->
    <circle cx="128" cy="128" r="26"/>
  </g>
"""

# Let's also do a smoother, organic pill version of Concept A:
# Two heavy rounded pill arms (stadium brackets) hugging the central Meet Point
refined["concept-a-pill-clasp"] = """
  <!-- Concept A v2: Two rounded stadium brackets clasping around a central Meet Point -->
  <g fill="#170E0A">
    <!-- Top-Left Pill Hook -->
    <path d="
      M 72 48
      H 136
      A 36 36 0 0 1 172 84
      A 24 24 0 0 1 148 108
      H 108
      A 24 24 0 0 0 84 132
      V 148
      A 24 24 0 0 1 60 172
      A 36 36 0 0 1 24 136
      V 96
      A 48 48 0 0 1 72 48 Z
    "/>
    <!-- Bottom-Right Pill Hook (180 deg) -->
    <g transform="rotate(180 128 128)">
      <path d="
        M 72 48
        H 136
        A 36 36 0 0 1 172 84
        A 24 24 0 0 1 148 108
        H 108
        A 24 24 0 0 0 84 132
        V 148
        A 24 24 0 0 1 60 172
        A 36 36 0 0 1 24 136
        V 96
        A 48 48 0 0 1 72 48 Z
      "/>
    </g>
    <!-- Central Meet Point sphere -->
    <circle cx="128" cy="128" r="22"/>
  </g>
"""

# Concept B: "The Overlap Knot" (Continuous Interlocking Loop of Time & Place)
# Two bold interlocking squircle loops with clean optical gaps (depth / weave),
# framing a shared central aperture.
refined["concept-b-overlap-knot"] = """
  <!-- Concept B: Two interlocking squircle loops with clean under-over weave -->
  <g fill="#170E0A">
    <!-- Loop 1 (Top-Left) -->
    <path fill-rule="evenodd" d="
      M 72 36
      H 140
      A 44 44 0 0 1 184 80
      V 124
      H 152
      V 80
      A 12 12 0 0 0 140 68
      H 72
      A 12 12 0 0 0 60 80
      V 148
      A 12 12 0 0 0 72 160
      H 116
      V 192
      H 72
      A 44 44 0 0 1 28 148
      V 80
      A 44 44 0 0 1 72 36 Z
    "/>
    <!-- Loop 2 (Bottom-Right) -->
    <path fill-rule="evenodd" d="
      M 184 220
      H 116
      A 44 44 0 0 1 72 176
      V 132
      H 104
      V 176
      A 12 12 0 0 0 116 188
      H 184
      A 12 12 0 0 0 196 176
      V 108
      A 12 12 0 0 0 184 96
      H 140
      V 64
      H 184
      A 44 44 0 0 1 228 108
      V 176
      A 44 44 0 0 1 184 220 Z
    "/>
    <!-- Center focal point -->
    <circle cx="128" cy="128" r="16"/>
  </g>
"""

# Concept C: "The Decision Spark" / "The Gathering Nexus"
# A bold 4-point rounded star / spark carved into a squircle, OR formed by 4 converging pill segments.
# Four chunky pill blocks in 4 quadrants converging, forming an illuminated 4-point star in negative space.
refined["concept-c-decision-spark"] = """
  <!-- Concept C: Four converging quadrant pills creating a central negative-space Decision Spark -->
  <g fill="#170E0A">
    <!-- Top-Left Pill -->
    <rect x="36" y="36" width="76" height="76" rx="38"/>
    <!-- Top-Right Pill -->
    <rect x="144" y="36" width="76" height="76" rx="38"/>
    <!-- Bottom-Left Pill -->
    <rect x="36" y="144" width="76" height="76" rx="38"/>
    <!-- Bottom-Right Pill -->
    <rect x="144" y="144" width="76" height="76" rx="38"/>
    <!-- Central Meet Point Spark (4 rounded arms) -->
    <circle cx="128" cy="128" r="20"/>
  </g>
"""

os.makedirs("R:/More/Projects/Apps/Mobile/FreeWhen-logo/design/logo/refined", exist_ok=True)
for name, content in refined.items():
    svg_path = f"R:/More/Projects/Apps/Mobile/FreeWhen-logo/design/logo/refined/{name}.svg"
    with open(svg_path, "w") as f:
        f.write(svg_template.format(content=content))
    subprocess.run([
        "python", ".agents/skills/logo-design/scripts/render_png.py",
        svg_path,
        "--out-dir", "R:/More/Projects/Apps/Mobile/FreeWhen-logo/design/logo/refined",
        "--size", "512"
    ], check=True)

print("Rendered all refined candidates.")
