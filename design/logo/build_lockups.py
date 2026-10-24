import os
import subprocess

masters_dir = "R:/More/Projects/Apps/Mobile/FreeWhen-logo/design/logo/kit/masters"

# Let's craft the vector paths for the wordmark "FreeWhen"
# Using Plus Jakarta Sans inspired geometry (geometric sans, heavy weight, round counters)
# Baseline at y = 164. Cap height = 112 (top at y = 52). x-height = 80 (top at y = 84).

# We can construct the geometric letterforms precisely:
wordmark_svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 620 256" width="620" height="256" role="img" aria-labelledby="title-wm">
  <title id="title-wm">FreeWhen — Wordmark</title>
  <g fill="#170E0A">
    <!-- F (x: 20 to 76) -->
    <path d="M 24 52 H 78 V 74 H 46 V 98 H 72 V 120 H 46 V 164 H 24 Z" />
    
    <!-- r (x: 88 to 132) -->
    <path d="M 90 84 H 112 V 104 C 116 92 126 84 138 84 V 106 C 124 106 112 116 112 130 V 164 H 90 Z" />
    
    <!-- e (x: 142 to 198) -->
    <path fill-rule="evenodd" d="M 142 124 C 142 101 156 84 172 84 C 188 84 200 99 200 124 H 164 C 164 136 171 144 182 144 C 189 144 195 140 198 134 L 200 152 C 193 160 183 166 170 166 C 153 166 142 150 142 124 Z M 164 110 H 178 C 178 102 174 98 171 98 C 167 98 164 102 164 110 Z" />
    
    <!-- e (x: 208 to 264) -->
    <path fill-rule="evenodd" d="M 208 124 C 208 101 222 84 238 84 C 254 84 266 99 266 124 H 230 C 230 136 237 144 248 144 C 255 144 261 140 264 134 L 266 152 C 259 160 249 166 236 166 C 219 166 208 150 208 124 Z M 230 110 H 244 C 244 102 240 98 237 98 C 233 98 230 102 230 110 Z" />
    
    <!-- W (x: 284 to 380) -->
    <path d="M 284 52 H 308 L 324 128 L 338 52 H 356 L 370 128 L 386 52 H 410 L 386 164 H 360 L 347 98 L 334 164 H 308 Z" />
    
    <!-- h (x: 418 to 470) -->
    <path d="M 420 52 H 442 V 104 C 447 91 458 84 470 84 C 484 84 494 94 494 112 V 164 H 472 V 116 C 472 106 467 102 460 102 C 451 102 442 110 442 122 V 164 H 420 Z" />
    
    <!-- e (x: 504 to 560) -->
    <path fill-rule="evenodd" d="M 504 124 C 504 101 518 84 534 84 C 550 84 562 99 562 124 H 526 C 526 136 533 144 544 144 C 551 144 557 140 560 134 L 562 152 C 555 160 545 166 532 166 C 515 166 504 150 504 124 Z M 526 110 H 540 C 540 102 536 98 533 98 C 529 98 526 102 526 110 Z" />
    
    <!-- n (x: 572 to 622) -->
    <path d="M 574 84 H 596 V 104 C 601 91 612 84 624 84 C 638 84 648 94 648 112 V 164 H 626 V 116 C 626 106 621 102 614 102 C 605 102 596 110 596 122 V 164 H 574 Z" />
  </g>
</svg>"""

with open(os.path.join(masters_dir, "freewhen-wordmark.svg"), "w", encoding="utf-8") as f:
    f.write(wordmark_svg)

# Horizontal Lockup: Symbol (256x256 scaled to 184x184) + Wordmark
# viewBox: 0 0 880 256
horizontal_lockup_svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 256" width="920" height="256" role="img" aria-labelledby="title-hz">
  <title id="title-hz">FreeWhen — Horizontal Lockup</title>
  <!-- Symbol at left -->
  <g transform="translate(24, 24) scale(0.8125)">
    <!-- Top-Left Bracket -->
    <path fill="#FF7A2F" d="M 18 168 V 84 A 66 66 0 0 1 84 18 H 168 A 22 22 0 0 1 168 62 H 84 A 22 22 0 0 0 62 84 V 168 A 22 22 0 0 1 18 168 Z" />
    <!-- Bottom-Right Bracket -->
    <path fill="#FF7A2F" d="M 238 88 V 172 A 66 66 0 0 1 172 238 H 88 A 22 22 0 0 1 88 194 H 172 A 22 22 0 0 0 194 172 V 88 A 22 22 0 0 1 238 88 Z" />
    <!-- Central Meet Point Node -->
    <circle fill="#170E0A" cx="128" cy="128" r="30" />
  </g>
  <!-- Wordmark at right -->
  <g transform="translate(248, 0)" fill="#170E0A">
    <!-- F -->
    <path d="M 24 52 H 78 V 74 H 46 V 98 H 72 V 120 H 46 V 164 H 24 Z" />
    <!-- r -->
    <path d="M 90 84 H 112 V 104 C 116 92 126 84 138 84 V 106 C 124 106 112 116 112 130 V 164 H 90 Z" />
    <!-- e -->
    <path fill-rule="evenodd" d="M 142 124 C 142 101 156 84 172 84 C 188 84 200 99 200 124 H 164 C 164 136 171 144 182 144 C 189 144 195 140 198 134 L 200 152 C 193 160 183 166 170 166 C 153 166 142 150 142 124 Z M 164 110 H 178 C 178 102 174 98 171 98 C 167 98 164 102 164 110 Z" />
    <!-- e -->
    <path fill-rule="evenodd" d="M 208 124 C 208 101 222 84 238 84 C 254 84 266 99 266 124 H 230 C 230 136 237 144 248 144 C 255 144 261 140 264 134 L 266 152 C 259 160 249 166 236 166 C 219 166 208 150 208 124 Z M 230 110 H 244 C 244 102 240 98 237 98 C 233 98 230 102 230 110 Z" />
    <!-- W -->
    <path d="M 284 52 H 308 L 324 128 L 338 52 H 356 L 370 128 L 386 52 H 410 L 386 164 H 360 L 347 98 L 334 164 H 308 Z" />
    <!-- h -->
    <path d="M 420 52 H 442 V 104 C 447 91 458 84 470 84 C 484 84 494 94 494 112 V 164 H 472 V 116 C 472 106 467 102 460 102 C 451 102 442 110 442 122 V 164 H 420 Z" />
    <!-- e -->
    <path fill-rule="evenodd" d="M 504 124 C 504 101 518 84 534 84 C 550 84 562 99 562 124 H 526 C 526 136 533 144 544 144 C 551 144 557 140 560 134 L 562 152 C 555 160 545 166 532 166 C 515 166 504 150 504 124 Z M 526 110 H 540 C 540 102 536 98 533 98 C 529 98 526 102 526 110 Z" />
    <!-- n -->
    <path d="M 574 84 H 596 V 104 C 601 91 612 84 624 84 C 638 84 648 94 648 112 V 164 H 626 V 116 C 626 106 621 102 614 102 C 605 102 596 110 596 122 V 164 H 574 Z" />
  </g>
</svg>"""

