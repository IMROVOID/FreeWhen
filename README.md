<div align="center">

<img src="./public/banner.webp" alt="FreeWhen" width="100%" />

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
[![Tests](https://img.shields.io/badge/tests-1272%20(node%3Atest)-success.svg)](./package.json)
[![Release gates](https://img.shields.io/badge/gates-7%20enforced-orange.svg)](./scripts/gate)

<p align="center">
  FreeWhen turns a group's scattered time and place suggestions into <b>one clear, visible, confirmed decision</b> — and shows, with evidence, why that choice is <b>fair for everyone</b>.
</p>

[English](README.md) • [فارسی](README.fa.md)

[Overview](#what-is-freewhen) • [Features](#key-features) • [Guides](#guides) • [Scoring Lenses](#decision-engine--scoring-lenses) • [Clients](#client-integration) • [Tech Stack](#tech-stack) • [Architecture](#architecture--structure) • [Development](#development--testing) • [Reviewer Path](#reviewer-quick-start--one-url-two-minutes) • [Runbook](#runbook--building-and-deploying) • [Contributing](#contributing) • [Disclaimer](#disclaimer--legal-notice) • [References](#references--acknowledgements) • [License](#license)

</div>

## Table of Contents

- [What is FreeWhen?](#what-is-freewhen)
- [Key Features](#key-features)
- [Guides](#guides)
  - [Guide 1 — Local Development](#guide-1--local-development)
  - [Guide 2 — Deployment](#guide-2--deployment)
- [Decision Engine & Scoring Lenses](#decision-engine--scoring-lenses)
- [Event Lifecycle](#event-lifecycle)
- [Client Integration](#client-integration)
- [Tech Stack](#tech-stack)
  - [Languages](#languages)
  - [Client](#client)
  - [Server](#server)
  - [Data & Infrastructure](#data--infrastructure)
  - [Internationalisation & Localisation](#internationalisation--localisation)
  - [Typography](#typography)
  - [Icons & Visuals](#icons--visuals)
  - [Maps & Routing Providers](#maps--routing-providers)
  - [Engineering & Quality](#engineering--quality)
  - [Transports & Runtimes](#transports--runtimes)
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
- [What is deliberately missing](#what-is-deliberately-missing)
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
6. **Coordinated, then followed through**: proposals, per-proposal comments, an in-room chat, a dealbreaker veto, RSVP, a `.ics` export and a shareable plan — the decision is the middle of the product, not the end of it.

> **Note**: FreeWhen supports both a self-hosted **Supabase** backend and a completely standalone **local PostgreSQL + PostgREST** stack (`docker-compose.local.yml`). Switching requires changing a single environment variable (`DATABASE_BACKEND`), with zero client code alterations.

## Key Features

- **Four Aggregation Lenses**: Explicit, named decision models (**Balanced**, **Fastest**, **Fairest**, **Cheapest**) rooted in social choice theory and Arrow's theorem.
- **Provider Degradation Ladder**: Resilient travel matrix pipeline falling back gracefully: `Neshan Matrix` → `Neshan Direction` → `OpenRouteService` → `Straight-line (Haversine)`.
- **Tri-State Accessibility**: Tracks accessibility attributes (`confirmed_yes`, `confirmed_no`, `unknown`). Absent data is treated as unknown, never assumed accessible.
- **Bilingual & RTL-First**: Seamless Persian (fa) and English (en) support with Persian numeral conversion, localized reasoning templates, and automatic text directionality.
- **Dual Backend Architecture**: Full parity between cloud-ready Supabase and an independent local stack (PostgreSQL 15 + PostgREST 12 + Node.js Auth & WebSocket Bridge).
- **Enforced Security Gates**: Seven pre-commit and pre-deploy automated validation gates (`npm run gate:all`) that block secret leaks, PII logging, unscaled design tokens, and unreviewed permissions.
- **Zero-Install Review Path**: Static web bundle export (`npm run export:web`) served instantly to any mobile or desktop browser without requiring an app store download.

Around the ranking itself, the product is a full event lifecycle — every item below is shipped and covered by the test suite:

- **Proposals that respond to a vote**: anyone can add a place or a slot, edit it, or withdraw it. The list is ranked by vote share with a bar showing each proposal's standing, an answered proposal collapses to its vote plus an edit affordance, and an upcoming vote deadline is marked rather than silently closed.
- **Dealbreaker veto and per-proposal comments**: a participant can veto a proposal outright, and each proposal carries its own plain-text comment thread — organizer-deletable, and honest about the fact that a vetoed item is muted rather than hidden.
- **Advisory opening-hours verdict**: a proposal whose venue is closed at the proposed time is flagged. Advisory, never blocking — the group decides, the app does not.
- **In-room chat (D23)**: a real per-event message thread with edit and delete on your own messages, report on someone else's, a 500-character bound, and a matte treatment of system dialogs — no native `Alert` stacked over a screen that already asked the question.
- **Deterministic summary of the decision**: built from structured facts in the active locale, with the AC-7.6.1 rewrite guard in place. No model is configured and the app never pretends one is (see [Transit is an estimate](#what-is-deliberately-missing)).
- **Follow-through, not just the decision**: `.ics` calendar export, share-the-plan, RSVP with «نمیرسم» (can't make it) and «دیر میرسم» (running late), and a mute list that silences an event without leaving it.
- **Global nickname in its own colour**: one prompt on first launch seeds the per-event name, and every nickname is shown in a stable colour on proposals, comments and messages. An answered profile lookup cannot 500 a join.
- **Map-first proposal flow**: place search proxied through the server, a location picker, and the place actions on the map's own corner with a link to open the venue in a map app.
- **Pull to resync**: pull the page down to re-fetch, with the corners rounding as it lifts — the web and native answer to "is this still right?" without a spinner taking over the screen.
- **Search across joined and owned events**: an overlay that filters your events by name, so an old decision is reachable without scrolling.
- **Material You accents and an adaptive theme**: Android 12+ dynamic accent and neutral colours via `PlatformColor`, with FreeWhen's own palette as the fallback — plus a dark/light appearance store and a reduced-motion path.
- **Offline and failure states that tell the truth**: an offline banner, a per-screen state gate, skeletons, and an error state per surface. Polling backs off instead of retrying at full speed.
- **Self-hosted event analytics**: seven funnel steps written to `analytics_event`, redacted in two layers.

## Guides

Two guides, each self-contained: **Local Development** to run everything on your
machine, **Deployment** to ship it. Everything else in this README explains *how
FreeWhen works*; these two explain *how to run it*.

### Guide 1 — Local Development

Run the whole system locally: database, API, and app. No cloud account, no Expo
account, no build service.

#### Prerequisites

| Requirement | Version | Needed for |
|---|---|---|
| **Node.js** | ≥ 22.13 | Everything |
| **Docker** | any recent | PostgreSQL + PostgREST via Compose |
| **Java JDK** | 17 | Android builds |
| **Android Studio** | any recent | Android emulator |
| **Xcode** | any recent | iOS builds — macOS only |

#### Step 1 — Install and configure

```bash
git clone https://github.com/IMROVOID/FreeWhen.git
cd FreeWhen
npm install
cp .env.example .env
```

Fill in the client-facing variables in `.env`:

```ini
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-anon-key
EXPO_PUBLIC_APP_BASE_URL=http://127.0.0.1:8081
```

Server-only variables (never bundled) are documented in [Environment Variables](#environment-variables).

#### Step 2 — Start the database

This brings up PostgreSQL 15 and PostgREST 12 in containers, then applies the
schema and seeds the demo event that `/start` resolves to.

```bash
npm run db:local:up           # PostgreSQL + PostgREST via docker-compose
npm run db:migrate            # additive and idempotent
npm run db:seed               # the demo event /start reads
```

To use a self-hosted Supabase stack instead of the local stack, set
`DATABASE_BACKEND=supabase`. The API and the client are unchanged either way — see
[Dual Backend & Realtime Synchronization](#dual-backend--realtime-synchronization).

#### Step 3 — Start the API

```bash
npm run server                # the API on 127.0.0.1:8787
```

Two optional long-lived services, each in its own terminal, for the local backend:

```bash
npm run server:auth           # token signing & anonymous auth (port 8789)
npm run server:realtime       # WebSocket realtime event bridge (port 8788)
```

The realtime bridge is optional: without it the decision screen falls back to a
10-second poll, which is what every serverless deployment gets anyway.

#### Step 4 — Start the app

```bash
npm start                     # Expo Metro bundler
npm run android               # or: launch on an emulator / device
```

For iOS (macOS only):

```bash
npx expo prebuild --platform ios
npm run ios
```

> **An Expo account is not required.** FreeWhen builds locally via
> `npx expo run:android` and does not depend on cloud build services.

#### Step 5 — Run the web app locally

The same app exports to a static bundle:

```bash
npm run export:web            # compiles a static SPA into dist/
npm run gate:web              # audits dist/ for leaked credentials
npx serve dist -l 8081        # http://localhost:8081
```

The bundle ships with native RTL layout, Persian metadata and viewport fitting
already configured.

#### Verify the tree before trusting it

```bash
npm run typecheck && npm run lint
npm test                      # unit + component suites
npm run test:engine           # the engine fairness assertions by name
npm run test:db               # against a live PostgreSQL
npm run gate:all              # the seven release gates
npm run qa:all                # or: the whole checklist in one command
```

> **One trap worth knowing.** `npm install` on Windows can leave `app.json` and the
> manifest out of sync with the native project, and the installed app then tries to
> load its JavaScript from Metro. If a device shows *"Unable to load script"*, run
> `adb reverse tcp:8081 tcp:8081` and start Metro — the app is a development build,
> not a release one.

### Guide 2 — Deployment

One host, one operator, every step a script — so the procedure is *repeatable*
rather than *remembered*. Two of those script sequences are also wired to GitHub
Actions ([`.github/workflows/`](.github/workflows/README.md)), which you can use
or ignore: the manual path below still works end to end and remains the fallback
if the runner is unavailable. See the
[Runbook](#runbook--building-and-deploying) for why each step is ordered the way
it is.

#### Step 1 — Backend

Run the Supabase stack (default) or the plain PostgreSQL + PostgREST peer, selected
by `DATABASE_BACKEND`. Apply migrations with `npm run db:migrate` — they are
additive and idempotent.

The API can run as a long-lived Node process (`npm run server`) or on a
request/response runtime. `server/runtime/README.md` lists every supported calling
convention and which entry file to deploy; the database transport is chosen by
`DATABASE_BACKEND` (`pg` over a socket, or `supabase_rest` over HTTPS with no
socket at all).

#### Step 2 — Build the web artifact

```bash
EXPO_PUBLIC_DEMO_TOKEN=freewhen-test-invite-token EXPO_PUBLIC_APP_BASE_URL=https://your-host npm run build:web
```

`scripts/build/export-web.sh` runs *source gates → export → `gate:web` → verify*,
in that order. Three things are load-bearing:

- **`--clear` is not optional.** A stale `dist/` keeps the previous build's hashed
  chunks while the new `index.html` references different ones — the page works
  locally and 404s on the host.
- **`EXPO_PUBLIC_*` is inlined at export time, not read at runtime.** The demo token
  must be in the *build shell*, not only on the host. This is exactly why `gate:web`
  scans the output rather than the source.
- **`web/` is not merged into `dist/`.** The app's client-side routing would shadow
  `/dl/` and `/privacy`; they are separate static roots so the two cannot collide.

#### Step 3 — Build the Android APK

```bash
export FREE_WHEN_RELEASE_STORE_FILE=/secure/freewhen-release.keystore
export FREE_WHEN_RELEASE_STORE_PASSWORD=…
npm run build:apk                       # every ABI, one artifact
APK_ARCHS=arm64-v8a npm run build:apk   # one ABI only
```

`scripts/build/build-apk.sh` runs `npx expo prebuild --platform android` then
`./gradlew assembleRelease`, and copies the result to `web/dl/freewhen.apk`.

**One ABI, or all of them.** `android/gradle.properties` declares four
architectures, and Gradle emits an `app-<abi>-release.apk` for each *plus* an
un-suffixed `app-release.apk` containing all of them. `APK_ARCHS` selects the
per-ABI output; leaving it unset produces the universal one. The script reads
only the artifact its own mode should have produced, and lists the output
directory when the expected file is missing — because "the build succeeded with
a name nobody predicted" is how the wrong artifact ships.

##### Building every ABI and publishing a release

[`release-apk.yml`](.github/workflows/release-apk.yml) does this in one dispatch:

```
FreeWhen-v0.1.0-armeabi-v7a.apk
FreeWhen-v0.1.0-arm64-v8a.apk
FreeWhen-v0.1.0-x86.apk
FreeWhen-v0.1.0-x86_64.apk
FreeWhen-v0.1.0-universal.apk
SHA256SUMS.txt
```

Three properties are load-bearing and none of them existed before:

- **A draft prerelease is the default.** `release_mode=publish` is a separate,
  deliberate choice. A draft is also flagged `--prerelease`, so a `v0.x.0` tag
  never presents itself to `--latest` consumers as a stable release.
  Overwriting an existing published tag needs
  `FREEWHEN_OVERWRITE_RELEASE=true` as well, so re-publishing cannot happen by
  accident.
- **Every APK is verified before it is uploaded.** `verify-apk` checks the file
  is an archive, that a per-ABI build carries *exactly* its own `lib/` payload
  (a universal build must carry more than one), that the signer is the release
  certificate and **not** the debug key, that the package id and `versionName`
  match, and that no `SUPABASE_SECRET_KEY`/`service_role`/`sk.` string reached the
  bundled JavaScript. Then it writes the checksum.
- **A production build refuses to start blind.** It requires
  `FREEWHEN_SERVER_URL`, calls `<origin>/health`, and aborts unless the body
  says `"db":"up"`. The API origin is inlined at build time, so an APK built
  against a dead host is an app that opens to a spinner and cannot be fixed
  without shipping another APK.

Variable and secret names are in
[`.github/workflows/README.md`](.github/workflows/README.md).

##### The keystore

**Store it, and record where.** Generate it once, outside the repository:

```bash
keytool -genkeypair -v -keystore freewhen-release.keystore   -alias freewhen -keyalg RSA -keysize 2048 -validity 10000
```

Android refuses an update signed by a different key, with no error message that
explains why. Lose the file and every future build is a *new app* that cannot be
installed over the one already on a participant's phone. The build script **fails**
when `FREE_WHEN_RELEASE_STORE_FILE` is unset rather than producing an unsigned
artifact that looks like a success.

> **Keystore location for this deployment:** `______________________` (fill in when the host is provisioned; it must not be inside the repository and must not be the only copy).

#### Step 4 — Publish

Caddy serves `dist/` as the app and `web/` as a separate static root, so the
client-side router cannot shadow `/dl/` or `/privacy`.

```bash
DEPLOY_HOST=deploy@your-host DEPLOY_BASE_URL=https://your-host EXPO_PUBLIC_DEMO_TOKEN=freewhen-test-invite-token npm run deploy
```

`scripts/deploy/deploy.sh` runs *gates → export → `gate:web` → rsync → migrate →
Caddy reload → smoke test*. **The order is the safety property**: moving the
`rsync` above `gate:web` publishes an artifact that was never scanned, and that is
the one edit this script must never receive. A test asserts the line ordering.

The smoke test checks every served path *and* every refused one. A refused path
returning `200` is the direction that matters most — it means `/studio`, a pruned
service, or a source map is publicly reachable:

```
/health  /start  /privacy  /dl/  /dl/freewhen.apk  /api/health   → 200
/studio  /storage/v1/*  /functions/v1/*  *.map                    → 404
```

#### Step 5 — Verify `/start`

Open the deployed URL: the ranked list, the lens switch, a venue's per-person
breakdown, the confirm action, and an identical card in a second browser. All of it
must load with **no account and no install**.

#### Rollback

| Scenario | Action | Time |
|---|---|---|
| App bug shipped | Rebuild the APK, replace `/dl/freewhen.apk` | minutes |
| **Web bug** | Re-export (`--clear`), rsync `dist/` | **minutes, no review** |
| Backend bug | Redeploy the previous image; migrations are additive | minutes |
| Migration damaged data | Restore the nightly `pg_dump` | ~an hour |
| Host unreachable | The fallback host; installed APKs keep working | — |

The local-build path **is** the rollback strategy: a JavaScript-only fix reaches a
reviewer the same day, with no APK rebuild.

> **Nightly backup:** `pg_dump` to a second location. The demo data is small; a lost
> database mid-testing is recoverable in minutes.

#### Analytics

Self-hosted into the `analytics_event` table. **No third-party analytics SaaS** —
reachability from Iran is unverified, and a monitoring endpoint that blocks a
request is worse than no monitoring at all.

```bash
npm run db:query -- "select name, count(*) from analytics_event group by name"
```

The funnel (`server/lib/analytics.ts`) records seven steps:
`invite_link_opened` → `guest_joined` → `start_point_set` → `proposal_created` →
`vote_cast` → `decision_confirmed` → `rsvp_changed`. Steps 2 → 5 are the
acquisition funnel.

Redaction is two layers, on purpose: `track()` runs every payload through
`redactObject()`, and a database trigger rejects an INSERT whose props carry a
coordinate-shaped **key**. One layer holds only as long as every future writer
remembers it.

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

## Event Lifecycle

The engine is one node in a longer graph. A FreeWhen event moves through these screens, and each one is a route — the whole thing works without an account:

| Stage | Route | What happens | Server surface |
|---|---|---|---|
| **Join** | `app/e/[token].tsx` → `app/e/[token]/location.tsx` | The invite link is the credential. The guest sets a coarse start point and a nickname. | `POST /api/invite/:token` · `POST /api/events/:id/participants` |
| **Event home** | `app/event/[id]/index.tsx` | Quick actions, the ranked proposal list with vote share, the chat entry, and the decision state. | `GET /api/events/:id/proposals` · `/decision-status` |
| **Time** | `app/event/[id]/time.tsx` | Slot proposals and the availability grid. | `POST/PATCH /api/proposals` |
| **Propose** | `app/event/[id]/propose.tsx` | Server-proxied place search, the location picker, an advisory opening-hours verdict. | `GET /api/place-search` |
| **Vote** | `app/event/[id]/index.tsx` | Yes / maybe / no, a dealbreaker veto, and a per-proposal comment thread. | `POST /api/events/:id/votes` · `/comments` |
| **Rank** | `app/event/[id]/map.tsx`, `venue/[vid].tsx` | The four lenses over the travel matrix; a per-person breakdown and a confidence level per number. | `POST /api/events/:id/rank` |
| **Decide** | `app/event/[id]/decision.tsx` | The Decision Card, confirm, and reopen if the group changes its mind. | `POST /api/events/:id/confirm` · `/reopen` |
| **Follow through** | `app/event/[id]/people.tsx`, `activity.tsx` | RSVP, running-late, `.ics` export, share the plan, the activity trail. | `POST /api/events/:id/rsvp` · `/status-update` |
| **Chat** | `app/event/[id]/chat.tsx` | The per-event thread: edit, delete, report. | `GET/POST/PATCH/DELETE /api/events/:id/messages` |
| **Settings** | `app/settings/index.tsx` | Language, nickname, notifications, mute list, the offline privacy notice, account deletion. | `GET/PATCH /api/profile` · `DELETE /api/account` |

Two clocks run in the background rather than in a request: `npm run job:retention` applies the documented retention windows, and `npm run job:anon-cleanup` removes anonymous identities that never joined anything. **Auto-lock at the voting deadline** exists but ships **off by default** (`T10`) — an event closing itself is a surprising thing for a product that is otherwise entirely advisory.

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

## Tech Stack

Everything FreeWhen is built from, with the version this repository pins.

### Languages

| Language | Where | Notes |
|---|---|---|
| **TypeScript** 6.0 | App, API, engine, tests | Strict mode; `noUnusedLocals` and `noUnusedParameters` on |
| **SQL** (PostgreSQL dialect) | `migrations/`, `server/sql/` | Constraints, RLS policies, triggers, `plpgsql` functions |
| **PL/pgSQL** | `server/sql/*.sql` | The atomic operations — join, vote, confirm, reopen |
| **Bash** | `scripts/build/`, `scripts/deploy/` | Build and deploy pipelines |
| **CSS** | Web export theme | React Native Web styles, no separate stylesheet |
| **Python** | `scripts/docs/` | Documentation consistency checks only |
| **HTML** | `web/`, exported `dist/` | Static privacy pages and the app shell |

### Client

| Component | Version | Role |
|---|---|---|
| **React** | 19.3 | UI runtime |
| **React Native** | 0.88 | Native Android / iOS renderer |
| **React Native Web** | 0.21 | The same components in a browser |
| **Expo** | 58 | Build tooling, native modules, local builds |
| **Expo Router** | 58 | File-based routing across all three platforms |
| **Reanimated** | 4.7 | Gesture-driven animation on the UI thread |
| **Gesture Handler** | 3.3 | Pan, tap and drag interactions |
| **Shopify Skia** | 2.5 | Canvas rendering for the map and charts |
| **Shopify FlashList** | 2.3 | Virtualised lists for the ranked venue views |
| **Gorhom Bottom Sheet** | 5.2 | Native bottom sheets |
| **TanStack Query** | 5.9 | Server-state caching and invalidation |
| **Zustand** | 5.0 | Local client state |
| **React Hook Form** | 7.9 | Form state and validation |
| **Zod** | 4.6 | Runtime schema validation, shared with the API |
| **AsyncStorage** | 2.2 | Persisted local settings |
| **expo-clipboard** | 58.0 | Copy an invite link or a share code without reflowing the page |
| **expo-notifications** | 58 | Push permission requested after the first vote, not at launch; imported lazily so the web build still boots |
| **expo-image** | 58.0 | Venue and background imagery |
| **expo-linking** | 58.0 | The `freewhen://` scheme and universal links |
| **expo-localization** | 58.0 | Device locale as the default language |
| **Material You (`PlatformColor`)** | Android 12+ | Dynamic accent and neutral colours, with the FreeWhen palette as the fallback |

### Server

| Component | Version | Role |
|---|---|---|
| **Node.js** | ≥ 22.13 | The long-lived API process |
| **node:http** | built-in | The API listener — no framework |
| **pg** | 8.23 | PostgreSQL driver, pooled |
| **ws** | 8.22 | WebSocket server for the realtime bridge |
| **tsx** | 4.20 | Runs TypeScript directly in dev and scripts |

### Data & Infrastructure

| Component | Version | Role |
|---|---|---|
| **PostgreSQL** | 15 | Primary database — schema, RLS, triggers |
| **PostgREST** | 12.2 | REST surface over the same schema |
| **Docker Compose** | any recent | Local and deployable container stacks |
| **Caddy** | any recent | Reverse proxy and TLS |

### Internationalisation & Localisation

| Component | Version | Role |
|---|---|---|
| **i18next** | 26.5 | Translation runtime |
| **react-i18next** | 17.1 | React bindings |
| **jalaali-js** | 2.0 | Solar Hijri (Jalali) calendar conversion |
| **Intl** | built-in | Number, date and relative-time formatting |

### Typography

Two families, bundled locally rather than fetched at runtime:

| Family | Weights | Script |
|---|---|---|
| **Plus Jakarta Sans** | 400 / 500 / 600 / 700 / 800 | Latin |
| **Vazirmatn** | 400 / 500 / 600 / 700 / 800, plus Persian-digit variants | Persian |

One family name is registered per weight and selected through the `weight` prop,
because Android does not reliably map `fontWeight` to custom fonts.

Vazirmatn ships a second family per weight (`VazirmatnFD-*`) that renders **Persian digits natively**. That is what makes `۱۲۳` look like a number in Persian rather than a Latin figure inside Persian text, without reformatting every string by hand.

### Icons & Visuals

| Component | Version | Role |
|---|---|---|
| **Phosphor Icons** (`phosphor-react-native`) | 2.3 | The icon set, tree-shaken per icon |
| **Design tokens** | in-repo | Colours, radii, spacing, durations — enforced by a gate |
| **Brand mark** — "The Focus Nexus" | `assets/images/` | The app icon, favicon, splash and store assets, committed per platform size |

The icon assets in `assets/images/` are the shipped truth: the iOS
light/dark/tinted tiles, the Android adaptive foreground with a monochrome layer
for themed icons, the splash, and the web favicons mirrored into both `public/`
(copied into `dist/` on export) and `web/icons/` (the hand-written static pages).
Edit them as binary assets, not by regenerating in code.

### Maps & Routing Providers

| Provider | Role | Fallback order |
|---|---|---|
| **Neshan** (Matrix) | Travel-time matrix for Iranian geography | 1 |
| **Neshan** (Direction) | Point-to-point routing when the matrix fails | 2 |
| **OpenRouteService** | Open-source routing engine | 3 |
| **Haversine** | Straight-line distance, computed locally | 4 |
| **Mapbox** | Base tiles for the native map | — |
| **CARTO** | Raster basemap for the location picker, keyed by `EXPO_PUBLIC_CARTO_API_KEY` | — |

The QR code on `/start` and the share card is **encoded locally** (`src/features/settings/components/QrCode.tsx`: byte mode, error-correction L, versions 1–10). A hosted QR image service would send the live demo invite token to a third party on every page load, and `gate:web` rejects a third-party script origin outright.

### Engineering & Quality

| Component | Version | Role |
|---|---|---|
| **Node test runner** (`node:test`) | built-in | Every test suite — no Jest, no Vitest |
| **ESLint** | 9.36 | Linting |
| **TypeScript compiler** | 6.0 | Type checking in CI-less gates |
| **Maestro** | external CLI | The `tests/e2e/` device flow (`npm run test:e2e`) |
| **Seven release gates** | in-repo | Secrets, location, engine purity, logs, design tokens, i18n parity, web bundle |

### Transports & Runtimes

The API is a pure `Request => Response` function, so the same code serves every
target below. Two axes are configuration, not code:

| Axis | Options |
|---|---|
| **Database transport** | `pg` over a TCP socket, or PostgREST over HTTPS (no socket) |
| **Runtime edge** | Long-lived Node listener, or any request/response convention — see [`server/runtime/README.md`](server/runtime/README.md) |

## Architecture & Structure

```
FreeWhen/
├── app/                          # Expo Router file-based screens
│   ├── +html.tsx                 # Web document wrapper (dir="rtl", lang="fa", OG/Twitter tags)
│   ├── _layout.tsx               # Root layout, theme provider, fonts, i18n
│   ├── index.tsx                 # Home / Landing screen
│   ├── start.tsx                 # Reviewer quick-start, rendered from this same bundle
│   ├── e/                        # Invite handler, token redemption, start point
│   │   ├── [token].tsx           # Join via invite token
│   │   └── [token]/location.tsx  # Set the coarse start point
│   ├── event/[id]/               # One folder per event screen
│   │   ├── index.tsx             # Event home: quick actions, ranked proposals, vote share
│   │   ├── time.tsx              # Slot proposals and the availability grid
│   │   ├── propose.tsx           # Place proposals, proxied search, opening-hours verdict
│   │   ├── map.tsx               # Lens switch and the venue map
│   │   ├── venue/[vid].tsx       # Per-person travel breakdown with confidence levels
│   │   ├── decision.tsx          # Decision Card, confirm, reopen
│   │   ├── people.tsx            # Attendees, RSVP, running late
│   │   ├── activity.tsx          # The event's activity trail
│   │   └── chat.tsx              # In-room chat: edit, delete, report
│   ├── new/                      # Event creation wizard and the invite step
│   └── settings/index.tsx        # Language, nickname, notifications, privacy, deletion
├── src/
│   ├── app-bootstrap.ts          # Early bootstrap, fonts, i18n initialization
│   ├── components/               # Shared UI
│   │   ├── MeetPoint.tsx         # Meeting point visualizer
│   │   ├── a11y/                 # VisitorLabel — accessibility labelling
│   │   ├── states/               # Offline banner, skeletons, error/permission states, state gate
│   │   └── ui/                   # 20+ accessible design-system primitives
│   │       ├── AccentSwitch.tsx      # Switch with an accent track
│   │       ├── Avatar.tsx            # Participant avatar
│   │       ├── BottomSheet.tsx       # Gesture-driven sheet (+ `.web.tsx` counterpart)
│   │       ├── Button.tsx            # Accessible pressable button
│   │       ├── Card.tsx              # Elevated surface card
│   │       ├── Chip.tsx              # Tag and filter pill
│   │       ├── ConfirmSheet.tsx      # Destructive-action confirmation
│   │       ├── DateSelectionComponent.tsx # Jalali calendar + time wheel
│   │       ├── EmptyState.tsx        # Empty state graphic & message
│   │       ├── GlassSurface.tsx      # Liquid glass backdrop blur surface
│   │       ├── Input.tsx             # Text field with RTL/LTR auto-direction
│   │       ├── LocationMapPicker.tsx # Map-first location selection
│   │       ├── OverlayToast.tsx      # Toast that does not reflow the page
│   │       ├── Pressy.tsx            # Spring animated touch wrapper
│   │       ├── PullToSync.tsx        # Pull-to-refresh with rounding corners
│   │       ├── ScreenHeader.tsx      # Back affordance + centred title
│   │       ├── Stepper.tsx           # Multi-step progress indicator
│   │       ├── TabBar.tsx            # Navigation bar
│   │       ├── Text.tsx              # Typography with Persian font integration
│   │       ├── TimeWheelPicker.tsx   # Nested-scroll time wheel
│   │       └── Toast.tsx             # Floating alert banner
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
│   ├── features/                 # Domain modules, one folder per capability
│   │   ├── availability/         # The one-dataset availability grid
│   │   ├── events/               # Join, create, search, share, QR, invite tokens, management
│   │   ├── follow-through/       # RSVP, running late, .ics export, share the plan, mute list
│   │   ├── map/                  # Map surface helpers
│   │   ├── notifications/        # Push permission timing, handler, registration
│   │   ├── parser/               # Deterministic chat/date parser and decision summary
│   │   ├── participants/         # Participant list and identity
│   │   ├── privacy/              # Retention copy, notice viewer, account deletion
│   │   ├── profile/              # Global nickname, first-launch gate, per-name colour
│   │   ├── proposals/            # Proposal create/edit/withdraw, comments, veto, hours verdict
│   │   ├── settings/             # Language switch and the local QR encoder
│   │   ├── venues/               # Venue ranking views and detail
│   │   └── voting/               # Votes, live tally, confirmation
│   ├── hooks/                    # useOffline, useReducedMotion
│   ├── i18n/                     # Internationalization & localization
│   │   ├── en.json               # English catalogue (819 keys)
│   │   ├── fa.json               # Persian catalogue (819 keys, parity enforced)
│   │   ├── index.ts              # i18next configuration & language detector
│   │   ├── resolve.ts            # Locale resolution
│   │   └── store.ts / store.web.ts # Language persistence, per platform
│   ├── lib/                      # Core cross-cutting utilities
│   │   ├── api.ts                # Typed API client
│   │   ├── api-base-url.ts       # Resolves the API origin, with a same-origin fallback
│   │   ├── api-failure.ts        # Classifies a failed request for the UI
│   │   ├── errors.ts             # Standardized domain error classes
│   │   ├── format.ts             # Persian/English digits & currency formatters
│   │   ├── jalali.ts             # Jalali (Solar Hijri) calendar utilities
│   │   ├── pending-writes.ts     # Queues a write that failed offline
│   │   ├── platform-tag.ts       # Platform tag for analytics and UA handling
│   │   ├── redact.ts             # Zero-leak logging & PII masking
│   │   ├── seo.ts                # Document metadata resolved at export time
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
│   │   ├── font-assets.ts        # Font asset loader (Plus Jakarta Sans, Vazirmatn, VazirmatnFD)
│   │   ├── fonts.ts              # Font family contracts
│   │   ├── monet.ts              # Material You dynamic accent resolution, Android 12+
│   │   ├── motion.ts             # Spring & timing animation configs
│   │   ├── resolve-theme-name.ts # Resolves the active theme name
│   │   ├── tokens.ts             # Color palette, spacing, and radius tokens
│   │   ├── type-scale.ts         # Proportional typographic scale
│   │   ├── useMotion.ts          # Motion hook wrapper (+ `.web.ts`)
│   │   └── useTheme.ts           # Active theme hook
│   └── types/                    # Core shared TypeScript definitions
│       ├── domain.ts             # Event, proposal, vote, venue entities
│       └── event.ts              # Event lifecycle contracts
├── server/                       # Backend API & service layer
│   ├── auth/                     # Anonymous authentication & JWT issuing
│   ├── jobs/                     # Retention and anonymous-identity cleanup runners
│   ├── lib/                      # Analytics, DB backends, transport, redaction
│   ├── realtime/                 # WebSocket realtime change bridge
│   ├── routes/                   # 21 route handlers
│   │   ├── account.ts  activity.ts  comments.ts  confirm.ts  decision-status.ts
│   │   ├── events.ts   health.ts    invite.ts    messages.ts  notifications.ts
│   │   ├── nudge.ts    parse.ts     participants.ts  place-search.ts  profile.ts
│   │   ├── proposals.ts  rank-travel.ts  reopen.ts  rsvp.ts  status-update.ts  votes.ts
│   ├── runtime/                  # Per-convention serverless edges (see its README)
│   ├── sql/                      # Atomic PL/pgSQL operations
│   └── index.ts                  # Backend server entry point
├── migrations/                   # PostgreSQL schema migrations (000–021)
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
│   ├── build/                    # Web export and APK build scripts
│   ├── db/                       # Migration, seed, query and DB test runners
│   ├── deploy/                   # Deploy and deployment-verification scripts
│   ├── docs/                     # PRD/plan validators and index generators
│   ├── jobs/                     # Retention and cleanup entry points
│   ├── privacy/                  # Privacy notice and static page generators
│   ├── qa/                       # Static server and CDP screenshot/eval helpers
│   ├── seo/                      # robots.txt and sitemap.xml generator
│   ├── verify/                   # Deployment body and marker verification
│   ├── run-engine-tests.ts       # Engine-specific test runner
│   └── run-tests.ts              # Project test runner (1272 tests)
├── tests/                        # Automated suites, grouped by domain
│   ├── engine/ routing/ venues/ voting/ proposals/ availability/ follow-through/
│   ├── auth/ events/ profile/ notifications/ parser/ realtime/ server/ backend/
│   ├── db/ migrations & RLS · deploy/ script ordering · gate/ the gates themselves
│   ├── docs/ workflow and documentation contracts · platform/ web + native splits
│   ├── ui/ 29 component suites · privacy/ a11y/ theme/ lib/ fixtures/ submission/
│   └── e2e/                      # Maestro device flows (`npm run test:e2e`)
├── assets/                       # Fonts, images, privacy notices, vendored runtime assets
├── public/                       # Copied verbatim into dist/ by expo export
│   ├── banner.webp               # The Open Graph / Twitter Card image (1200×630)
│   └── favicon*, icon-*, apple-touch-icon, maskable-512, site.webmanifest
├── web/                          # A second static root, served beside dist/
│   ├── dl/                       # The APK download page
│   └── privacy/                  # Hand-written privacy pages (fa + en)
├── docs/                         # PRDs, plans, reports, research, evidence
├── .github/workflows/            # CI, Release APK, Deploy, Resolve config
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
| `EXPO_PUBLIC_CARTO_API_KEY` | No (location picker) | Publishable CARTO basemap tile key. Safe in the bundle by design — it appears in every tile URL. | `—` |
| `EXPO_PUBLIC_APP_BASE_URL` | Yes | Base URL used to formulate invite links, `canonical`, `og:url`, the sitemap — **and the API origin when `EXPO_PUBLIC_API_URL` is unset** | `—` |
| `EXPO_PUBLIC_API_URL` | No | The API origin when it differs from the app origin. Leave blank in the single-origin deployment. | falls back to `EXPO_PUBLIC_APP_BASE_URL` |
| `EXPO_PUBLIC_DEMO_TOKEN` | Yes (reviewer path) | The stable invite token `/start` routes to. Must resolve to the seeded `is_demo` event | `—` |

> **`EXPO_PUBLIC_*` is inlined at export time, not read at runtime.** A value that exists
> only on the host is compiled in as `undefined` — that is how a release APK once shipped
> pointing at `127.0.0.1:8787` and opened to a spinner, and it is why `gate:web` scans
> `dist/` rather than the source.

#### 2. Server-Only Credentials (Never in Client Bundles)

| Variable | Required | Scope / Mode | Description | Default |
|---|---|---|---|---|
| `DATABASE_BACKEND` | Yes | All | Two questions at once — see below the table | `supabase` |
| `SUPABASE_SECRET_KEY` | Yes (Supabase) | Server | Service-role key with full RLS bypass | `—` |
| `SUPABASE_URL` | Yes (`supabase_rest`) | Server | Base URL of the Supabase (or self-hosted PostgREST) project | `—` |
| `JWT_SECRET` | Yes | Server | Shared signing key for tokens & PostgREST | `—` |
| `NESHAN_API_KEY` | Yes (routing) | Server | Shared API key for Neshan matrix & direction | `—` |
| `NESHAN_MATRIX_API_KEY` | No | Server | Dedicated Neshan matrix key | `—` |
| `NESHAN_DIRECTION_API_KEY` | No | Server | Dedicated Neshan direction routing key | `—` |
| `ORS_API_KEY` | No | Server | OpenRouteService API key fallback | `—` |
| `AI_PROVIDER_KEY` | No | Server | Optional model provider. Absent means deterministic-only, which is the shipped behaviour — no provider is reachable from Iran. | `—` |
| `POSTGRES_PASSWORD` | Yes (local_pg) | Server | Master PostgreSQL password. Compose refuses to start without it rather than defaulting. | `—` |
| `POSTGRES_USER` | No | Server | PostgreSQL username | `postgres` |
| `POSTGRES_DB` | No | Server | PostgreSQL database name | `freewhen` |
| `DATABASE_URL` | Yes (local_pg) | Server | Full database connection string | `—` |
| `AUTH_PORT` | No | Server | Local auth daemon listen port | `8789` |
| `REALTIME_PORT` | No | Server | Local realtime bridge listen port | `8788` |
| `ANON_SIGNIN_LIMIT_PER_HOUR` | No | Server | Rate limit for anonymous sign-ins per IP | `30` |
| `ANON_TOKEN_TTL_SECONDS` | No | Server | Lifetime of issued anonymous token (seconds) | `3600` |

**`DATABASE_BACKEND` answers two different questions, and that is deliberate.**

1. *Which deployment stack?* `supabase` (default) or `local_pg`.
2. *Which wire protocol does the API use?* `pg` (default, over a TCP socket) or `supabase_rest` (PostgREST over HTTPS, no socket, no direct Postgres credential).

Both `supabase` and `local_pg` describe Postgres reached over TCP, so the server resolves **both** to `pg` — an existing `.env` with either value keeps booting with byte-identical behaviour. An **unknown** value is a startup failure, not a silent fallback to the default: a typo would otherwise serve one transport while the operator believed they had configured the other.

#### 3. GitHub Actions variables and secrets

The workflows read their configuration from **repository variables** and
**secrets**, not from a committed `.env`. The full matrix — every name, which
target needs it, and what breaks without it — is in
[`.github/workflows/README.md`](.github/workflows/README.md) §2 and §3.

The two that matter most, because they are the ones whose absence is invisible:

| Name | Kind | Why |
|---|---|---|
| `FREEWHEN_SERVER_URL` | variable | the origin the APK inlines at build time; written by the deploy workflow, read by the APK one |
| `ANDROID_KEYSTORE_SHA256` | secret | the release certificate digest `verify-apk` compares against — without it a signature is verified but not matched to a known key |

> **`.github/` is outside every gate's scan set.** `scripts/gate/secrets.ts` walks
> `src/`, `app/` and `server/`, and it never will walk workflows: a workflow
> legitimately contains `${{ secrets.JWT_SECRET }}`, which a name-based rule
> flags on every line. `tests/docs/ci-workflows.test.ts` is the substitute — it
> asserts the job orderings, the refusals, and that no credential *shape* reached
> a workflow file.

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

The runner is `node:test` — no Jest, no Vitest, no transform step. One invocation
currently runs **1 272 tests across 171 suites** (1 255 pass, 17 skipped by design).

```bash
# Run the pure unit & integration test runner
npm test

# Run tests filtering by pattern
npm test -- jalali
npm test -- engine

# Run the dedicated engine fairness & lens verification suite
npm run test:engine

# Run the live database RLS & cascade test suite (requires local Postgres)
npm run test:db

# Run the accessibility subset
npm run test:a11y

# Run the Maestro device flow (requires the Maestro CLI and a running app)
npm run test:e2e
```

`npm run test:db` applies pending migrations on every run rather than only against a
fresh schema — a suite that tests stale DDL is worse than one that never ran.

### Other Tooling

| Script | What it does |
|---|---|
| `npm run qa:all` | The whole-checklist command: typecheck → lint → gates → tests → engine, stopping at the first failure. `gate:all` answers "is the bundle shippable?"; this answers "is anything at all broken?" |
| `npm run check:docs` | Validates the PRD/plan tree: frontmatter, traceability, archived links |
| `npm run check:namespace-drift` | Flags generated SQL that drifted from its TypeScript source |
| `npm run gen:server-sql` | Regenerates `server/sql/` from its TypeScript definitions |
| `npm run gen:privacy-notice` / `gen:web-pages` | Regenerates the privacy notice and the static `web/` pages |
| `npm run gen:seo` | Writes `robots.txt` and `sitemap.xml` into `dist/` (called by `build:web`) |
| `npm run db:local:down` | Stops the local Postgres + PostgREST stack |
| `npm run job:retention` | Applies the documented retention windows |
| `npm run job:anon-cleanup` | Removes anonymous identities that never joined anything |
| `npm run worktree` | Isolates an agent's worktree and test database |
| `npm run flags:parse` | Parses `[fw:apk]` style commit flags for the workflows |

### SEO and share metadata

`c6721cf` completed the document metadata: `app/+html.tsx` renders `canonical`,
`og:url`, `og:image`, `twitter:card` and `hreflang` into the **served HTML**, resolved at
export time from `src/lib/seo.ts`. The share image is `public/banner.webp` (1200×630),
declared with its real pixel size so an unfurl reserves the right box. A client-side
`<Head>` would put these tags in the browser after the response arrived, and the crawlers
and chat apps that read them never run the JavaScript.

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

Everything below runs on the operator's machine, and every step is a script. That
was the whole design for a long time: one host, one operator, one deploy per day
at most, and a manual step is *repeatable* rather than *remembered*.

Two of those script sequences — the APK build and the deploy — are now also
reachable from GitHub Actions. **The manual path is still the primary one** and
still works end to end; the workflows exist because three things a person could
not reliably do by hand turned out to matter:

1. **`build-apk.sh` produced one artifact.** It named `app-release.apk` while
   `gradle.properties` declared four ABIs, so every release carried the same
   universal build and the per-ABI outputs were discarded.
2. **Nothing checked the signature of what was built.** A fresh
   `expo prebuild` re-signs `release` with the debug key unless
   `build-apk.sh` rewrites `gradle.properties`, and the result is an artifact
   that downloads, installs on a developer's machine, and **cannot** be installed
   over the previous app on a participant's phone.
3. **`deploy.sh` needs a laptop with the key.** That is fine until the person is
   away, and it makes the deploy's provenance impossible to audit.

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

### GitHub Actions

Four workflows — three you dispatch, one shared resolver. Names, secrets and
flags are in [`.github/workflows/README.md`](.github/workflows/README.md); this is
what they are for.

| Workflow | Trigger | What it guarantees |
|---|---|---|
| **CI** | push to `main`, every PR | typecheck, lint, tests, the seven gates **against a real `dist/`**, and migrations applied twice to a throwaway Postgres to prove they are idempotent |
| **Release APK** | dispatch, or a push whose message says `[fw:apk]` | every ABI plus universal, each **validated**, published as a **draft** by default |
| **Deploy** | **dispatch only** | one target per run: migrate → serve → health check → verify |
| **Resolve config** | called | the precedence chain in one place, with validation |

**Deploy has no push trigger, deliberately.** A commit flag chooses an APK's
ABIs; it cannot publish a release and it cannot deploy. A bad APK is one
download replaced in minutes; a bad deploy is the live product.

The CI job is the honest addition rather than a box-tick: until it existed, the
seven gates ran only when somebody remembered, and `gate:web` had never been run
against a bundle built with real `EXPO_PUBLIC_*` values. It exports first —
`gate:web` scans `dist/`, and gating before the export would fail for the wrong
reason.

One name is shared between the two shipping workflows: the deploy writes
**`FREEWHEN_SERVER_URL`** as a repository variable, and the APK workflow reads it
as the origin it inlines. That is what makes "build the app after the server
exists" automatic instead of a URL copied by hand and eventually copied stale.

#### Deploy targets — tested against real accounts

Every credential was exercised against a live account, and two targets came back
serving the app. The full evidence, including the exact request behind each
verdict, is in [`docs/reports/41.2-platform-survey-report.md`](docs/reports/41.2-platform-survey-report.md).

| Target | State |
|---|---|
| **Vercel** | **deployed and verified** — https://freewhen-review.vercel.app |
| **Netlify** | **deployed and verified** — https://freewhen-review.netlify.app |
| **Neon** (database) | **connected and writable** — PostgreSQL 18.6, write + read verified |
| **Fly** | token valid, org writable, 0 apps |
| **Cloudflare** | token valid but **no account scope** — Pages/Workers unreachable |
| **Railway** | supplied value is **not a valid token** of any type |
| **Render** | token works; `static_site` **requires a connected repo**, so no directory upload |
| **Supabase** (database) | control plane works; the database password is **not API-readable** |
| **Daytona** | build/test VM verified (create → start → delete); **no public ingress** |
| **FreeStyle** | **key rejected** on every route |
| **Koyeb** | **removed** — deprecated, and the workflow refuses it by name |

Three of ten credentials do not work, and **none of the three is a code
problem**: one token has no account scope, one is the wrong token type, one is
rejected outright. That distinction is the point of the survey — "it failed" hides
which of them a change to the repository could actually fix, and for these three
the answer is none.

**What the verification actually checks.** Not status codes. A live deploy taught
this the expensive way: Vercel's first deployment answered `200` for `/start` and
served the **home page's HTML**, because a catch-all rewrite swallowed the
per-route file `expo export` had emitted. `verify-deployment.sh` therefore
compares page bodies, requires the `start-screen` marker, asserts `dir="rtl"` in
the served markup, rejects a body large enough to be a login wall, and probes the
refused paths. Four Vercel-specific traps are documented in
[`.github/workflows/README.md`](.github/workflows/README.md) §5.

Every request-scoped target loses the realtime bridge, so votes arrive on the
10-second poll; the run summary says so on every such deploy.

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

The funnel (`server/lib/analytics.ts`) records seven steps: `invite_link_opened` → `guest_joined` → `start_point_set` → `proposal_created` → `vote_cast` → `decision_confirmed` → `rsvp_changed`. Step 2 → 5 is the acquisition funnel.

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
| **G-2** | **No block/report between participants.** Apple §1.2 requires blocking for UGC apps. | **Compliance risk** | The chat thread now ships report on another person's message and organizer-side deletion, but **there is still no block** and no user profile to block. Comments remain proposal-scoped plain text with organizer deletion. | **Becomes mandatory the moment blocking a person (rather than reporting a message) is expected** |
| **G-3** | **No screenshot protection.** | Unpreventable | Structurally impossible to prevent | Documented in the in-app privacy notice |
| **G-4** | **No age verification.** | Low | A documented decision; the listing states 18+ | If the user base skews young |
| **G-5** | **Organizer identity is device-scoped.** Losing the device loses organizer control. | Event can strand | Ownership continuity prevents the worst case | Account system |
| **G-6** | **No CAPTCHA on anonymous sign-in.** | DB-size abuse | Time | If abuse is observed |
| **G-7** | **The browser has no 3D map.** The ranked list is complete; the map is Android-only. | Low — the list carries the decision | No web build of the native map renderer; a web map is a separate renderer with separate costs (OQ-18.3, deferred to P2) | When a reviewer's confusion is traced to the missing map rather than to the ranking |
| **G-8** | **No automated rollback.** The workflows publish; reverting a release or a deploy is still a manual act. | Low — releases are drafts by default and migrations are additive | A rollback action needs a previous-artifact store and a decision about what "the previous good deploy" means per provider | The first time a bad release reaches a reviewer |
| **G-9** | **No iOS build pipeline.** | Low — the reviewer path is the web export | No Apple credentials, no macOS runner, no signing certificate. `README` has always listed iOS as missing | An Apple developer account |
| **G-10** | **Only the static half is deployed to a public host.** Both live targets (Vercel, Netlify) serve the web export; no backend is hosted, so `/api/*` and `/start`'s live ranking rely on a server that is not running there. | **Medium** — `/start` renders but its data requests fail until a backend exists | Every backend target needs one thing this survey could not supply: an account token (Railway), account scope (Cloudflare), a connected repo (Render), or an ssh host (VPS). The two static deployments prove the artifact, not the stack | Before any reviewer is given a URL rather than a local checkout |
| **G-11** | **No real signed APK release has been published.** The matrix, the keystore decode and `validate-apk.sh` are tested against synthetic APKs; `release-apk.yml` builds and verifies every ABI, but the first real dispatch has not happened. | Low — the validator refuses the known-bad shapes, and a draft prerelease is the default | Needs the release keystore and a ~20-minute Gradle run; neither exists in this environment | The first dispatch of **Release APK** |
| **G-12** | **The Vercel and Netlify deployments serve the artifact, not the stack.** Page bodies, the `start-screen` marker and `dir="rtl"` are verified; the ranking those pages ask for is not, because no backend is reachable from them. | Medium | Same blocker as G-10 | When a backend host is provisioned |

**G-2 is the most important entry.** It is a conscious compliance risk that must be revisited before any messaging feature ships.

**G-7 is a design decision, not an oversight.** The app ships as a web artifact precisely so the ranked list, the lens switch and the confirm action work without an install. The 3D map is the one screen that could not come with it, and every fact the map would show — each venue, its reason, its travel estimate, the participant legend — is on `/event/<id>` in the browser. Leaving it unwritten would turn an accepted trade into an apparent defect, which is why it is stated here and on `/start`.

The in-app privacy notice (`assets/privacy/{fa,en}.md`, bundled for offline reading) states these limitations to the user in both languages, so the disclosure does not depend on someone reading this repository.

## What is deliberately missing

The table above is the register. This section is the prose version — the three things a reviewer will notice first, and why each one is a decision rather than an oversight.

- **Transit is an estimate.** No Iranian provider offers transit routing and no Tehran GTFS feed exists (verified during the research phase). Figures are distance-based, shown as **ranges**, and labelled «تخمینی» in Persian and "estimated" in English. This is a permanent, honest answer, not a stopgap waiting on a feed.
- **Venue accessibility data is thin.** OpenStreetMap has **668 `wheelchair` editors for Iran** versus 135,155 globally. We show «نامشخص» (unknown) rather than guessing, and only a `confirmed_no` attribute excludes a venue. An unknown attribute never counts against a place, and it never gets promoted to "accessible" either.
- **Report ships; block does not (G-2).** Chat now has report-on-a-message and organizer deletion, so the free-text surface is moderated. What is still missing is blocking a *person*, which needs a participant profile to block. A conscious compliance risk, documented above.
- **G-1 — a leaked invite link is the accepted primary risk.** Expiry, revocation, rate limiting and coordinate rounding are the mitigations. The link *is* the credential.
- **G-3 — no screenshot protection.** Structurally impossible to prevent.
- **G-4 — no age verification** beyond an 18+ declaration.
- **G-5 — organizer identity is device-scoped.** Losing the device loses organizer control.
- **iOS is out of scope.** No Apple Developer account is obtainable by Iran residents. The web invite page covers iPhone users for viewing and joining.

**What is claimed, and what is not.** FreeWhen is *fair meeting-point decisions built for Iran* — the locale is the moat: Persian RTL, Jalali dates, Iranian geography, local routing. Cost and accessibility are treated as fairness dimensions, and every figure is labelled with how certain it is. What is **not** claimed is that fairness in group decision-making was invented here: at least one comparable product already publishes an average-time-plus-gap figure, and another explicitly claims a fair meeting point. Anyone who has seen those would discount the product for the claim, correctly.

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