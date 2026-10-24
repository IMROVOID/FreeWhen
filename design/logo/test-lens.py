import math
import subprocess

# Let's construct two crescents flanking a solid central lens with uniform 12px gaps!
# Circle 1: (96, 128), R = 72
# Circle 2: (160, 128), R = 72
# Intersection of two circles at x = 128:
# d = 64 (distance between centers). R = 72.
# Half-chord: h = sqrt(R^2 - (d/2)^2) = sqrt(72^2 - 32^2) = sqrt(5184 - 1024) = sqrt(4160) = 64.5
# The intersection points are (128, 128 - 64.5) = (128, 63.5) and (128, 192.5)

# If we create an optical gap of 14px:
# Center lens: formed by arcs of radius 72 centered at (96, 128) and (160, 128), scaled or inset slightly.
# Even simpler: A bold central oval / stadium pill (width 56, height 120, rx 28),
# flanked by two bold outer arcs!

svg_lens = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-labelledby="title-lens">
  <title id="title-lens">FreeWhen — The Intersection Lens (Venn Convergence)</title>
  <g fill="#170E0A">
    <!-- Left Crescent (Time Window) -->
    <path d="
      M 112 56
      A 76 76 0 1 0 112 200
      A 86 86 0 0 1 112 56 Z
    " />
    <!-- Right Crescent (Venue Space) -->
    <path d="
      M 144 56
      A 76 76 0 1 1 144 200
      A 86 86 0 0 1 144 56 Z
    " />
    <!-- Center Meet Point Pill / Lens (The Free Moment) -->
    <rect x="110" y="76" width="36" height="104" rx="18" />
  </g>
</svg>"""

with open("R:/More/Projects/Apps/Mobile/FreeWhen-logo/design/logo/test-lens.svg", "w") as f:
    f.write(svg_lens)

subprocess.run([
    "python", ".agents/skills/logo-design/scripts/render_png.py",
    "R:/More/Projects/Apps/Mobile/FreeWhen-logo/design/logo/test-lens.svg",
    "--out-dir", "R:/More/Projects/Apps/Mobile/FreeWhen-logo/design/logo/renders",
    "--size", "512"
], check=True)
print("Rendered test-lens.")
