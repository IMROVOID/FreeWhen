<div align="center">

# FreeWhen

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](./package.json)
[![Expo](https://img.shields.io/badge/Expo-~58.0.16-000020?logo=expo&logoColor=white)](https://expo.dev/)
[![React Native](https://img.shields.io/badge/React%20Native-0.88.0-61DAFB?logo=react&logoColor=black)](https://reactnative.dev/)
[![React](https://img.shields.io/badge/React-19.3.0-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-~6.0.3-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js Version](https://img.shields.io/badge/Node.js-%3E%3D22.13.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Locale](https://img.shields.io/badge/Locale-Persian%20RTL%20%7C%20Jalali-emerald)](https://github.com/jalaali/jalaali-js)
[![Routing](https://img.shields.io/badge/Routing-Neshan%20%7C%20ORS-orange)](https://neshan.org/)
[![Backend](https://img.shields.io/badge/Database-PostgreSQL%20%7C%20Supabase-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com/)

<p align="center">
  FreeWhen turns a group's scattered time and place suggestions into <b>one clear, visible, confirmed decision</b> — and shows, with evidence, why that choice is <b>fair for everyone</b>.
</p>

[English](README.md) • [فارسی](README.fa.md)

[Overview](#what-is-freewhen) • [Features](#key-features) • [Quick Start](#quick-start) • [Scoring Lenses](#decision-engine--scoring-lenses) • [Clients](#client-integration) • [Architecture](#architecture--structure) • [Guides](#advanced-guides) • [Development](#development--testing) • [Reviewer Path](#reviewer-quick-start--one-url-two-minutes) • [Runbook](#runbook--building-and-deploying) • [Contributing](#contributing) • [Disclaimer](#disclaimer--legal-notice) • [References](#references--acknowledgements) • [License](#license)

</div>

## Table of Contents

- [What is FreeWhen?](#what-is-freewhen)
- [Key Features](#key-features)
- [Quick Start](#quick-start)
  - [Method 1: Local Mobile Development](#method-1-local-mobile-development)
  - [Method 2: Static Web Export & Preview](#method-2-static-web-export--preview)
  - [Method 3: Local Backend Services](#method-3-local-backend-services)
  - [Method 4: Production Deployment](#method-4-production-deployment)
- [Decision Engine & Scoring Lenses](#decision-engine--scoring-lenses)
- [Client Integration](#client-integration)
- [Architecture & Structure](#architecture--structure)
- [Advanced Guides](#advanced-guides)
  - [Fairness Math & Utility Scoring](#fairness-math--utility-scoring)
  - [Dual Backend & Realtime Synchronization](#dual-backend--realtime-synchronization)
  - [Environment Variables](#environment-variables)
- [Development & Testing](#development--testing)
  - [Quality & Release Gates](#quality--release-gates)
  - [Automated Test Suites](#automated-test-suites)
  - [Building Release Artifacts](#building-release-artifacts)
- [Reviewer Quick-Start — One URL, Two Minutes](#reviewer-quick-start--one-url-two-minutes)
  - [What is real, what is estimated, what is missing](#what-is-real-what-is-estimated-what-is-missing)
- [Runbook — Building and Deploying](#runbook--building-and-deploying)
  - [The seven release gates](#the-seven-release-gates)
  - [Build the web artifact](#build-the-web-artifact)
  - [Build the APK](#build-the-apk)
  - [Deploy](#deploy)
  - [Rollback](#rollback)
  - [Analytics](#analytics)
- [Contributing](#contributing)
- [Known Gaps](#known-gaps)
- [Disclaimer & Legal Notice](#disclaimer--legal-notice)
- [References & Acknowledgements](#references--acknowledgements)
- [License](#license)

## What is FreeWhen?

When a group of friends plans an outing, suggestions get lost in chat history, nobody knows who agreed to what, logistics drag on, and people who rely on public transport or live on the edge of town always travel furthest.

**FreeWhen** resolves that coordination chaos:

1. **Evidence-Based Fairness**: Evaluates travel time, walking distance, transit transfers, nighttime safety, and physical accessibility for every participant.
2. **Deterministic Engine**: Runs pure, reproducible ranking calculations with zero network side effects and four named aggregation lenses.
3. **Persian & Jalali Native**: Built from the ground up for Iranian users with native RTL layout, Jalali calendar math, Persian typography, and local transit routing.
4. **Frictionless Participation**: Participants join instantly via an invite link (`/e/:token`) on the web without installing an app or registering an account.
5. **Privacy by Design**: Truncates location coordinates to 2 decimals (~1.1 km resolution), prohibits background location tracking, and enforces automated secret scanning gates.

> **Note**: FreeWhen supports both a self-hosted **Supabase** backend and a completely standalone **local PostgreSQL + PostgREST** stack (`docker-compose.local.yml`). Switching requires changing a single environment variable (`DATABASE_BACKEND`), with zero client code alterations.

> **Reference**: Specifications and technical blueprints are documented in [`docs/prd/00-MASTER-OVERVIEW.md`](docs/prd/00-MASTER-OVERVIEW.md) and [`docs/prd/10-TECHNICAL-ARCHITECTURE.md`](docs/prd/10-TECHNICAL-ARCHITECTURE.md).

## Key Features

- **Four Aggregation Lenses**: Explicit, named decision models (**Balanced**, **Fastest**, **Fairest**, **Cheapest**) rooted in social choice theory and Arrow's theorem.
- **Provider Degradation Ladder**: Resilient travel matrix pipeline falling back gracefully: `Neshan Matrix` → `Neshan Direction` → `OpenRouteService` → `Straight-line (Haversine)`.
- **Tri-State Accessibility**: Tracks accessibility attributes (`confirmed_yes`, `confirmed_no`, `unknown`). Absent data is treated as unknown, never assumed accessible.
- **Bilingual & RTL-First**: Seamless Persian (fa) and English (en) support with Persian numeral conversion, localized reasoning templates, and automatic text directionality.
- **Dual Backend Architecture**: Full parity between cloud-ready Supabase and an independent local stack (PostgreSQL 15 + PostgREST 12 + Node.js Auth & WebSocket Bridge).
- **Enforced Security Gates**: Seven pre-commit and pre-deploy automated validation gates (`npm run gate:all`) that block secret leaks, PII logging, unscaled design tokens, and unreviewed permissions.
- **Zero-Install Review Path**: Static web bundle export (`npm run export:web`) served instantly to any mobile or desktop browser without requiring an app store download.

## Quick Start

### Method 1: Local Mobile Development

#### Step 1: Clone and Install Dependencies

```bash
git clone https://github.com/IMROVOID/FreeWhen.git
cd FreeWhen
npm install
```

Prerequisites: **Node.js ≥ 22.13**, **Java JDK 17**, and **Android Studio** (for local Android emulation).

#### Step 2: Configure Environment

Copy the template configuration:

```bash
cp .env.example .env
```

Set the client-facing variables in `.env`:

```ini
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-anon-key
EXPO_PUBLIC_APP_BASE_URL=http://127.0.0.1:8081
```

#### Step 3: Run the Development Server

Start Expo Metro bundler:

```bash
npm start
```

Launch directly on an Android emulator or device:

```bash
npm run android
```

> **Note**: An Expo account is **not required**. FreeWhen builds locally via `npx expo run:android` and does not depend on cloud build services (PRD-10 D2).

### Method 2: Static Web Export & Preview

Serve the full web application locally or review the responsive UI:

#### Step 1: Export Static Web Bundle

```bash
npm run export:web
```

This compiles a clean, static single-page application into `dist/` with native RTL layout and Persian language metadata pre-configured.

#### Step 2: Verify and Audit Bundle

Run the automated web gate to guarantee no secret tokens or server credentials leaked into the bundle:

```bash
npm run gate:web
```

#### Step 3: Serve the Web App

```bash
npx serve dist -l 8081
```

Access the client at `http://localhost:8081`.

### Method 3: Local Backend Services

Run a self-contained local backend without external cloud dependencies using Docker Compose:

#### Step 1: Start PostgreSQL and PostgREST

```bash
npm run db:local:up
```

#### Step 2: Apply Migrations and Seed Data

```bash
npm run db:migrate
npm run db:seed
```

#### Step 3: Start Local Auth and Realtime Services

In separate terminals:

```bash
# Terminal 1: Token signing & anonymous auth service (port 8789)
npm run server:auth

# Terminal 2: WebSocket realtime event bridge (port 8788)
npm run server:realtime
```

### Method 4: Production Deployment

Deploy FreeWhen to a self-hosted cloud server or container:

1. **Database**: Spin up PostgreSQL 15+ with `migrations/000_portability.sql` through `015_realtime_notify.sql`.
2. **Reverse Proxy (Caddy / Nginx)**:
   - Route `/auth/v1/*` to the auth service on port `8789`.
   - Route `/realtime/v1/*` to the realtime bridge on port `8788`.
   - Route `/rest/v1/*` to PostgREST.
   - Serve the exported static bundle `dist/` at the root `/`.
3. **Environment**: Ensure `DATABASE_BACKEND=local_pg` (or `supabase`) and production API keys for Neshan are loaded.

## Decision Engine & Scoring Lenses

Under Arrow’s impossibility theorem, no single voting rule satisfies all fairness criteria simultaneously. FreeWhen solves this by offering four distinct, transparent aggregation lenses:

| Lens | Optimization Rule | Social Choice Model | Default Winner Profile |
|---|---|---|---|
| **Balanced** | `argmax lexicographic (floor, mean)` | Rawlsian Maximin + Utilitarian | Maximizes utility for the most burdened participant; breaks ties using average travel time. (Default) |
| **Fastest** | `argmin totalTime` | Utilitarian / Benthamite | Minimizes the combined travel minutes of the entire group. |
| **Fairest** | `argmin gap` *(Floor-Guarded)* | Egalitarian / Minimized Disparity | Minimizes the difference between closest and furthest traveler, guarding against equal misery. |
| **Cheapest** | `argmin totalCost` | Economic Efficiency | Minimizes total estimated out-of-pocket costs (IRR). Null costs are never treated as free. |

### Reason Templates & Localized Explanations

The engine never emits hardcoded prose strings. It returns template IDs and numeric parameters, rendered by the client in the active locale:

| Template ID | Parameter Signature | Description |
|---|---|---|
| `balanced_headline` | `{ floorMinutes, meanMinutes }` | Headline travel minutes for the most burdened and average member. |
| `fastest_headline` | `{ totalMinutes }` | Combined travel minutes for the whole group. |
| `fairest_headline` | `{ gapMinutes, floorMinutes }` | Travel spread gap while maintaining the minimum floor threshold. |
| `cheapest_headline` | `{ totalCostIrr }` | Estimated group travel and parking expenditure. |
| `coverage_missing` | `{ missingCount }` | Identifies participants whose location was not shared or resolvable. |
| `low_confidence` | `—` | Signals that one or more estimates rely on straight-line models or approximations. |
| `excluded_filter` | `{ venueName, reason }` | Explains why a candidate venue failed hard constraints (e.g., closed or inaccessible). |

## Client Integration

<details>
<summary><b>Android (Emulator & Physical Devices)</b></summary>

```bash
# Verify attached Android devices or running emulators
adb devices

# Build and run debug APK locally
npm run android
```

The APK is built locally without cloud services. Edge-to-edge rendering and system navigation bar coloring are automatically configured.

</details>

<details>
<summary><b>iOS (Simulator & Native Build)</b></summary>

```bash
# Generate native iOS project files
npx expo prebuild --platform ios

# Launch in Xcode Simulator
npm run ios
```

Requires macOS with Xcode installed. Mixed Persian and English localizations are declared in `Info.plist`.

</details>

<details>
<summary><b>Web Browser (PWA & Mobile Web)</b></summary>

```bash
# Export static distribution
npm run export:web

# Serve locally
npx serve dist -l 8081
```

Includes viewport fitting, meta theme color (`#120A07`), RTL root attributes, and zero-install client joining.

</details>

<details>
<summary><b>Deep Links & Universal URLs</b></summary>

FreeWhen registers the custom scheme `freewhen://` and handles universal web links:

| Pattern | Target | Purpose |
|---|---|---|
| `freewhen://e/:token` | `app/e/[token].tsx` | Native deep link to join an event via invite token. |
| `https://freewhen.ir/e/:token` | Universal Link | Web and native fallback invite URL. |
| `freewhen://event/:id` | `app/event/[id].tsx` | Direct navigation to an active event dashboard. |

</details>

## Architecture & Structure

```
FreeWhen/
├── app/                          # Expo Router file-based screens
│   ├── +html.tsx                 # Web document wrapper (dir="rtl", lang="fa")
│   ├── _layout.tsx               # Root layout, theme provider, fonts, i18n
│   ├── index.tsx                 # Home / Landing screen
│   ├── e/                        # Event invite handler & token redemption
│   ├── event/                    # Event view, voting, proposals, decision screens
│   └── new/                      # Event creation wizard
├── src/
│   ├── app-bootstrap.ts          # Early bootstrap, fonts, i18n initialization
│   ├── components/               # UI components
│   │   ├── MeetPoint.tsx         # Meeting point visualizer
│   │   └── ui/                   # 12 accessible design system primitives
│   │       ├── Avatar.tsx        # Participant avatar
│   │       ├── BottomSheet.tsx   # Gesture-driven bottom sheet
│   │       ├── Button.tsx        # Accessible pressable button
│   │       ├── Card.tsx          # Elevated surface card
│   │       ├── Chip.tsx          # Tag and filter pill
│   │       ├── EmptyState.tsx    # Empty state graphic & message
│   │       ├── GlassSurface.tsx  # Liquid glass backdrop blur surface
│   │       ├── Input.tsx         # Text field with RTL/LTR auto-direction
│   │       ├── Pressy.tsx        # Spring animated touch wrapper
│   │       ├── Stepper.tsx       # Multi-step progress indicator
│   │       ├── TabBar.tsx        # Navigation bar
│   │       ├── Text.tsx          # Typography with Persian font integration
│   │       └── Toast.tsx         # Floating alert banner
│   ├── engine/                   # Pure, deterministic fairness engine
│   │   ├── config.ts             # Engine mathematical parameters & defaults
│   │   ├── coverage.ts           # Participant measurement completeness
│   │   ├── explain.ts            # Localized reason & conflict template builder
│   │   ├── filters.ts            # Hard constraints (closing hours, step-free)
│   │   ├── lenses.ts             # 4 aggregation lenses (Balanced, Fastest, Fairest, Cheapest)
│   │   ├── score.ts              # Core venue scoring & ranking pipeline
│   │   ├── transit-proxy.ts      # Metro/BRT transit time & detour estimation
│   │   ├── types.ts              # Engine contracts, TriState, ParticipantContext
│   │   └── utility.ts            # Piecewise linear utility functions (0–100)
│   ├── features/                 # Domain-specific feature modules
│   ├── i18n/                     # Internationalization & localization
│   │   ├── en.json               # English translation catalog
│   │   ├── fa.json               # Persian translation catalog (191+ keys)
│   │   └── index.ts              # i18next configuration & language detector
│   ├── lib/                      # Core cross-cutting utilities
│   │   ├── api.ts                # Typed client API client
│   │   ├── errors.ts             # Standardized domain error classes
│   │   ├── format.ts             # Persian/English digits & currency formatters
│   │   ├── jalali.ts             # Jalali (Solar Hijri) calendar utilities
│   │   ├── redact.ts             # Zero-leak logging & PII masking
│   │   └── session.ts            # Local identity & auth state management
│   ├── platform/                 # Cross-platform adapters
│   │   ├── direction.ts          # RTL / LTR layout direction hooks
│   │   └── haptics.ts            # Native tactile feedback wrappers
│   ├── routing/                  # Travel routing & distance matrix
│   │   ├── adapters/             # Routing provider implementations
│   │   │   ├── neshan-direction.ts # Neshan directions routing
│   │   │   ├── neshan-errors.ts    # Neshan API error handling
│   │   │   ├── neshan-matrix.ts   # Neshan distance matrix adapter
│   │   │   ├── no-estimate.ts     # Fallback when no routing available
│   │   │   ├── ors.ts             # OpenRouteService provider
│   │   │   └── straight-line.ts   # Haversine distance fallback
│   │   ├── cache.ts              # Two-layer in-memory & persistent cache
│   │   ├── config.ts             # Routing configuration & thresholds
│   │   ├── index.ts              # Unified travel router & degradation ladder
│   │   ├── ladder.ts             # Fallback ladder orchestration
│   │   ├── prefilter.ts          # Geographic bounding box & venue filtering
│   │   ├── provider.ts           # Provider factory & key resolver
│   │   ├── transit.ts            # Tehran Metro/BRT transit proxy
│   │   └── types.ts              # TravelMeasurement & Confidence contracts
│   ├── theme/                    # Design system tokens & styling
│   │   ├── appearance-store.ts   # Dark / light theme state
│   │   ├── font-assets.ts        # Font asset loader (Plus Jakarta Sans, Vazirmatn)
│   │   ├── fonts.ts              # Font family contracts
│   │   ├── motion.ts             # Spring & timing animation configs
│   │   ├── tokens.ts             # Color palette, spacing, and radius tokens
│   │   ├── type-scale.ts         # Proportional typographic scale
│   │   ├── useMotion.ts          # Motion hook wrapper
│   │   └── useTheme.ts           # Active theme hook
│   └── types/                    # Core shared TypeScript definitions
│       ├── domain.ts             # Event, proposal, vote, venue entities
│       └── event.ts              # Event lifecycle contracts
├── server/                       # Backend API & service layer
│   ├── auth/                     # Anonymous authentication & JWT issuing
│   ├── realtime/                 # WebSocket realtime change bridge
│   ├── routes/                   # Route handlers (rank-travel, invite, etc.)
│   └── index.ts                  # Backend server entry point
├── migrations/                   # PostgreSQL schema migrations (000–015)
├── scripts/                      # Toolchain, gates & maintenance scripts
│   ├── gate/                     # 7 automated release gate scripts
│   │   ├── credential-shapes.ts  # Secret regex and shape definitions
│   │   ├── design.ts             # Hardcoded style & token audit
│   │   ├── engine-purity.ts      # Zero external import gate for engine
│   │   ├── i18n.ts               # Translation parity & missing keys gate
│   │   ├── location.ts           # Background location prevention gate
│   │   ├── logs.ts               # Logger redaction verification gate
│   │   ├── secrets.ts            # Secret leaking prevention gate
│   │   ├── shared.ts             # Gate runner utilities
│   │   └── web.ts                # Web dist leakage audit gate
│   ├── db/                       # Database migration and seed runners
│   ├── docs/                     # Documentation tools & validators
│   ├── run-engine-tests.ts       # Engine-specific test runner
│   └── run-tests.ts              # Project test runner (400+ tests)
├── tests/                        # Automated test suites
├── docs/                         # Specification & PRD archive (PRD-00..PRD-18)
├── assets/                       # Static app icons, splash images & fonts
├── docker-compose.local.yml      # Local Postgres & PostgREST stack
├── app.json                      # Expo app configuration
├── package.json                  # Dependencies & npm scripts
├── tsconfig.json                 # TypeScript compiler options
├── LICENSE                       # MIT License
└── .env.example                  # Environment variable template
```

## Advanced Guides

### Fairness Math & Utility Scoring

FreeWhen translates individual travel measurements into a normalized utility score in the range `[0, 100]`:

$$\text{utility}(t) = \max\left(0, 100 \cdot \left(1 - \frac{t}{T_{\text{max}}}\right)\right)$$

Where $t$ is effective travel minutes (including walking, transit transfers, and nighttime penalties), and $T_{\text{max}}$ is the participant's budget (default 90 minutes).

1. **Night Travel Penalty**: When an event occurs after dark and a participant declared `avoidsNightTravel`, travel time is weighted by a 1.35× factor.
2. **Transit Proxy Detour**: For public transit without a live routing matrix, straight-line distance is adjusted using a 1.4× Tehran road network detour factor with speed profiling (22 km/h).
3. **Exact Aggregation**: Floating-point calculations maintain 64-bit IEEE precision across intermediate matrices and round exactly once at the final step (`round2`).

### Dual Backend & Realtime Synchronization

FreeWhen guarantees seamless data portability between two swappable backends:

```
┌────────────────────────────────────────────────────────┐
│                   FreeWhen Client                      │
│            (Web / Android APK / iOS App)               │
└──────────────────────────┬─────────────────────────────┘
                           │
             DATABASE_BACKEND switch
             ┌─────────────┴─────────────┐
             ▼                           ▼
 ┌───────────────────────┐   ┌───────────────────────┐
 │   Supabase Backend    │   │  Local Postgres Stack │
 │  - GoTrue Auth        │   │  - auth/ service:8789 │
 │  - PostgREST API      │   │  - PostgREST:3000     │
 │  - Realtime CDC       │   │  - realtime ws:8788   │
 └───────────────────────┘   └───────────────────────┘
```

- **Authentication**: Issues standard HS256 JWTs with claim `role: authenticated` and custom claim `is_anonymous: true`.
- **Realtime Bridge**: On the local stack, PostgreSQL `NOTIFY event_changes` triggers an async multiplexer that dispatches changes across connected WebSockets scoped strictly to event participants.

### Environment Variables

FreeWhen strictly distinguishes between client-inlined variables and server-only credentials:

#### 1. Client Variables (Inlined at Build Time)

| Variable | Required | Description | Default |
|---|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Yes | Supabase endpoint URL | `—` |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | RLS-protected publishable anon key | `—` |
| `EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN` | Yes (map) | Restricted Mapbox public token (`pk.*`) | `—` |
| `EXPO_PUBLIC_TILE_STYLE_URL` | No | Custom vector tile style URL | `—` |
| `EXPO_PUBLIC_APP_BASE_URL` | Yes | Base URL used to formulate invite links | `—` |
| `EXPO_PUBLIC_DEMO_TOKEN` | Yes (reviewer path) | The stable invite token `/start` routes to. Must resolve to the seeded `is_demo` event | `—` |

#### 2. Server-Only Credentials (Never in Client Bundles)

| Variable | Required | Scope / Mode | Description | Default |
|---|---|---|---|---|
| `DATABASE_BACKEND` | Yes | All | Backend selector: `supabase` or `local_pg` | `supabase` |
| `SUPABASE_SECRET_KEY` | Yes (Supabase) | Server | Service-role key with full RLS bypass | `—` |
| `JWT_SECRET` | Yes | Server | Shared signing key for tokens & PostgREST | `—` |
| `NESHAN_API_KEY` | Yes (routing) | Server | Shared API key for Neshan matrix & direction | `—` |
| `NESHAN_MATRIX_API_KEY` | No | Server | Dedicated Neshan matrix key | `—` |
| `NESHAN_DIRECTION_API_KEY` | No | Server | Dedicated Neshan direction routing key | `—` |
| `ORS_API_KEY` | No | Server | OpenRouteService API key fallback | `—` |
| `POSTGRES_PASSWORD` | Yes (local_pg) | Server | Master PostgreSQL password | `—` |
| `POSTGRES_USER` | No | Server | PostgreSQL username | `postgres` |
| `POSTGRES_DB` | No | Server | PostgreSQL database name | `freewhen` |
| `DATABASE_URL` | Yes (local_pg) | Server | Full database connection string | `—` |
| `AUTH_PORT` | No | Server | Local auth daemon listen port | `8789` |
| `REALTIME_PORT` | No | Server | Local realtime bridge listen port | `8788` |
| `ANON_SIGNIN_LIMIT_PER_HOUR` | No | Server | Rate limit for anonymous sign-ins per IP | `30` |
| `ANON_TOKEN_TTL_SECONDS` | No | Server | Lifetime of issued anonymous token (seconds) | `3600` |

## Development & Testing

### Quality & Release Gates

All seven validation gates must pass cleanly (`exit 0`) before any PR merge or release deployment:

```bash
npm run gate:all
```

| Gate Script | Command | Purpose |
|---|---|---|
| `gate:secrets` | `npm run gate:secrets` | Scans source and bundles for leaked server credentials or API keys. |
| `gate:location` | `npm run gate:location` | Rejects background location permission declarations in manifests. |
| `gate:engine-purity` | `npm run gate:engine-purity` | Asserts that `src/engine/` has zero dependencies on React Native, Expo, or I/O. |
| `gate:logs` | `npm run gate:logs` | Guarantees all log output passes through redaction filters. |
| `gate:design` | `npm run gate:design` | Prohibits hardcoded hex colors, arbitrary spacing, or raw fonts. |
| `gate:i18n` | `npm run gate:i18n` | Enforces 100% key parity between Persian (`fa.json`) and English (`en.json`). |
| `gate:web` | `npm run gate:web` | Audits the exported `dist/` directory for credential leakage. |

### Automated Test Suites

```bash
# Run the pure unit & integration test runner (400+ tests)
npm test

# Run tests filtering by pattern
npm test -- jalali
npm test -- engine

# Run the dedicated engine fairness & lens verification suite
npm run test:engine

# Run the live database RLS & cascade test suite (requires local Postgres)
npm run test:db
```

### Building Release Artifacts

#### Building the Android APK Locally

```bash
# Prebuild Android native structure
npx expo prebuild --platform android

# Compile debug APK
npm run android
```

#### Building the Static Web Distribution

```bash
# Clear previous build and compile web bundle
npm run export:web

# Audit generated artifacts
npm run gate:web
```

The compiled assets are placed in `dist/`, ready for hosting on any static web server or CDN.

## Reviewer Quick-Start — One URL, Two Minutes

**`/start`** is the reviewer entry point. It is an **app route** (`app/start.tsx`), not a hand-written page: it renders from the same web export as the product it describes, so the instructions and the screens cannot drift apart.

No install, no account, no store. Open the URL and you are looking at a group deciding between venues.

1. **Look at the ranked venues.** The top one tells you *who travels farthest and why*.
2. **Switch the lens** (متعادل / سریعترین / عادلانهترین / کمخرجترین) — the ranking changes.
3. **Tap a venue** — every person's trip, plus how certain we are about each number. Notice «تخمینی» (estimated).
4. **Tap «ثبت تصمیم نهایی»** — the final Decision Card.
5. **Open the same event in a second browser** — identical content.

Scanning the QR on `/start` (or installing the APK from `/dl/`) opens the same event **as a participant**, which is the path that needs a name and a vote.

**Why the demo loads without signing in.** The seeded event carries `is_demo = true`, and `demo_event_summary()` (migration `016_demo_read.sql`) is the only function an anonymous caller may execute. Every anonymous sign-in spends one request from a 30/hour/IP budget, so a reviewer who reloads four times would spend four of them, and a room of reviewers behind one NAT address would exhaust the budget in minutes. Sign-in is required only to vote or confirm — never to read the ranking.

### What is real, what is estimated, what is missing

| | |
|---|---|
| **Real** | Per-person travel times for driving, walking and cycling · the fairness ranking · live vote sync · approximate-location privacy |
| **Estimated** | Public transit. No Iranian provider offers transit routing, so those numbers are distance-based and labelled as estimates in the app |
| **Missing** | Venue wheelchair data (no such dataset exists for Iran — we show «نامشخص» rather than guessing) · block/report · iOS |
| **In the browser** | The 3D map is Android-only. In the browser you get the ranked list, which is the part that carries the decision |

The last row is a design decision, not a defect: the map degrades on web by design, the ranking does not. See [Known Gaps](#known-gaps).

## Runbook — Building and Deploying

Everything below runs on the operator's machine. There is **no CI pipeline and no EAS cloud build**, deliberately (PRD-13 §3, AC-10.1.1): one host, one operator, one deploy per day at most. The scripts exist so a manual step is *repeatable* rather than *remembered*.

### The seven release gates

```bash
npm run gate:all
```

Seven, not six, because there are **two shipping artifacts**. The native bundle and the web bundle are built by different pipelines, and one can carry a key the other does not. Both go to strangers; both get scanned.

| # | Gate | What its failure means |
|---|---|---|
| 1 | `gate:secrets` | A server credential is written down, or reached the bundle. **A leaked service-role key bypasses every RLS policy.** |
| 2 | `gate:location` | Background location is declared, in `app.json` or the manifest |
| 3 | `gate:engine-purity` | `src/engine/` imports React Native, Expo or Supabase — the fairness results stop being testable without a device |
| 4 | `gate:logs` | Something logs a coordinate, a token, or pasted text |
| 5 | `gate:design` | A hardcoded colour, radius, spacing, duration or font name |
| 6 | `gate:i18n` | `fa.json` and `en.json` disagree — English is a shipping mode, not a fallback |
| 7 | `gate:web` | The **exported** bundle carries a secret, an `sk.` token, a `.map`, or a third-party script origin |

`gate:all` runs them in that order and stops at the first failure, because the first failure is almost always the cause. `gate:web` needs `dist/` to exist, so it prints a loud **SKIPPED — NOT CHECKED** line when the export has not been built, and exits non-zero. That skip is a developer convenience; the deploy path never sees it.

### Build the web artifact

```bash
EXPO_PUBLIC_DEMO_TOKEN=freewhen-test-invite-token \
EXPO_PUBLIC_APP_BASE_URL=https://your-host \
npm run build:web
```

`scripts/build/export-web.sh` runs `source gates → export → gate:web → verify`, in that order. Three things are load-bearing:

- **`--clear` is not optional.** A stale `dist/` keeps the previous build's hashed chunks while the new `index.html` references different ones — the page works locally and 404s on the host.
- **`EXPO_PUBLIC_*` is inlined at export time, not read at runtime.** The demo token must be in the *build shell*, not only on the host. This is exactly why `gate:web` scans the output rather than the source.
- **`web/` is not merged into `dist/`.** The app's client-side routing would shadow `/dl/` and `/privacy`; they are separate static roots so the two cannot collide.

### Build the APK

```bash
export FREE_WHEN_RELEASE_STORE_FILE=/secure/freewhen-release.keystore
export FREE_WHEN_RELEASE_STORE_PASSWORD=…
npm run build:apk
```

`scripts/build/build-apk.sh` runs `npx expo prebuild --platform android` then `./gradlew assembleRelease`, and copies the result to `web/dl/freewhen.apk`. **No Expo account, no EAS, no build queue** — that removes the quota, the wait and the sanctions question in one step.

#### The keystore

**Store it, and record where.** Generate it once, outside the repository:

```bash
keytool -genkeypair -v -keystore freewhen-release.keystore \
  -alias freewhen -keyalg RSA -keysize 2048 -validity 10000
```

Android refuses an update signed by a different key. Lose the file and every future build is a *new app* that cannot be installed over the one already on a participant's phone — with no error message that explains why. The build script **fails** when `FREE_WHEN_RELEASE_STORE_FILE` is unset rather than producing an unsigned artifact that looks like a success.

> **Keystore location for this deployment:** `______________________` (fill in when the host is provisioned; it must not be inside the repository and must not be the only copy).

### Deploy

```bash
DEPLOY_HOST=deploy@your-host \
DEPLOY_BASE_URL=https://your-host \
EXPO_PUBLIC_DEMO_TOKEN=freewhen-test-invite-token \
npm run deploy
```

`scripts/deploy/deploy.sh` runs gates → export → `gate:web` → rsync → migrate → Caddy reload → smoke test. **The order is the safety property**: moving the `rsync` above `gate:web` publishes an artifact that was never scanned, and that is the one edit this script must never receive. `tests/deploy/gates.test.ts` asserts the line ordering.

The smoke test checks every served path *and* every refused one. A refused path returning `200` is the direction that matters most — it means `/studio`, a pruned service, or a source map is publicly reachable:

```
/health  /start  /privacy  /dl/  /dl/freewhen.apk  /api/health   → 200
/studio  /storage/v1/*  /functions/v1/*  *.map                    → 404
```

### Rollback

| Scenario | Action | Time |
|---|---|---|
| App bug shipped | Rebuild the APK, replace `/dl/freewhen.apk` | minutes |
| **Web bug** | Re-export (`--clear`), rsync `dist/` | **minutes, no review** |
| Backend bug | Redeploy the previous image; migrations are additive | minutes |
| Migration damaged data | Restore the nightly `pg_dump` | ~an hour |
| Host unreachable | The fallback host; installed APKs keep working | — |

The local-build path **is** the rollback strategy. Removing the store from the loop means a fix reaches a reviewer the same day, and a JavaScript-only fix needs no APK rebuild at all.

> **Nightly backup:** `pg_dump` to a second location. The demo data is small; a lost database mid-testing is recoverable in minutes.

### Analytics

Self-hosted into the `analytics_event` table (migration `017_analytics.sql`). **No US analytics SaaS** — reachability from Iran is unverified, and a monitoring endpoint that blocks a request is worse than no monitoring at all.

```bash
npm run db:query -- "select name, count(*) from analytics_event group by name"
```

The funnel (`server/lib/analytics.ts`) records the seven steps from PRD-12 §8.1: `invite_link_opened` → `guest_joined` → `start_point_set` → `proposal_created` → `vote_cast` → `decision_confirmed` → `rsvp_changed`. Step 2 → 5 is the acquisition funnel.

Redaction is two layers, on purpose: `track()` runs every payload through `redactObject()`, and a database trigger rejects an INSERT whose props carry a coordinate-shaped **key**. One layer holds only as long as every future writer remembers it.

## Contributing

We welcome contributions to FreeWhen! To maintain high code quality and architectural integrity, please adhere to these guidelines:

### Development Workflow

1. **Fork & Branch**: Create a feature branch with a descriptive name (`feat/decision-cards` or `fix/jalali-leap-year`).
2. **Follow TDD**:
   - Write a failing test first (Red).
   - Write the minimum clean implementation to pass the test (Green).
   - Refactor while keeping all tests passing.
3. **Preserve Modularity**:
   - Keep files focused and under 300 lines.
   - Enforce unidirectional dependencies (`components` → `features/hooks` → `engine/lib` → `types`).
   - Pure engine logic in `src/engine/` must remain deterministic and never import React Native.
4. **Design Token Compliance**:
   - Never use raw CSS values or hex colors. Always reference theme tokens (`palette`, `theme.surface1`, etc.).
5. **Run Verification Before Committing**:
   ```bash
   npm run typecheck
   npm run lint
   npm test
   npm run gate:all
   ```
6. **Submit PR**: Open a pull request against `main` detailing the changes, affected components, and testing evidence.

## Known Gaps

These are consciously deferred limitations, documented rather than hidden. Each has a trigger that makes it mandatory. Stating a known gap honestly is worth more than an implied claim of completeness — a reviewer who finds an undocumented gap discounts everything else.

| # | Gap | Risk | Why deferred | Trigger to address |
|---|---|---|---|---|
| **G-1** | **No identity verification for guests.** The invite link *is* the credential. | Catastrophic if a link goes public | Acceptable for invite-only friend groups; expiry, revocation and rate limiting are the mitigations | Any public or semi-public launch |
| **G-2** | **No block/report between participants.** Apple §1.2 requires blocking for UGC apps. | **Compliance risk** | No chat or free-text sharing between participants exists at MVP scope. Comments are proposal-scoped plain text with organizer deletion. | **Becomes mandatory the moment chat or user profiles are added** |
| **G-3** | **No screenshot protection.** | Unpreventable | Structurally impossible to prevent | Documented in the in-app privacy notice |
| **G-4** | **No age verification.** | Low | A documented decision (PRD-08 §9.1); the listing states 18+ | If the user base skews young |
| **G-5** | **Organizer identity is device-scoped.** Losing the device loses organizer control. | Event can strand | Ownership continuity (PRD-01 FR-1.31) prevents the worst case | P2 account system |
| **G-6** | **No CAPTCHA on anonymous sign-in** if shipped before FR-8.39. | DB-size abuse | Time | If abuse is observed |
| **G-7** | **The browser has no 3D map.** The ranked list is complete; the map is Android-only. | Low — the list carries the decision | No web build of the native map renderer; a web map is a separate renderer with separate costs (OQ-18.3, deferred to P2) | When a reviewer's confusion is traced to the missing map rather than to the ranking |

**G-2 is the most important entry.** It is a conscious compliance risk that must be revisited before any messaging feature ships.

**G-7 is a design decision, not an oversight.** PRD-18 D18-1 shipped the app as the web artifact precisely so the ranked list, the lens switch and the confirm action work without an install. The 3D map is the one screen that could not come with it, and every fact the map would show — each venue, its reason, its travel estimate, the participant legend — is on `/event/<id>` in the browser. Leaving it unwritten would turn an accepted trade into an apparent defect, which is why it is stated here and on `/start`.

The in-app privacy notice (`assets/privacy/{fa,en}.md`, bundled for offline reading) states these limitations to the user in both languages, so the disclosure does not depend on someone reading this repository.

## Disclaimer & Legal Notice

> **IMPORTANT**: Please read this notice carefully before deploying or utilizing FreeWhen.

1. **Educational & Community Intent**: FreeWhen is an open-source platform designed to streamline group coordination and evaluate algorithmic fairness.
2. **Location Privacy**: FreeWhen rounds all submitted coordinates to 2 decimal places (~1.1 km precision) and stores coarse coordinates only for the duration of active event coordination. It does not track background locations or retain historical location trails.
3. **Third-Party Services**: FreeWhen interfaces with upstream routing providers (Neshan Maps, OpenRouteService, and Mapbox). Users must comply with each provider's acceptable use policies and API terms. FreeWhen is not responsible for provider quota limits, API downtime, or routing inaccuracies.
4. **No Warranty**: This software is provided "AS IS", without warranty of any kind, express or implied. The developers assume no liability for missed appointments, travel delays, transit fare changes, or scheduling conflicts.
5. **Trademark Attribution**: All brand names, logos, and trademarks (such as "Neshan", "Mapbox", "Expo", "React Native", "PostgreSQL", and "Supabase") are properties of their respective owners. FreeWhen is an independent project and is neither affiliated with nor endorsed by them.

## References & Acknowledgements

- [Neshan Maps API](https://neshan.org/) — Routing, directions, and distance matrix services for Iranian geography.
- [OpenRouteService](https://openrouteservice.org/) — Open-source routing and reachability engine.
- [Expo](https://expo.dev/) & [React Native](https://reactnative.dev/) — Universal cross-platform mobile and web application framework.
- [Supabase](https://supabase.com/) & [PostgREST](https://postgrest.org/) — Scalable database and REST API infrastructure.
- [Jalaali JS](https://github.com/jalaali/jalaali-js) — High-precision Solar Hijri (Jalali) calendar conversion algorithms.
- [Phosphor Icons](https://phosphoricons.com/) — Flexible and clean iconography set.

## License

This project is licensed under the **MIT License**. See the [LICENSE](./LICENSE) file for complete details.