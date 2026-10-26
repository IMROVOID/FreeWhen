# GitHub Actions — variables, secrets, and flags

**The reference for every knob these workflows read.** If a name is not in this
file, a workflow that reads it is a typo, and `tests/docs/ci-workflows.test.ts`
fails the build for exactly that reason — a variable that falls back to its
default at runtime is invisible, and the flag that did nothing never appears in
a log anyone reads.

Three workflows and a shared resolver:

| File | Trigger | What it does |
|---|---|---|
| [`ci.yml`](ci.yml) | push to `main`, every PR | typecheck, lint, tests, the seven gates against a real `dist/`, and migrations applied **twice** to a throwaway Postgres |
| [`release-apk.yml`](release-apk.yml) | dispatch, or a push whose message says `[fw:apk]` | builds every requested ABI **plus** a universal APK, validates each one, publishes a GitHub Release (draft by default) |
| [`deploy.yml`](deploy.yml) | **dispatch only** | one target per run: migrate → serve → health check |
| [`_resolve-config.yml`](_resolve-config.yml) | called | resolves every knob through one precedence chain, with validation |

> **Deploy is dispatch-only, and that is the decision.** A commit flag chooses an
> APK's ABIs; it cannot publish a release and it cannot deploy. A bad APK is one
> download replaced in minutes; a bad deploy is the live product. Deploying is a
> decision a person makes, with a target, in a run they can see.

---

## 1. Precedence

Every knob resolves through the same chain, implemented once in
[`_resolve-config.yml`](_resolve-config.yml):

```
workflow_dispatch input  >  vars.FREEWHEN_*  >  [fw:key=value]  >  default
```

The dispatch input wins because it is the most specific act of will. The
repository variable is the standing configuration. **A variable beats a commit
flag on purpose**: a flag rides in every commit's message, so a flag that
outranked the variable would keep applying on later ordinary pushes until
somebody noticed.

**An unrecognised value is a failure, never a fallback.** `mode=prod` does not
quietly become `production`, for the same reason `.env.example:103-107` refuses
an unknown `DATABASE_BACKEND`: a typo that silently serves a different
configuration surfaces much later, in production.

| Knob | Legal values | Default |
|---|---|---|
| `archs` | `all`, or a comma list of `armeabi-v7a`, `arm64-v8a`, `x86`, `x86_64` | `all` |
| `universal` | `true`, `false` | `true` |
| `release_mode` | `draft`, `publish` | `draft` |
| `version` | `x.y.z` | `app.json`'s `expo.version` |
| `mode` | `production`, `preview`, `development` | `production` |
| `target` | `vps`, `vercel`, `netlify`, `cloudflare`, `railway`, `render`, `fly` | *(none — required)* |

---

## 2. Repository variables (`vars.*`)

Configure in **Settings → Secrets and variables → Actions → Variables**.

### 2.1 Client values, inlined at build time

`EXPO_PUBLIC_*` is substituted by the bundler, not read at runtime. A value that
exists only on the host never reaches the bundle — which is why these are
consumed by the **build step**, not by the host.

| Variable | Required | What breaks without it |
|---|---|---|
| `FREEWHEN_SERVER_URL` | production builds, every deploy | the APK's inlined API origin falls back to `127.0.0.1` — the phone itself. Also the deploy's public origin and the smoke test's target |
| `FREEWHEN_APP_BASE_URL` | production builds | `/start`'s QR encodes a relative path and renders "not configured" |
| `FREEWHEN_DEMO_TOKEN` | reviewer path | `/start` has no demo event to open; `/e/<token>` is not checked |
| `FREEWHEN_MAPBOX_PUBLIC_TOKEN` | the map | the map degrades to list-only |
| `FREEWHEN_TILE_STYLE_URL` | no | the default style is used |
| `FREEWHEN_EXTRA_ORIGINS` | no | a custom domain gets no CORS headers and the whole API fails there — see below |
| `FREEWHEN_SUPABASE_URL` | CI gates | `gate:web` scans a bundle built without a Supabase origin |
| `FREEWHEN_SUPABASE_PUBLISHABLE_KEY` | CI gates | same |

