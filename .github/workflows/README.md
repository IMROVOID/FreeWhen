# GitHub Actions — variables, secrets, and flags

**The reference for every knob these workflows read.** If a name is not in this
file, a workflow that reads it is a typo, and `tests/docs/ci-workflows.test.ts`
fails the build for exactly that reason — a variable name that falls back to its
default at runtime is invisible, and the flag that did nothing never appears in
a log anyone reads.

Two workflows and one CI pipeline:

| Workflow | Trigger | What it does |
|---|---|---|
| [`ci.yml`](ci.yml) | push to `main`, every PR | typecheck, lint, tests, the seven gates against a real `dist/`, and migrations applied **twice** to a throwaway Postgres |
| [`release-apk.yml`](release-apk.yml) | dispatch, or a push whose message says `[fw:apk]` | builds every requested ABI **plus** a universal APK, verifies each one, publishes a GitHub Release (draft by default) |
| [`deploy.yml`](deploy.yml) | dispatch **only** | deploys to **exactly one** provider chosen by `target` |

> **Deploy is dispatch-only, and that is the decision.** A commit flag chooses
> an APK's ABIs; it cannot publish a release and it cannot deploy. The blast
> radius of a bad APK is one download that can be replaced in minutes. The blast
> radius of a bad deploy is the live product. Deploying is a decision a person
> makes, with a target, in a run they can see.

---

## 1. Precedence

Every knob resolves through the same chain, implemented once in
[`.github/actions/resolve-inputs`](../actions/resolve-inputs/action.yml):

```
workflow_dispatch input   >   vars.FREEWHEN_<X>   >   [fw:…] commit flag   >   default
```

The dispatch input wins because it is the most specific act of will — a human
chose it for this run. The repository variable is the standing configuration.
The commit flag is the author's intent at the time of the commit. The default is
the documented baseline.

**An unrecognised value is a failure, never a fallback.** `mode=prod` does not
quietly become `production`, for the same reason `.env.example:103-107` refuses
an unknown `DATABASE_BACKEND`: a typo that silently serves a different
configuration surfaces much later, in production.

| Knob | Default | Accepted |
|---|---|---|
| `archs` | all four | any comma list of `armeabi-v7a`, `arm64-v8a`, `x86`, `x86_64` |
| `universal` | `true` | `true`, `false` |
| `release_mode` | `draft` | `draft`, `publish` |
| `mode` | `production` | `production`, `preview`, `development` |
| `version` | `app.json`'s `expo.version` | `x.y.z` |
| `target` | *(none)* | `vps`, `railway`, `koyeb`, `cloudflare`, `netlify`, `deno`, `vercel` |

---

## 2. Repository variables (`vars.*`)

Configure in **Settings → Secrets and variables → Actions → Variables**.

### 2.1 Client values, inlined at build time

`EXPO_PUBLIC_*` is substituted by the bundler, not read at runtime. A value that
exists only on the host never reaches the bundle — which is why these are
workflow variables consumed by the **build step**, not host configuration.

| Variable | Required | What breaks without it |
|---|---|---|
| `FREEWHEN_APP_BASE_URL` | production builds | `/start`'s QR encodes a relative path and renders "not configured" |
| `FREEWHEN_SERVER_URL` | production builds | the APK's inlined API origin falls back to `127.0.0.1` — the phone itself |
| `FREEWHEN_DEMO_TOKEN` | reviewer path | `/start` has no demo event to open |
| `FREEWHEN_MAPBOX_PUBLIC_TOKEN` | the map | the map degrades to list-only on Android too |
| `FREEWHEN_TILE_STYLE_URL` | no | the default style is used |
| `FREEWHEN_SUPABASE_URL` | CI gates | `gate:web` scans a bundle built without a Supabase origin |
| `FREEWHEN_SUPABASE_PUBLISHABLE_KEY` | CI gates | same |

> **`APP_BASE_URL` and `SERVER_URL` are the same origin in this deployment.**
> The API is served same-origin behind Caddy (`handle /api/*`), so the app's own
> public origin *is* the API origin. `src/lib/api-base-url.ts` resolves
> `EXPO_PUBLIC_API_URL` → `EXPO_PUBLIC_APP_BASE_URL`, so either name works, and
> the second is the one that is actually documented.

### 2.2 Defaults for the APK workflow

