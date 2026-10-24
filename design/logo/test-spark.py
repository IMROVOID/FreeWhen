import subprocess
import os

svg_header = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-labelledby="{title_id}">
  <title id="{title_id}">{title}</title>
{body}
</svg>"""

out_dir = "R:/More/Projects/Apps/Mobile/FreeWhen-logo/design/logo/candidates-v4"
os.makedirs(out_dir, exist_ok=True)

# Concept: The Focus Spark (Brackets framing the Volt Flash of Agreement)
# Center: A bold 4-pointed curved star / spark
spark_path = """
  <!-- Central 4-pointed Decision Spark (The Volt Flash) -->
  <path d="
    M 128 92
    Q 128 128 92 128
    Q 128 128 128 164
    Q 128 128 164 128
    Q 128 128 128 92 Z
  " fill="#170E0A" />
"""

svg_text = svg_header.format(
    title_id="t-spark",
    title="Focus Spark — Brackets with Center Decision Spark",
    body=f"""  <g fill="none" stroke="#170E0A" stroke-width="44" stroke-linecap="round">
    <path d="M 40 168 V 84 A 44 44 0 0 1 84 40 H 168" />
    <path d="M 216 88 V 172 A 44 44 0 0 1 172 216 H 88" />
  </g>
  {spark_path}"""
)

svg_path = os.path.join(out_dir, "focus-spark.svg")
with open(svg_path, "w", encoding="utf-8") as f:
    f.write(svg_text)

subprocess.run([
    "python", ".agents/skills/logo-design/scripts/render_png.py",
    svg_path,
    "--out-dir", out_dir,
    "--size", "512"
], check=True)

print("Rendered focus-spark.")
