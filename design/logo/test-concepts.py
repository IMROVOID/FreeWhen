import subprocess
import os

svg_template = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
{content}
</svg>"""

tests = {
    # Test 1: Three-way Venn / Convergence Rings (3 bold interlocking circles forming central intersection)
    "venn3": """
    <g fill="#170E0A">
      <!-- 3 bold circles with stroke -->
      <circle cx="128" cy="94" r="58" fill="none" stroke="#170E0A" stroke-width="24"/>
      <circle cx="94" cy="154" r="58" fill="none" stroke="#170E0A" stroke-width="24"/>
      <circle cx="162" cy="154" r="58" fill="none" stroke="#170E0A" stroke-width="24"/>
      <!-- Solid central meet point spark -->
      <circle cx="128" cy="134" r="14" fill="#170E0A"/>
    </g>
    """,

    # Test 2: The Interlocking Stadiums (Two bold rounded pills overlapping at 90 deg forming a central bold square/aperture)
    "cross_pills": """
    <g fill="#170E0A">
      <!-- Horizontal pill -->
      <rect x="36" y="96" width="184" height="64" rx="32"/>
      <!-- Vertical pill crossing with cutout/interlock or unified -->
      <rect x="96" y="36" width="64" height="184" rx="32"/>
      <!-- Negative space center circle (aperture) -->
      <circle cx="128" cy="128" r="20" fill="#FFFFFF"/>
    </g>
    """,

    # Test 3: The Convergence Knot (3 bold pill segments curving in a dynamic triskelion / pinwheel)
    "triskelion": """
    <g fill="#170E0A" transform="translate(128, 128)">
      <!-- Branch 1 (0 deg) -->
      <rect x="14" y="-20" width="84" height="40" rx="20"/>
      <!-- Branch 2 (120 deg) -->
      <g transform="rotate(120)">
        <rect x="14" y="-20" width="84" height="40" rx="20"/>
      </g>
      <!-- Branch 3 (240 deg) -->
      <g transform="rotate(240)">
        <rect x="14" y="-20" width="84" height="40" rx="20"/>
      </g>
      <!-- Central focal circle -->
      <circle cx="0" cy="0" r="16"/>
    </g>
    """,

    # Test 4: The Overlapping Pair (Two bold stadium pills angled 45 deg forming a dynamic infinity / connection knot)
    "infinity_pills": """
    <g fill="none" stroke="#170E0A" stroke-width="32" stroke-linecap="round" stroke-linejoin="round">
      <path d="M 72 128 C 72 88, 112 88, 128 128 C 144 168, 184 168, 184 128 C 184 88, 144 88, 128 128 C 112 168, 72 168, 72 128 Z"/>
    </g>
    """
}

os.makedirs("R:/More/Projects/Apps/Mobile/FreeWhen-logo/design/logo/tests", exist_ok=True)
for name, content in tests.items():
    svg_path = f"R:/More/Projects/Apps/Mobile/FreeWhen-logo/design/logo/tests/{name}.svg"
    with open(svg_path, "w") as f:
        f.write(svg_template.format(content=content))
    subprocess.run([
        "python", ".agents/skills/logo-design/scripts/render_png.py",
        svg_path,
        "--out-dir", "R:/More/Projects/Apps/Mobile/FreeWhen-logo/design/logo/tests",
        "--size", "512"
    ], check=True)

print("Rendered all tests successfully.")