| Variable | Purpose |
|---|---|
| `FREEWHEN_DEFAULT_ARCHS` | the standing ABI list when a dispatch leaves `archs` blank |
| `FREEWHEN_DEFAULT_UNIVERSAL` | `true`/`false` — whether the universal APK is built |
| `FREEWHEN_DEFAULT_RELEASE_MODE` | `draft` (default) or `publish` |
| `FREEWHEN_DEFAULT_VERSION` | a pinned version instead of `app.json` |
| `FREEWHEN_DEFAULT_MODE` | `production` (default) or `development` |
| `FREEWHEN_OVERWRITE_RELEASE` | `true` allows re-publishing over an existing release tag |

### 2.3 Deploy targets

| Variable | Target | Purpose |
|---|---|---|
| `FREEWHEN_SERVER_URL` | all | the public origin; also what the smoke tests assert against |
| `FREEWHEN_SSH_HOST_FINGERPRINT` | vps | **required** — the pinned host key. See §3.1 |
| `FREEWHEN_SSH_PORT` | vps | defaults to `22` |
| `FREEWHEN_DATABASE_BACKEND` | cloudflare, deno | must be `supabase_rest` for an edge runtime |
| `FREEWHEN_WORKER_NAME` | cloudflare | the Worker's name |
| `FREEWHEN_PAGES_PROJECT` | cloudflare | the Pages project for `dist/` |
| `FREEWHEN_DENO_PROJECT` | deno | the Deno Deploy project |
| `FREEWHEN_VERCEL_ENABLED` | vercel | **must be `true`** — see §4 |

### 2.4 Which variables the deploy workflow writes

**`FREEWHEN_SERVER_URL`.** After a successful deploy the operator sets it (or a
follow-up run does), and the APK workflow reads it as the origin it inlines. That
one shared name is what makes "build the app after the server exists" automatic
instead of a URL copied by hand and eventually copied stale.

---

## 3. Secrets (`secrets.*`)

### 3.1 The APK signing key

| Secret | Purpose |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the release keystore, base64-encoded |
| `ANDROID_KEYSTORE_PASSWORD` | the store password |
| `ANDROID_KEY_ALIAS` | the key alias (default `freewhen`) |
| `ANDROID_KEY_PASSWORD` | the key password (defaults to the store one) |
| `ANDROID_KEYSTORE_SHA256` | the release certificate's SHA-256 digest — **the strongest signature assertion** |

```bash
# Encode a keystore that lives outside the repository.
base64 -w0 freewhen-release.keystore   # macOS: base64 -i freewhen-release.keystore

# The expected signer digest, which verify-apk compares against.
keytool -list -v -keystore freewhen-release.keystore -alias freewhen \
  | grep 'SHA256:'
```

> **The keystore is the whole update path.** Android refuses an update signed by
> a different key, with no error that explains why. `verify-apk` refuses a
> debug-signed APK and, when `ANDROID_KEYSTORE_SHA256` is set, a signature from
> any other key — because publishing one would strand every installed copy.

### 3.2 The VPS target

| Secret / variable | Purpose |
|---|---|
| `SSH_HOST` (secret) | `deploy@your-host` |
| `SSH_KEY` (secret) | the deploy private key |
| `FREEWHEN_SSH_HOST_FINGERPRINT` (variable) | the pinned host key, **required** |

```bash
# Generate the fingerprint to pin.
ssh-keyscan -p 22 your-host | ssh-keygen -lf - -E sha256
```

> **`ssh-keyscan` alone is not a verification.** Scanning the key and then
> trusting it accepts whatever answers on that address, which is the attack
> host-key checking exists to prevent. The scan populates `known_hosts`; the
> fingerprint comparison is the verification. The workflow **refuses** to deploy
> when the variable is unset rather than trusting the scan.

### 3.3 Per-provider secrets

