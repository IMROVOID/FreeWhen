import subprocess
import os

svg_header = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-labelledby="{title_id}">
  <title id="{title_id}">{title}</title>
{body}
</svg>"""

round2_dir = "R:/More/Projects/Apps/Mobile/FreeWhen-logo/design/logo/round2"
os.makedirs(round2_dir, exist_ok=True)

# A1: The Focus Nexus (Original Favorite)
a1 = svg_header.format(
    title_id="title-a1",
    title="FreeWhen A1 — The Focus Nexus (Original)",
    body="""  <g fill="none" stroke="#170E0A" stroke-width="44" stroke-linecap="round">
    <path d="M 40 168 V 84 A 44 44 0 0 1 84 40 H 168" />
    <path d="M 216 88 V 172 A 44 44 0 0 1 172 216 H 88" />
  </g>
  <circle cx="128" cy="128" r="30" fill="#170E0A" />"""
)

# A2: The Target Viewfinder (Four Corners)
# 4 symmetrical rounded brackets with uniform 32px stroke, perfectly centered
a2 = svg_header.format(
    title_id="title-a2",
    title="FreeWhen A2 — The Target Viewfinder",
    body="""  <g fill="none" stroke="#170E0A" stroke-width="36" stroke-linecap="round">
    <path d="M 40 102 V 70 A 30 30 0 0 1 70 40 H 102" />
    <path d="M 154 40 H 186 A 30 30 0 0 1 216 70 V 102" />
    <path d="M 216 154 V 186 A 30 30 0 0 1 186 216 H 154" />
    <path d="M 102 216 H 70 A 30 30 0 0 1 40 186 V 154" />
  </g>
  <circle cx="128" cy="128" r="28" fill="#170E0A" />"""
)

# A3: The Meet Point Pill (Stadium Core)
# Direct reflection of the Meet Point pill in FreeWhen UI
a3 = svg_header.format(
    title_id="title-a3",
    title="FreeWhen A3 — The Meet Point Stadium Core",
    body="""  <g fill="none" stroke="#170E0A" stroke-width="44" stroke-linecap="round">
    <path d="M 40 168 V 84 A 44 44 0 0 1 84 40 H 168" />
    <path d="M 216 88 V 172 A 44 44 0 0 1 172 216 H 88" />
  </g>
  <rect x="92" y="104" width="72" height="48" rx="24" fill="#170E0A" />"""
)

# A4: The Diamond Viewfinder (45° Diagonal Alignment)
# Dynamic prism / compass alignment
a4 = svg_header.format(
    title_id="title-a4",
    title="FreeWhen A4 — The Diamond Viewfinder",
    body="""  <g fill="none" stroke="#170E0A" stroke-width="44" stroke-linecap="round" transform="rotate(45 128 128)">
    <path d="M 40 168 V 84 A 44 44 0 0 1 84 40 H 168" />
    <path d="M 216 88 V 172 A 44 44 0 0 1 172 216 H 88" />
  </g>
  <circle cx="128" cy="128" r="30" fill="#170E0A" />"""
)

files = {
    "a1-focus-nexus.svg": a1,
    "a2-target-viewfinder.svg": a2,
    "a3-stadium-core.svg": a3,
    "a4-diamond-viewfinder.svg": a4
}

for name, text in files.items():
    with open(os.path.join(round2_dir, name), "w", encoding="utf-8") as f:
        f.write(text)

# Audit
audit_cmd = ["python", ".agents/skills/logo-design/scripts/svg_audit.py"] + [
    os.path.join(round2_dir, name) for name in files.keys()
]
print("--- RUNNING AUDIT ---")
subprocess.run(audit_cmd, check=True)

# Generate Concept Sheet
sheet_cmd = [
    "python", ".agents/skills/logo-design/scripts/concept_sheet.py",
    os.path.join(round2_dir, "a1-focus-nexus.svg"),
    os.path.join(round2_dir, "a2-target-viewfinder.svg"),
    os.path.join(round2_dir, "a3-stadium-core.svg"),
    os.path.join(round2_dir, "a4-diamond-viewfinder.svg"),
    "--names",
    "A1 · The Focus Nexus",
    "A2 · The Target Viewfinder",
    "A3 · The Stadium Core",
    "A4 · The Diamond Viewfinder",
    "--notes",
    "Two bold rounded brackets snapping inward; clean tactile focus lock.",
    "Four symmetrical corner brackets framing the agreed spot; universal target lock.",
    "The signature Meet Point pill docked inside the focus brackets.",
    "Brackets rotated 45° into top/bottom directional chevrons.",
    "--title", "FreeWhen — Concept Exploration Round 2",
    "--subtitle", "Deeper exploration based on Concept A's focus lock geometry",
    "--recommend", "1",
    "-o", os.path.join(round2_dir, "concepts-round-2.png")
]
print("--- RUNNING CONCEPT SHEET ---")
subprocess.run(sheet_cmd, check=True)
print("SUCCESS: concepts-round-2.png generated.")
