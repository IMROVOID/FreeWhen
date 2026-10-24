import subprocess
import os

svg_header = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-labelledby="{title_id}">
  <title id="{title_id}">{title}</title>
{body}
</svg>"""

base_dir = "R:/More/Projects/Apps/Mobile/FreeWhen-logo/design/logo"
out_dir = os.path.join(base_dir, "final-concepts")
os.makedirs(out_dir, exist_ok=True)

# Concept A: The Focus Nexus (The Meet Point Viewfinder)
# Two bold rounded pill brackets (stroke 44) embracing a central Meet Point node (r=30).
concept_a = svg_header.format(
    title_id="title-concept-a",
    title="FreeWhen — Concept A: The Focus Nexus",
    body="""  <g fill="none" stroke="#170E0A" stroke-width="44" stroke-linecap="round">
    <path d="M 40 168 V 84 A 44 44 0 0 1 84 40 H 168" />
    <path d="M 216 88 V 172 A 44 44 0 0 1 172 216 H 88" />
  </g>
  <circle cx="128" cy="128" r="30" fill="#170E0A" />"""
)

# Concept B: The Converging Orbit (Orbital Alignment)
# Two heavy semicircular pill arcs (stroke 40) rotating around a central Meet Point sphere (r=28).
# Center (128, 128), R = 78.
# Top arc: angle 160 deg to 20 deg
# Start: x = 128 - 78*cos(20) = 128 - 73.3 = 54.7, y = 128 - 78*sin(20) = 128 - 26.7 = 101.3
# End: x = 128 + 73.3 = 201.3, y = 101.3
# Bottom arc: angle 340 deg to 200 deg
# Start: x = 201.3, y = 128 + 26.7 = 154.7
# End: x = 54.7, y = 154.7
concept_b = svg_header.format(
    title_id="title-concept-b",
    title="FreeWhen — Concept B: The Converging Orbit",
    body="""  <g fill="none" stroke="#170E0A" stroke-width="40" stroke-linecap="round">
    <path d="M 55 101 A 78 78 0 0 1 201 101" />
    <path d="M 201 155 A 78 78 0 0 1 55 155" />
  </g>
  <circle cx="128" cy="128" r="28" fill="#170E0A" />"""
)

# Concept C: The Four Lenses (Social Choice Compass)
# Four chunky rounded pill spokes converging at 45 degrees around a central Meet Point node.
concept_c = svg_header.format(
    title_id="title-concept-c",
    title="FreeWhen — Concept C: The Four Lenses",
    body="""  <g fill="#170E0A" transform="rotate(45 128 128)">
    <rect x="104" y="16" width="48" height="80" rx="24" />
    <rect x="104" y="160" width="48" height="80" rx="24" />
    <rect x="16" y="104" width="80" height="48" rx="24" />
    <rect x="160" y="104" width="80" height="48" rx="24" />
    <circle cx="128" cy="128" r="20" />
  </g>"""
)

files = {
    "concept-a.svg": concept_a,
    "concept-b.svg": concept_b,
    "concept-c.svg": concept_c
}

for name, text in files.items():
    with open(os.path.join(out_dir, name), "w", encoding="utf-8") as f:
        f.write(text)

# Run audit
audit_cmd = [
    "python", ".agents/skills/logo-design/scripts/svg_audit.py",
    os.path.join(out_dir, "concept-a.svg"),
    os.path.join(out_dir, "concept-b.svg"),
    os.path.join(out_dir, "concept-c.svg")
]
print("--- AUDIT RESULTS ---")
subprocess.run(audit_cmd, check=True)

# Run concept_sheet.py
sheet_cmd = [
    "python", ".agents/skills/logo-design/scripts/concept_sheet.py",
    os.path.join(out_dir, "concept-a.svg"),
    os.path.join(out_dir, "concept-b.svg"),
    os.path.join(out_dir, "concept-c.svg"),
    "--names", "The Focus Nexus", "The Converging Orbit", "The Four Lenses",
    "--notes",
    "Two bold rounded brackets snapping onto the Meet Point; tactile focus lock.",
    "Two orbital pill arcs aligning around mutual availability; dynamic consensus.",
    "Four decision lenses converging from all corners to find the fair equilibrium.",
    "--title", "FreeWhen — Brand Identity Concepts",
    "--subtitle", "Non-typographic, bold, tactile marks designed for the FreeWhen design system",
    "--recommend", "1",
    "-o", os.path.join(base_dir, "concepts.png")
]
print("--- GENERATING CONCEPT OVERVIEW SHEET ---")
subprocess.run(sheet_cmd, check=True)
print("SUCCESS: Concept sheet generated at", os.path.join(base_dir, "concepts.png"))