> **`FREEWHEN_SERVER_URL` and `FREEWHEN_APP_BASE_URL` are the same origin in the
> deployment this repo targets.** The API is served same-origin behind Caddy
> (`handle /api/*`), so the app's own public origin *is* the API origin.
> `src/lib/api-base-url.ts` resolves the page's own origin on web, then
> `EXPO_PUBLIC_API_URL` → `EXPO_PUBLIC_APP_BASE_URL`, so either name works and
> the second is the one that is documented.

> **Adding a custom domain: set `FREEWHEN_EXTRA_ORIGINS`, comma-separated.**
> The deploy publishes the app on two hosts whenever a domain is attached — the
> platform URL and the custom one — and `APP_ORIGIN` is the API's CORS
> allowlist.
>
> Because it was a single exact-match value, the custom domain sent an `Origin`
> the API did not recognise. The preflight returned 204 with no
> `access-control-allow-origin`, the browser refused every request, and the
> whole app failed to load on the custom domain while working perfectly on the
> platform one. `APP_ORIGIN` is now read as a comma-separated list, which
> `server/lib/cors.ts` parses (trimming, trailing slashes, failing closed).
>
> The web build itself needs no rebuild for this: `src/lib/api.ts` reads
> `location.origin` at runtime, so a page always calls the host it was served
> from. Only the server's allowlist has to name the extra hosts.

### 2.2 Defaults for the resolvers

| Variable | Purpose |
|---|---|
| `FREEWHEN_DEFAULT_ARCHS` | the standing ABI list when a dispatch leaves `archs` blank |
| `FREEWHEN_DEFAULT_UNIVERSAL` | `true`/`false` — whether the universal APK is built |
| `FREEWHEN_DEFAULT_RELEASE_MODE` | `draft` (default) or `publish` |
| `FREEWHEN_DEFAULT_VERSION` | a pinned version instead of `app.json` |
| `FREEWHEN_DEFAULT_MODE` | `production` (default), `preview` or `development` |
| `FREEWHEN_DEFAULT_TARGET` | the standing deploy target, so a dispatch can leave it blank |
| `FREEWHEN_OVERWRITE_RELEASE` | `true` allows re-publishing over an existing release tag |
| `FREEWHEN_DATABASE_BACKEND` | `local_pg` (default) or `supabase_rest`. **Must be `supabase_rest` for cloudflare** |

### 2.3 Per-target variables

