# Running the REST transport (`DATABASE_BACKEND=supabase_rest`)

PostgREST is open-source. This file records the prerequisites a **self-hosted**
PostgREST needs, because two of them fail in ways that read like something else.
A managed PostgREST normally supplies both already.

## 1. `authenticator` must be a member of `service_role`

The error, on the **first** RPC call, is:

```json
{ "code": "42501", "message": "permission denied to set role \"service_role\"" }
```

**Why.** PostgREST connects as `authenticator` and issues `set role <claim.role>`
from the bearer's `role` claim. A role can only switch to a role it is a member of.
`migrations/000_portability.sql:87` grants `anon` and `authenticated`, and `:101`
grants `authenticated` to `service_role` — but nothing grants `service_role` **to**
`authenticator`, because until Plan 40 the server never sent a `service_role`
claim through PostgREST. It connected as a superuser over TCP, where no membership
is needed.

A managed PostgREST ships with this membership already in place, so this is a
**self-hosted** concern — but it is exactly the setup the repo's local stack and
any self-hosted deployment use.

```sql
-- One time, per database. Idempotent.
grant service_role to authenticator;
```

**Why not a migration.** It would be safe to add — it is a grant, not a
credential — and it would make a fresh database work out of the box. It is left as
an operator step because `migrations/` belongs to other phases, and the grant
widens what the PostgREST connection can do on a host the operator may not intend
to expose the server's role to. If you want it automatic, add it to
`migrations/000_portability.sql` beside the other two grants.

## 2. The key must be a **signed JWT**, not an opaque string

The error is `401` with an empty body, on every call.

**Why.** PostgREST verifies the bearer as HS256 against `PGRST_JWT_SECRET` and
derives the role from the `role` claim. A random string is not a token it can
verify, so the request is rejected before SQL runs. A managed PostgREST's service
key *is* a JWT, which is why this is invisible there and bites a self-hosted
deployment immediately.

Both headers must carry it (`server/lib/supabase-rest.ts` sends both):

```
apikey: <jwt>
Authorization: Bearer <jwt>
```

Mint one for local use:

```js
const crypto = require('crypto');
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const head = b64({ alg: 'HS256', typ: 'JWT' });
const body = b64({ role: 'service_role', sub: '00000000-0000-0000-0000-000000000001',
                   is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 3600 });
const sig = crypto.createHmac('sha256', process.env.JWT_SECRET)
  .update(`${head}.${body}`).digest('base64url');
console.log(`${head}.${body}.${sig}`);
```

## 3. The RPC path depends on how PostgREST is mounted

| Mounting | RPC URL | `prefix` option |
|---|---|---|
| Behind a reverse proxy at `/rest/v1` (managed default) | `<url>/rest/v1/rpc/<fn>` | *(default)* |
| Served at the root (the repo's local stack) | `<url>/rpc/<fn>` | `''` |

A wrong prefix is a `404` on every RPC, which reads as "the function does not
exist" rather than "the path is wrong".

## 4. `auth.uid()` is NULL unless the bearer carries `sub`

The RPCs read identity from `auth.uid()`, which resolves from
`request.jwt.claims` — a GUC PostgREST populates **from the bearer token**. There
is no `set_config` over HTTP, so the only way to act as a caller is to send a token
whose `sub` is that caller.

`server/runtime/rest-fetch.ts` does not yet mint one (`callerJwtFrom` returns
`undefined`). The consequence is deliberate:

| Bearer | `auth.uid()` | RPC outcome |
|---|---|---|
| A `service_role` JWT with no `sub` | `NULL` | `NOT_PARTICIPANT` — refused |
| A `service_role` JWT with a caller's `sub` | that caller | allowed, as that caller |

**The failure mode is refusal, never an impersonation.** An unconfigured
deployment loses joins and votes; it cannot write a row as somebody else.

## Verifying the whole path

```bash
# 1. A local PostgREST, with the two grants applied.
npm run db:local:up
docker-compose -f docker-compose.local.yml --profile setup run --rm grant-authenticator
docker exec <postgres-container> psql -U postgres -d freewhen -c 'grant service_role to authenticator;'
docker restart <postgrest-container>

# 2. The composition suite: real routes, through the REST transport, against
#    real Postgres. Skips with a named reason when no PostgREST is reachable.
POSTGREST_SERVICE_KEY="$(node jwt.js "$JWT_SECRET")" npm run test:db -- supabase-backend
```

What that suite proves, and does not:

| Proven | Not proven |
|---|---|
| `GET /health` answers `{"ok":true,"db":"up"}` over REST | A fresh join with a real organizer token |
| `create_anonymous_user` mints a real identity | A vote written end to end (needs a caller `sub`) |
| `resolve_caller` reads it back, `null` for a stranger | A managed PostgREST deployment |
| `join_event` refuses an unknown token with `INVITE_INVALID` | |
| `cast_vote` refuses a claimless caller with `NOT_PARTICIPANT` | |
| An unsupported statement throws instead of being translated | |