| Target | Secrets |
|---|---|
| vps | `SSH_HOST`, `SSH_USER`, `SSH_KEY`, `DATABASE_URL` *(external_db only)*, `POSTGRES_PASSWORD` *(self-contained only)*, `JWT_SECRET` |
| railway | `RAILWAY_TOKEN`, `JWT_SECRET`, `DATABASE_URL` *(external_db only)*, `RAILWAY_DATABASE_URL` *(for migrations)* |
| koyeb | `KOYEB_TOKEN`, `JWT_SECRET`, `DATABASE_URL` *(external_db only)* |
| cloudflare | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `JWT_SECRET` |
| netlify | `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID` |
| deno | `DENO_DEPLOY_TOKEN`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `JWT_SECRET` |
| vercel | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` |

All targets also accept `NESHAN_MATRIX_API_KEY`, `NESHAN_DIRECTION_API_KEY` and
`ORS_API_KEY`; absent, the routing ladder degrades to straight-line with
`confidence: 'low'`, which is a correct answer rather than a failure.

---

## 4. Provider support, stated honestly

| Target | Status | Note |
|---|---|---|
| **vps** | supported | two paths: Compose self-contained, or external `DATABASE_URL` |
| **railway** | supported | requires a pre-existing project with the repo connected |
| **koyeb** | supported | requires a pre-created app; **no static-site primitive**, so `web=true` warns rather than pretending |
| **cloudflare** | partial | Workers + Pages. API needs `supabase_rest`; no TCP Postgres |
| **netlify** | static only | `netlify/functions/api.ts` is owned by P40 and is not deployed here |
| **deno** | supported | Deno Deploy, edge entry, `supabase_rest` |
| **vercel** | **disabled by default** | needs `FREEWHEN_VERCEL_ENABLED=true` and a production approval |
| **fly.io** | **not implemented** | needs volumes, backups and an operator billing decision — do not list it as supported |

> **Every request-scoped target loses the realtime bridge.** `server/realtime/`
> holds a session-level `LISTEN` and a long-lived WebSocket; no FaaS platform
> offers either. The decision screen falls back to its 10-second poll, which
> `POLL_INTERVAL_MS` declares designed behaviour. The run summary says so on
> every such deploy rather than letting a reader assume push updates work.

---

## 5. Commit flags

Read from a commit message (on push) or a PR title, by
[`scripts/build/parse-commit-flags.ts`](../../scripts/build/parse-commit-flags.ts).
**Flags set parameters. They never trigger a deploy.**

| Flag | Effect |
|---|---|
| `[fw:apk]` | build the APK pipeline on this push (always as a **draft**) |
| `[fw:universal]` | also build the universal APK |
| `[fw:archs=arm64-v8a,x86_64]` | the ABI list |
| `[fw:mode=production]` | the build mode |
| `[fw:release_mode=draft]` | draft or publish *(publish from a push is still ignored)* |
| `[fw:version=1.2.3]` | the release version; must match `app.json` |
| `[fw:target=vps]` | recorded, but a push never deploys |

```bash
npx tsx scripts/build/parse-commit-flags.ts "[fw:apk] [fw:archs=arm64-v8a]"
npx tsx scripts/build/parse-commit-flags.ts --self-test
```

> **An unknown flag is a warning, not a silent ignore.** `[fw:archs=arm64-v8b]`
> is a typo whose failure mode is invisible — the workflow falls back to the
> default and nobody learns the flag did nothing. Every unrecognised token is
> printed as a `::warning::` annotation.

---

## 6. What this pipeline deliberately does not do

| Not built | Why |
|---|---|
| iOS builds | no Apple credentials; `README.md` §Known Gaps lists iOS as missing |
| Play Store upload | no service-account JSON, and no AAB is produced |
| Auto-deploy on push | see the note at the top — dispatch-only |
| Updating `/dl/freewhen.apk` from the release workflow | that path belongs to the deploy ordering (`export → gate:web → rsync`); writing it from a release would bypass the scan |
| `supabase_rest` against a paid database | needs the two grants in `server/runtime/REST_SETUP.md` plus a signed JWT; documented, not automated |
| Fly.io | see §4 |

---

## 7. Local verification

```bash
# Workflow syntax, plus expression and `needs:` typos that YAML alone misses.
actionlint

# The invariants this repository asserts about its own workflows.
npm test -- ci-workflows

# The flag grammar.
npx tsx scripts/build/parse-commit-flags.ts --self-test
```

`.github/` is **outside every release gate's scan set** — `scripts/gate/secrets.ts`
walks `['src', 'app', 'server']`, and a workflow legitimately contains
`${{ secrets.X }}`. `tests/docs/ci-workflows.test.ts` is the substitute: it
asserts the job orderings, the refusals, and that no credential *shape* reached
a workflow file.
