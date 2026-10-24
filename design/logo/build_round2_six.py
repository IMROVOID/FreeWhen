import subprocess
import os

svg_header = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-labelledby="{title_id}">
  <title id="{title_id}">{title}</title>
{body}
</svg>"""

round2_dir = "R:/More/Projects/Apps/Mobile/FreeWhen-logo/design/logo/round2"

# ------------------------------------------------------------------------------
# 1. A1: The Focus Nexus (Original Favorite)
# ------------------------------------------------------------------------------
a1 = svg_header.format(
    title_id="title-a1",
    title="FreeWhen A1 — The Focus Nexus (Original)",
    body="""  <g fill="none" stroke="#170E0A" stroke-width="44" stroke-linecap="round">
    <path d="M 40 168 V 84 A 44 44 0 0 1 84 40 H 168" />
    <path d="M 216 88 V 172 A 44 44 0 0 1 172 216 H 88" />
  </g>
  <circle cx="128" cy="128" r="30" fill="#170E0A" />"""
)

# ------------------------------------------------------------------------------
# 2. A2: The Target Viewfinder (Four Corners)
# ------------------------------------------------------------------------------
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

# ------------------------------------------------------------------------------
# 3. A3: The Stadium Core (Meet Point Button Pill)
# ------------------------------------------------------------------------------
a3 = svg_header.format(
    title_id="title-a3",
    title="FreeWhen A3 — The Meet Point Stadium Core",
    body="""  <g fill="none" stroke="#170E0A" stroke-width="44" stroke-linecap="round">
    <path d="M 40 168 V 84 A 44 44 0 0 1 84 40 H 168" />
    <path d="M 216 88 V 172 A 44 44 0 0 1 172 216 H 88" />
  </g>
  <rect x="92" y="104" width="72" height="48" rx="24" fill="#170E0A" />"""
)

# ------------------------------------------------------------------------------
# 4. A4: The Diamond Viewfinder (Rotated 45°)
# ------------------------------------------------------------------------------
a4 = svg_header.format(
    title_id="title-a4",
    title="FreeWhen A4 — The Diamond Viewfinder",
    body="""  <g fill="none" stroke="#170E0A" stroke-width="44" stroke-linecap="round" transform="rotate(45 128 128)">
    <path d="M 40 168 V 84 A 44 44 0 0 1 84 40 H 168" />
    <path d="M 216 88 V 172 A 44 44 0 0 1 172 216 H 88" />
  </g>
  <circle cx="128" cy="128" r="30" fill="#170E0A" />"""
)

# ------------------------------------------------------------------------------
# 5. A5: The Interlocking Latch (Asymmetrical Grip)
# ------------------------------------------------------------------------------
# Top bracket extends further (wrapping 180°), creating a dynamic grip
a5 = svg_header.format(
    title_id="title-a5",
    title="FreeWhen A5 — The Interlocking Latch",
    body="""  <g fill="none" stroke="#170E0A" stroke-width="42" stroke-linecap="round">
    <path d="M 42 174 V 80 A 40 40 0 0 1 82 40 H 182" />
    <path d="M 214 82 V 176 A 40 40 0 0 1 174 216 H 74" />
  </g>
  <circle cx="128" cy="128" r="28" fill="#170E0A" />"""
)

# ------------------------------------------------------------------------------
# 6. A6: The Solid Card Portal (Inverse Negative Space)
# ------------------------------------------------------------------------------
# A solid squircle badge where the viewfinder brackets and Meet Point are
# expressed through clean negative space channels
a6 = svg_header.format(
    title_id="title-a6",
    title="FreeWhen A6 — The Solid Card Portal",
    body="""  <g fill="#170E0A">
    <!-- Top-Left Card Segment -->
    <path d="
      M 48 36
      H 136
      C 152 36 166 44 174 56
      L 56 174
      C 44 166 36 152 36 136
      V 48
      C 36 41.37 41.37 36 48 36 Z
    " />
    <!-- Bottom-Right Card Segment -->
    <path d="
      M 208 220
      H 120
      C 104 220 90 212 82 200
      L 200 82
      C 212 90 220 104 220 120
      V 208
      C 220 214.63 214.63 220 208 220 Z
    " />
    <!-- Floating Center Node -->
    <circle cx="128" cy="128" r="30" />
  </g>"""
)

files = {
    "a1-focus-nexus.svg": a1,
    "a2-target-viewfinder.svg": a2,
    "a3-stadium-core.svg": a3,
    "a4-diamond-viewfinder.svg": a4,
    "a5-interlocking-latch.svg": a5,
    "a6-solid-portal.svg": a6
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
    os.path.join(round2_dir, "a5-interlocking-latch.svg"),
    os.path.join(round2_dir, "a6-solid-portal.svg"),
    "--names",
    "A1 · The Focus Nexus",
    "A2 · Target Viewfinder",
    "A3 · Stadium Core",
    "A4 · Diamond Viewfinder",
    "A5 · Interlocking Latch",
    "A6 · Solid Card Portal",
    "--notes",
    "Two bold rounded brackets snapping inward; clean tactile focus lock.",
    "Four symmetrical corner brackets framing the agreed spot; universal target lock.",
    "Signature Meet Point horizontal pill docked inside the focus brackets.",
    "Brackets rotated 45° into top/bottom directional chevrons.",
    "Extended asymmetric wrap creating a mechanical clasp / latch feel.",
    "Solid squircle app tile with negative-space diagonal aperture.",
    "--title", "FreeWhen — Brand Concepts Round 2",
    "--subtitle", "Deeper exploration based on Concept A's focus lock geometry",
    "--recommend", "1",
    "-o", os.path.join(round2_dir, "concepts-round-2.png")
]
print("--- RUNNING CONCEPT SHEET ---")
subprocess.run(sheet_cmd, check=True)
print("SUCCESS: 6-concept sheet generated.")
