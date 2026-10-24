# FreeWhen — Brand & Logo Guidelines

> Official identity specifications for the **FreeWhen** mobile and web application.

---

## 1. Brand Identity & Idea

- **Concept:** **The Focus Nexus** (Non-typographic mark)
- **Idea:** Two heavy, tactile squircle brackets snapping inward to lock onto the central Meet Point node.
- **Brand Metaphor:** Scattered friend availability and travel options converging into **one clear, visible, confirmed decision** — with mathematical fairness for everyone.
- **Visual Hierarchy:** Anchored in FreeWhen's core design system (`radius.pill`, `radius.sm`, `espresso`, `tangerine`, `volt`).

---

## 2. Master Deliverables Directory

All production vector and raster assets are located in `design/logo/kit/`:

```
design/logo/kit/
├── masters/                              # Pure vector masters (100% production-ready)
│   ├── freewhen-symbol.svg               # Master single-colour filled vector
│   ├── freewhen-symbol-color.svg         # Brand dual-colour (Tangerine + Volt)
│   ├── freewhen-symbol-small.svg         # Tuned 16–32 px cut for favicons & status bars
│   ├── freewhen-wordmark.svg             # Outlined geometric wordmark
│   ├── freewhen-lockup-horizontal.svg    # Primary horizontal lockup (Symbol + Name)
│   └── freewhen-lockup-stacked.svg       # Centered stacked lockup (App splash & merchandise)
├── variants/                             # Exported variant bundles
│   ├── symbol/                           # Symbol in black, white, mono, square, app-icon
│   │   ├── favicon.ico                   # Multi-resolution ICO (16, 32, 48 px)
│   │   ├── apple-touch-icon.png          # iOS home screen icon (180 px)
│   │   ├── icon-192.png / icon-512.png   # Android PWA icons
│   │   ├── maskable-512.png              # Android adaptive maskable icon
│   │   ├── site.webmanifest              # Web application manifest
│   │   └── head-snippet.html             # Ready-to-paste <head> HTML snippet
│   ├── horizontal/                       # Lockup in black, white, mono (#FF7A2F), PNG 512 & 1024
│   └── stacked/                          # Stacked lockup in black, white, mono, PNG 512 & 1024
└── presentation/                         # Identity mockups & presentation board
    ├── presentation.html                 # Interactive slide deck
    └── slides/                           # High-resolution slide exports (slide-01 to 05)
```

---

## 3. Clear Space & Proportions

The exclusion zone is based on the diameter of the central **Meet Point node ($X = 60\text{ px}$ on the 256 px grid)**.

- **Clear space rule:** Keep at least **$1 \times X$** of unobstructed space on all four sides of the symbol and lockups.
- No UI controls, text, borders, or container edges may encroach into this exclusion zone.

---

## 4. Minimum Sizes

| Format | Minimum Digital Size | Minimum Print Size | File to Use |
|---|---|---|---|
| **Symbol (Icon / Favicon)** | 16 × 16 px | 6 × 6 mm | `freewhen-symbol-small.svg` or `favicon-16.png` |
| **Horizontal Lockup** | 120 × 32 px | 30 × 8 mm | `freewhen-lockup-horizontal.svg` |
| **Stacked Lockup** | 80 × 64 px | 20 × 16 mm | `freewhen-lockup-stacked.svg` |

---

## 5. Colour Specifications

Matches FreeWhen design tokens (`src/theme/tokens.ts`):

| Token | Role | HEX | RGB | Use Case |
|---|---|---|---|---|
| `espresso` | Ink / Dark Neutral | `#170E0A` | 23, 14, 10 | Primary text, one-colour logo on light, base tile |
| `tangerine` | Primary Brand Fill | `#FF7A2F` | 255, 122, 47 | Hero blocks, focus brackets, primary brand mono |
| `volt` | Decision / Meet Point | `#D4FF3A` | 212, 255, 58 | Meet Point node on dark ink, final confirmed state |
| `bg_dark` | Dark Canvas | `#120A07` | 18, 10, 7 | Screen background, dark theme app icon tile |
| `bg_light` | Light Canvas (Paper) | `#FBF5EF` | 251, 245, 239 | Screen background, warm paper light theme |

### Approved Background Pairings
1. **Full-Colour on Dark Ink (`#120A07`):** Tangerine `#FF7A2F` brackets with Volt `#D4FF3A` node (maximum energy).
2. **Full-Colour on Light Paper (`#FBF5EF`):** Tangerine `#FF7A2F` brackets with Espresso `#170E0A` node.
3. **One-Colour Reversed:** All white/cream (`#FFF6EF`) on dark or photography.
4. **One-Colour Ink:** All espresso (`#170E0A`) on light backgrounds or mono print.
5. **Brand Mono:** All tangerine (`#FF7A2F`) on light or dark neutral surfaces.

---

## 6. Typography

- **Latin Script (English):** **Plus Jakarta Sans** (ExtraBold 800 for wordmark, Bold 700 / Medium 500 for UI).
- **Persian Script (Farsi):** **Vazirmatn** (Black 800 / Bold 700 for headlines, Regular 400 for body).
- **Numerals:** Native Persian digits rendered via Vazirmatn FD.

---

## 7. Don'ts (Misuse Rules)

- **Do NOT** stretch, condense, or alter the aspect ratio of the brackets or node.
- **Do NOT** rotate the mark away from its horizontal/vertical orientation (rotational balance is intentional).
- **Do NOT** use drop shadows, gradients, skeuomorphic glows, or 3D extrusions on the mark.
- **Do NOT** place the Volt node directly on a white or light background (fails WCAG contrast).
- **Do NOT** recreate the wordmark using live standard text — always use the outlined vector paths in `masters/`.