| Variable | Target | Purpose |
|---|---|---|
| `VPS_HOST`, `VPS_USER`, `VPS_PATH` | vps | the ssh target |
| `VPS_SSH_HOST_FINGERPRINT` | vps | **required** — the pinned host key (see §3.3) |
| `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | vercel | the linked project. **Without both, the CLI creates a second project** |
| `FREEWHEN_VERCEL_ENABLED` | vercel | **must be `true`** — see §4 |
| `NETLIFY_SITE_ID` | netlify | optional; the site is created by name when absent |
| `CLOUDFLARE_ACCOUNT_ID` | cloudflare | the account id from the dashboard URL |
| `CF_PAGES_PROJECT` | cloudflare | the Pages project name |
| `RAILWAY_SERVICE` | railway | the service to push |
| `RENDER_SERVICE_ID`, `RENDER_OWNER_ID` | render | the service, and the owner to create it under |
| `FLY_APP`, `FLY_REGION` | fly | the app name and region |
| `POSTGRES_DB`, `POSTGRES_USER` | vps | names, not credentials |

---

## 3. Secrets (`secrets.*`)

### 3.1 The APK signing key

| Secret | Purpose |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the release keystore, base64-encoded |
| `ANDROID_KEYSTORE_PASSWORD` | the store password |
| `ANDROID_KEY_ALIAS` | the key alias (default `freewhen`) |
| `ANDROID_KEY_PASSWORD` | the key password (defaults to the store one) |
| `ANDROID_KEYSTORE_SHA256` | the release certificate's SHA-256 digest — the strongest signature assertion |

```bash
base64 -w0 freewhen-release.keystore          # macOS: base64 -i …
keytool -list -v -keystore freewhen-release.keystore -alias freewhen | grep 'SHA256:'
```

> **The keystore is the whole update path.** Android refuses an update signed by
> a different key, with no error that explains why. `validate-apk.sh` refuses a
> debug-signed APK, and — when `ANDROID_KEYSTORE_SHA256` is set — a signature
> from any other key.

### 3.2 The database

| Secret | Purpose |
|---|---|
| `DATABASE_URL` | the Postgres connection string for the deployment. Neon and Supabase both work |
| `POSTGRES_PASSWORD` | only for a **self-contained** VPS deploy |
| `JWT_SECRET` | the PostgREST / token-service signer |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | only for `cloudflare` with `api=true` |

> **TLS is appended for a managed provider.** `Neon` and `Supabase` refuse a
> connection without `sslmode`, and the error reads as "password authentication
> failed" — which sends an operator to rotate a password that was fine.
> `db-migrate.sh` appends it when the URL does not already say.

### 3.3 The VPS target

| Secret / variable | Purpose |
|---|---|
| `VPS_SSH_KEY` (secret) | the deploy private key |
| `VPS_SSH_HOST_FINGERPRINT` (variable) | the pinned host key, **required** |

```bash
ssh-keyscan your-host | ssh-keygen -lf - -E sha256
```

> **`ssh-keyscan` alone is not a verification.** Scanning the key and then
> trusting it accepts whatever answers on that address, which is the attack
> host-key checking exists to prevent. The workflow **refuses** to deploy when
> the fingerprint is unset or does not match.

### 3.4 Per-target secrets

| Target | Secrets |
|---|---|
| vps | `VPS_SSH_KEY`, `DATABASE_URL` *(external_db)*, `POSTGRES_PASSWORD` *(self-contained)*, `JWT_SECRET` |
| vercel | `VERCEL_TOKEN` |
| netlify | `NETLIFY_AUTH_TOKEN` |
| cloudflare | `CLOUDFLARE_API_TOKEN`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` |
| railway | `RAILWAY_TOKEN` |
| render | `RENDER_API_KEY` |
| fly | `FLY_API_TOKEN` |

All targets also accept `NESHAN_MATRIX_API_KEY`, `NESHAN_DIRECTION_API_KEY` and
`ORS_API_KEY`; absent, the routing ladder degrades to straight-line with
`confidence: 'low'`, which is a correct answer rather than a failure.

---

## 4. Target support, stated honestly

Every row below was exercised against a real account during this survey. The
full evidence is in
[`docs/reports/41.1-platform-survey.json`](../../docs/reports/41.1-platform-survey.json).

| Target | Status | Notes |
|---|---|---|
| **vps** | supported | two paths: Compose self-contained, or external `DATABASE_URL` |
| **vercel** | **supported and verified** | needs `FREEWHEN_VERCEL_ENABLED=true`. See the four Vercel traps in §5 |
| **netlify** | **supported and verified** | ZIP deploy; the site is created by name when no id is given |
| **cloudflare** | partial | static half only. `api=true` needs `supabase_rest`; a Worker has no TCP socket |
| **railway** | needs a valid token | a **project** token cannot read the domain list, so `FREEWHEN_SERVER_URL` must be set |
| **render** | needs a connected repo | `static_site` refuses a directory upload (`repo is required`); the build runs on Render, so `EXPO_PUBLIC_*` are service env vars |
| **fly** | supported | the org token is `FlyV1 <payload>,<mac>` — **quote it in a `.env`**, the space is part of the value |
| **koyeb** | **removed** | deprecated. The workflow refuses it by name rather than reporting "unknown target" |

> **Every request-scoped target loses the realtime bridge.** `server/realtime/`
> holds a session-level `LISTEN` and a long-lived WebSocket; no FaaS platform
> offers either. The decision screen falls back to its 10-second poll, which
> `POLL_INTERVAL_MS` declares designed behaviour. The run summary says so on
> every such deploy rather than letting a reader assume push updates work.

### Sandbox and database providers

Not deploy targets, but tested:

| Provider | Use | Finding |
|---|---|---|
| **daytona** | build/test VM | create → start → delete verified. **No public ingress**, so it cannot serve the app |
| **freestyle** | build/test VM | key rejected on every route and header. Also documented as *not* for hosting production apps |
| **neon** | `DATABASE_URL` | PG 18.6, write+read verified. The connection host is `ep-<id>.<proxy_host>`, **not** `proxy_host` — its certificate does not cover the bare name |
| **supabase** | `DATABASE_URL` | control plane verified. The database password is set at creation and **never returned** by the API |

