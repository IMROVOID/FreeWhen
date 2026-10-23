# Dockerfile — the FreeWhen backend, one image, two entrypoints.
#
# ★ ONE IMAGE, TWO COMMANDS.
#
# `npm run server` and `npm run server:realtime` are two processes over the same
# source tree. Baking the tree once and selecting the process at run time means
# the bridge and the API can never drift onto different commits — the failure the
# local Compose file exists to prevent (see docker-compose.local.yml).
#
# ★ PORTABLE ON PURPOSE.
#
# Nothing here names a hosting provider. The image expects exactly what any
# container platform gives you:
#
#   PORT          the port to listen on            (read by server/index.ts)
#   API_HOST      the interface to bind            (override to 0.0.0.0)
#   DATABASE_URL  a Postgres connection string     (read by the pool)
#   JWT_SECRET    the PostgREST/token-service signer
#
# Point it at a platform, a VPS, or `docker run` on a laptop. The only values a
# platform must supply beyond these are the ones in `.env.example`.
#
# ★ tsx RUNS THE TYPESCRIPT DIRECTLY, AND THAT IS DELIBERATE.
#
# `server/` is not bundled. A bundler step would mean the image runs a build
# artifact no test ever exercised, and the DB suite loads `server/app.ts`
# directly — so the code the tests prove is the code that ships. `tsx` is
# already the repo's own runner (scripts/db/*.ts).
#
# ★ THE WEB EXPORT IS NOT IN HERE.
#
# `dist/` is exported from the developer's machine, because the EXPO_PUBLIC_*
# values are inlined at export time and must exist in the build shell. This
# image is the BACKEND only. Serve `dist/` from a static host or a CDN.

# Pinned to a major matching the repo's Node floor (>=22.13, per the ROADMAP
# stack row). `slim` keeps the image small; `pg` needs no libpq or toolchain.
FROM node:22-bookworm-slim

# ★ `NODE_ENV` IS SET AT RUNTIME, NOT HERE.
#
# Baking it as `production` would make `npm ci` skip devDependencies at build
# time — and `tsx` is one of them. It is exported in the run command instead
# (see the compose file), so the image carries the tools the process needs.
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

WORKDIR /app

# ★ MANIFESTS BEFORE SOURCE, so a code-only change reuses the dependency layer.
# `npm ci` refuses a lockfile that disagrees with package.json, turning a stale
# lock into a build failure rather than a mystery at run time.
COPY package.json package-lock.json ./
RUN npm ci

# The runtime tree. Migrations are included because the deploy path can run
# `npm run db:migrate` from inside this image — see docs/RUNBOOK.md §4.
COPY tsconfig.json ./
COPY migrations ./migrations
COPY server ./server
COPY src ./src

# ★ A NON-ROOT USER. Nothing here writes to disk, so there is no reason to hold
# uid 0. `node` ships with the base image.
USER node

# Informational only — the platform reads the real port from the service config.
# 8787 is the API; the bridge uses 8788.
EXPOSE 8787

# ★ `0.0.0.0`, NOT THE DEFAULT `127.0.0.1`.
#
# `server/index.ts` binds to `API_HOST ?? '127.0.0.1'`. A loopback listener
# inside a container is unreachable from the platform's load balancer — the port
# would look open and every request would time out. This is the single most
# important line in the image.
ENV API_HOST=0.0.0.0

# ★ `/health`, NOT `/api/health`.
#
# Both reach the same handler, but a platform health check is pointed at a bare
# path. It is deliberately unauthenticated, so it proves the database is up
# without needing a token.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "server"]
