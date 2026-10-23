# Deploying the API to a request/response runtime

`server/app.ts` is a pure `Request => Response` function. Everything in this
directory is an **edge**: it translates one runtime's calling convention into a
`Request` and the returned `Response` back out. Nothing here knows about routing,
validation or error shapes.

**No file in this directory names a hosting provider.** Each adapter implements a
*calling convention*, and any runtime that shares that convention works with it
unchanged. Find the convention your host uses in the table below and deploy the
file it names.

## Which file to deploy

| Convention | Entry file | Signature | Sockets | Realtime bridge |
|---|---|---|---|---|
| Binding-object `fetch` | `server/runtime/binding-fetch.ts` | `fetch(request, env, ctx)` | yes | no |
| Plain `fetch` | `server/runtime/web-fetch.ts` | `default async (request: Request) => Response` | yes | no |
| Event object | `server/runtime/event-object.ts` | `(event, context) => { statusCode, headers, body, isBase64Encoded }` | yes | no |
| Node signature | `server/runtime/node-signature.ts` | `(req: IncomingMessage, res: ServerResponse)` | yes | no |
| Descriptor | `server/runtime/descriptor.ts` | `(context, request) => { status, headers, body }` | yes | no |
| Edge `fetch`, no `process.env` | `server/runtime/edge-no-process-env.ts` | `export default { fetch }` | yes | no |
| Long-lived `fetch` | `server/runtime/long-lived-fetch.ts` | `(request: Request) => Response` | yes | **yes** |
| `pg` over REST, `fetch` | `server/runtime/rest-fetch.ts` | `fetch(request, env, ctx)` | **no** | no |
| Node listener / container | `server/index.ts` | `server.listen` | yes | **yes** |

### How to choose

- **Does your host give you a real `Request`?** Use `web-fetch.ts`.
- **Does it also give you a per-request binding object?** Use `binding-fetch.ts`.
- **Does it serialise the request into an event object?** Use `event-object.ts`.
- **Does it hand you `node:http` streams?** Use `node-signature.ts`.
- **Does it hand you a context plus a request *descriptor*?** Use `descriptor.ts`.
- **Does it have no `process.env`?** Use `edge-no-process-env.ts`.
- **Is the process long-lived?** Use `long-lived-fetch.ts` — and note the pool
  difference below.
- **Can it reach no TCP socket at all?** Use `rest-fetch.ts`.

### The event-object adapter serves several event shapes

Event-object runtimes differ in exactly one place — where the method and path live
— and share everything else. `event-object.ts` reads them in preference order:

| Concept | First | Fallbacks |
|---|---|---|
| Path | `rawPath` | `requestContext.http.path`, `path`, `/` |
| Method | `requestContext.http.method` | `httpMethod`, `GET` |
| Query | `rawQueryString` (verbatim) | rebuilt from `queryStringParameters` |
| Headers | `headers` | `multiValueHeaders` flattened underneath |
| Body | `body` + `isBase64Encoded` | absent |

A runtime whose event puts these fields somewhere else still works if you map it
to this shape before calling the handler — there is no vendor name in the
adapter, so nothing needs changing.

## The shared core

`driver.ts` holds the one thing every adapter needs and none of them should
reimplement: **create one client per request, connect, bind the database scope,
handle, and close unconditionally.** `bindEnvironment` copies the runtime's
bindings onto `process.env`, deleting absent keys rather than skipping them so a
rotated-away secret cannot outlive its request.

`http-normalise.ts` and `response.ts` are the two pure translations: Node-style
`{ method, url, headers, body }` → `Request`, and `Response` → a serialised
result.

### ★ Two client models, and picking the wrong one fails loudly

| Model | Used by | Why |
|---|---|---|
| **Per request** | every short-lived entry | The runtime gives no session; a leaked client is an unreclaimable connection |
| **Shared pool** | `long-lived-fetch.ts`, `server/index.ts` | One process serves many requests, so a pool is correct and cheaper |

`server/lib/db-scope.ts` refuses two overlapping scopes on *different* queryables.
A shared pool is the same object for every request, so concurrency is safe. Creating
a client per request inside a long-lived process would make every concurrent pair a
hard 500.

## The database connection