---

## 5. The four Vercel traps

Each of these produced a green run that served the wrong thing, and each is now
handled in `host-platform.sh` and pinned by a test.

1. **Deployment protection is on by default.** Every URL answers `200` with a
   ~330 KB login wall. A status-only smoke test calls that success.
   → `PATCH /v9/projects/<id> {ssoProtection: null}`, and `verify-deployment.sh`
   rejects a body over 200 KB.
2. **Creating a deployment does not move the production domain.** The first
   deploy keeps it; later ones sit on a hashed preview URL. Every redeploy looks
   like a no-op. → `POST /v2/deployments/<id>/aliases`.
3. **A catch-all rewrite swallows an emitted route.** `expo export` writes one
   `.html` per route, so `/start` needs `cleanUrls` (or a `filesystem` handle)
   before any SPA fallback. Without it `/start` served the home page with a 200.
4. **The API's route handles are a closed set** — `error, filesystem, hit, miss,
   resource, rewrite`. `cleanUrls` is a project setting, not a handle; passing it
   is a 400.

---

## 6. Commit flags

Read from a commit message (on push) or a PR title, by
[`_resolve-config.yml`](_resolve-config.yml). **Flags set parameters. They never
trigger a deploy.**

| Flag | Effect |
|---|---|
| `[fw:apk]` | build the APK pipeline on this push (always as a **draft**) |
| `[fw:archs=arm64-v8a,x86_64]` | the ABI list |
| `[fw:universal]` | also build the universal APK (`[fw:universal=false]` disables it) |
| `[fw:mode=production]` | the build mode |
| `[fw:release_mode=draft]` | draft or publish — *a push still cannot publish* |
| `[fw:version=1.2.3]` | the version; must match `app.json` |
| `[fw:target=vps]` | the deploy target, recorded for a dispatch |
| `[fw:deploy]` | reported in the run log; **does not deploy** |

```bash
npx tsx scripts/build/parse-commit-flags.ts "[fw:apk] [fw:archs=arm64-v8a]"
npx tsx scripts/build/parse-commit-flags.ts --self-test
```

> **An unknown flag is a warning, not a silent ignore.** `[fw:archs=arm64-v8b]`
> is a typo whose failure mode is invisible — the workflow falls back to the
> default and nobody learns the flag did nothing. Every unrecognised token is
> printed as a `::warning::` annotation.

---

## 7. What this pipeline deliberately does not do

| Not built | Why |
|---|---|
| iOS builds | no Apple credentials; `README.md` §Known Gaps lists iOS as missing |
| Play Store upload | no service-account JSON, and no AAB is produced |
| Auto-deploy on push | deploy is dispatch-only — see the note at the top |
| Updating `/dl/freewhen.apk` from the release workflow | that path belongs to the deploy ordering (`export → gate:web → rsync`); writing it from a release would bypass the scan |
| `supabase_rest` against a paid database | needs the two grants in `server/runtime/REST_SETUP.md` plus a signed JWT; documented, not automated |
| A Cloudflare Worker from this workflow | the static half is published; the Worker is a separate unit with its own entry file |

---

## 8. Local verification

```bash
# Workflow syntax, plus expression and `needs:` typos that YAML alone misses.
actionlint

# The invariants this repository asserts about its own workflows.
npm test -- ci-workflows

# The APK validator, against synthetic APKs that should each fail one check.
python .tmp-apk/harness.py         # during development

# The flag grammar.
npx tsx scripts/build/parse-commit-flags.ts --self-test

# Any live deployment, with the exact checks the `verify` job runs.
WANT_API=false WANT_WEB=true bash .github/scripts/verify-deployment.sh https://freewhen-review.vercel.app
```

`.github/` is **outside every release gate's scan set** — `scripts/gate/secrets.ts`
walks `['src', 'app', 'server']`, and a workflow legitimately contains
`${{ secrets.X }}`. `tests/docs/ci-workflows.test.ts` is the substitute: it
asserts the job orderings, the refusals, the four Vercel traps, and that no
credential *shape* reached a workflow or script.