with open(os.path.join(masters_dir, "freewhen-lockup-horizontal.svg"), "w", encoding="utf-8") as f:
    f.write(horizontal_lockup_svg)

# Stacked Lockup: Symbol on top, Wordmark below
# viewBox: 0 0 512 400
stacked_lockup_svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 400" width="512" height="400" role="img" aria-labelledby="title-st">
  <title id="title-st">FreeWhen — Stacked Lockup</title>
  <!-- Symbol Centred -->
  <g transform="translate(156, 16) scale(0.78125)">
    <path fill="#FF7A2F" d="M 18 168 V 84 A 66 66 0 0 1 84 18 H 168 A 22 22 0 0 1 168 62 H 84 A 22 22 0 0 0 62 84 V 168 A 22 22 0 0 1 18 168 Z" />
    <path fill="#FF7A2F" d="M 238 88 V 172 A 66 66 0 0 1 172 238 H 88 A 22 22 0 0 1 88 194 H 172 A 22 22 0 0 0 194 172 V 88 A 22 22 0 0 1 238 88 Z" />
    <circle fill="#170E0A" cx="128" cy="128" r="30" />
  </g>
  <!-- Wordmark Centred below -->
  <g transform="translate(46, 220) scale(0.65)" fill="#170E0A">
    <!-- F -->
    <path d="M 24 52 H 78 V 74 H 46 V 98 H 72 V 120 H 46 V 164 H 24 Z" />
    <!-- r -->
    <path d="M 90 84 H 112 V 104 C 116 92 126 84 138 84 V 106 C 124 106 112 116 112 130 V 164 H 90 Z" />
    <!-- e -->
    <path fill-rule="evenodd" d="M 142 124 C 142 101 156 84 172 84 C 188 84 200 99 200 124 H 164 C 164 136 171 144 182 144 C 189 144 195 140 198 134 L 200 152 C 193 160 183 166 170 166 C 153 166 142 150 142 124 Z M 164 110 H 178 C 178 102 174 98 171 98 C 167 98 164 102 164 110 Z" />
    <!-- e -->
    <path fill-rule="evenodd" d="M 208 124 C 208 101 222 84 238 84 C 254 84 266 99 266 124 H 230 C 230 136 237 144 248 144 C 255 144 261 140 264 134 L 266 152 C 259 160 249 166 236 166 C 219 166 208 150 208 124 Z M 230 110 H 244 C 244 102 240 98 237 98 C 233 98 230 102 230 110 Z" />
    <!-- W -->
    <path d="M 284 52 H 308 L 324 128 L 338 52 H 356 L 370 128 L 386 52 H 410 L 386 164 H 360 L 347 98 L 334 164 H 308 Z" />
    <!-- h -->
    <path d="M 420 52 H 442 V 104 C 447 91 458 84 470 84 C 484 84 494 94 494 112 V 164 H 472 V 116 C 472 106 467 102 460 102 C 451 102 442 110 442 122 V 164 H 420 Z" />
    <!-- e -->
    <path fill-rule="evenodd" d="M 504 124 C 504 101 518 84 534 84 C 550 84 562 99 562 124 H 526 C 526 136 533 144 544 144 C 551 144 557 140 560 134 L 562 152 C 555 160 545 166 532 166 C 515 166 504 150 504 124 Z M 526 110 H 540 C 540 102 536 98 533 98 C 529 98 526 102 526 110 Z" />
    <!-- n -->
    <path d="M 574 84 H 596 V 104 C 601 91 612 84 624 84 C 638 84 648 94 648 112 V 164 H 626 V 116 C 626 106 621 102 614 102 C 605 102 596 110 596 122 V 164 H 574 Z" />
  </g>
</svg>"""

with open(os.path.join(masters_dir, "freewhen-lockup-stacked.svg"), "w", encoding="utf-8") as f:
    f.write(stacked_lockup_svg)

print("Wordmark and Lockups built.")