| Mode | Variables | Transport | Use when |
|---|---|---|---|
| `pg` (default) | `DATABASE_URL` | TCP socket via `pg` | The runtime has sockets |
| `supabase_rest` | `SUPABASE_URL` + `SUPABASE_SECRET_KEY` | HTTPS → PostgREST | No socket, or you want no direct DB credential in the function |

`DATABASE_BACKEND` selects the transport. An **unknown value stops the process at
boot** with a message naming the accepted values; it never falls back to the
default. The pre-existing stack values `supabase` and `local_pg` are accepted as
aliases for `pg` — both are Postgres over TCP — so an existing `.env` keeps
working.

### What the REST transport can and cannot do

PostgREST executes **one HTTP request as one transaction**, so a sequence of
`begin` / work / `commit` cannot be replayed over it. Transactional units
therefore run as a single server-side RPC:

| Unit | RPC |
|---|---|
| Join | `join_event` |
| Cast vote | `cast_vote` |
| Confirm decision | `confirm_decision` |
| Reopen | `reopen_event` |
| Identity reads | `resolve_caller`, `create_anonymous_user` |

A statement outside this registry throws `REST_UNSUPPORTED_STATEMENT`; a
transactional unit with no RPC throws `REST_TRANSACTION_UNAVAILABLE`. Neither ever
falls back to firing the statements one by one — that would be silently
non-atomic, and the participant cap in `join_event` is a security bound.

**Multi-table aggregate reads are therefore not available over REST.** The
`EVENT_SELECT` in `event-service.ts` uses correlated subqueries and CTEs; it is not
expressible through PostgREST without a view or an RPC per read. If you need the
full surface, deploy a `pg` entry.

See `REST_SETUP.md` for the two prerequisites a PostgREST deployment needs.

### Caller identity on the REST transport

The RPCs read `auth.uid()`, which resolves from the `request.jwt.claims` GUC that
PostgREST populates **from the bearer token**. On the `pg` transport that GUC is
set with `set_config(..., true)` inside the transaction; over HTTP there is no such
call, so the identity must arrive as a JWT.

`rest-fetch.ts` returns `undefined` for the caller JWT today. That is safe rather
than silent: the service key stays the bearer, so the role is `service_role`
(which the RPCs are granted to) and `auth.uid()` is `NULL`, so every
identity-dependent RPC refuses with `NOT_PARTICIPANT`. **The failure mode is
refusal, never an impersonation.** To enable joins and votes on REST, supply a
signed token — see `callerJwtFrom` in that file.

## What does not run on a request-scoped runtime

The realtime bridge (`server/realtime/`) needs a session-level `LISTEN` and a
long-lived WebSocket. No request/response runtime offers that. Every such target
degrades to the 10-second poll (`POLL_INTERVAL_MS`), so votes appear within 10 s
rather than immediately. Only a long-lived process — `server/index.ts`, the
container shape, or `long-lived-fetch.ts` — can host the bridge.

## Host configuration

There is no host configuration in this repository. A runtime that needs a function
directory, a rewrite rule or a binding declaration gets it from the operator, and
that file is not committed here because it belongs to the host, not to this
project. What the API needs from any such configuration is only this:

1. **The entry file**, from the table above.
2. **`DATABASE_URL`** (or `DATABASE_BACKEND=supabase_rest` plus its two variables).
3. **A catch-all route** if the host supports rewrites — `/api/events` must reach
   the handler as `/api/events`. `handleRequest` matches on path segments
   (`server/app.ts:223`), so a rewrite that strips the prefix 404s the whole
   surface.

Verify either way:

```bash
curl -i https://<host>/api/health        # 200 {"ok":true,"db":"up"}
curl -i https://<host>/health            # 200 (same handler)
curl -i -X OPTIONS https://<host>/api/events \
  -H 'Origin: https://app.example'       # 204 with access-control-allow-origin
```

## Verified status

| Convention | Status |
|---|---|
| Node listener (`server/index.ts`) | **verified** — booted, `/health` returns `{"ok":true,"db":"up"}` |
| Every other convention | **verified by unit tests only** — event-shape translation and lifecycle, not a deploy |
| REST transport | **verified against a local PostgREST** — see `REST_SETUP.md` |

A type check is not a deploy. This table says so rather than implying otherwise;
`docs/RUNBOOK.md` §2.2b inherits the same standard.
