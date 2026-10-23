/**
 * The `fetch` entry for a runtime without `process.env` (Plan 40 T5).
 *
 * ★ THE CONVENTION, NOT THE HOST.
 *
 * Some edge runtimes implement web-standard `Request`/`Response` — so they need
 * nothing from `http-normalise.ts` — but expose configuration through their own
 * global rather than through `process.env`. The routes in this repo read
 * `process.env` directly (`server/lib/http.ts:117`, `server/lib/supabase.ts:32`),
 * so such a runtime needs two things: a `process.env` facade, and the entry that
 * installs it.
 *
 * ★ THE FACADE IS INSTALLED BEFORE THE CORE IS LOADED.
 *
 * A top-level `import` is hoisted and evaluated before any statement in this
 * module, so importing the driver statically would read `process.env` while
 * `process` is still undefined. The only correct fix is a dynamic `await import()`
 * inside `fetch`, after the facade exists — which is why this file has no
 * top-level import of the core.
 *
 * ★ WHY A FACADE AND NOT RUNTIME-SPECIFIC CODE PATHS.
 *
 * The alternative is threading an `env` object through every route, which is the
 * large risky diff the whole port exists to avoid. A minimal `process.env` facade
 * is a few lines and leaves `server/` identical on every runtime.
 *
 * ★ SOCKETS ARE AVAILABLE, BUT THE BRIDGE IS NOT.
 *
 * A socket-capable edge runtime can open a TCP connection to Postgres, so the
 * `pg` transport works here — a per-request client. It cannot host
 * `server/realtime/`, which needs a session-level `LISTEN` and a WebSocket
 * server; the decision screen polls every 10 s instead.
 *
 * ★ NO RUNTIME TYPE PACKAGE.
 *
 * The global is declared structurally so `npm run typecheck` (which uses the
 * repo's `tsconfig.json`, with no edge-runtime types present) stays clean. Adding
 * the types package would put that runtime's globals into every other file's
 * scope and change what `typecheck` means for the app.
 */

/** The shape of the runtime's environment accessor. */
interface RuntimeEnv {
  get(key: string): string | undefined;
  toObject(): Record<string, string>;
}

/**
 * A `process`-like facade on the global object.
 *
 * Declared here because TypeScript's lib does not include one for this target,
 * and the runtime's own type package is deliberately not installed.
 */
declare const globalThis: {
  process?: { env: Record<string, string> };
};

/**
 * The runtime's environment accessor, when this adapter is running on it.
 *
 * Read off the global by property name rather than by identifier so no static
 * type package is implied and no other target's build has to know the name.
 */
function runtimeEnv(): RuntimeEnv | undefined {
  const candidate = (globalThis as Record<string, unknown>)[RUNTIME_GLOBAL_NAME];

  if (typeof candidate !== 'object' || candidate === null) return undefined;

  const env = (candidate as { env?: unknown }).env;
  if (typeof env !== 'object' || env === null) return undefined;

  const accessor = env as Partial<RuntimeEnv>;
  if (typeof accessor.toObject !== 'function') return undefined;

  return accessor as RuntimeEnv;
}

/**
 * The global this adapter looks for.
 *
 * A single constant so the file reads as one decision rather than a name spelled
 * throughout. Any runtime exposing an `env.toObject()` accessor under its own
 * global works with this entry; set the name here to match.
 */
const RUNTIME_GLOBAL_NAME = 'Deno';

/**
 * Installs a `process.env` facade onto the global object.
 *
 * Idempotent: a second call refreshes rather than replacing, so a redeploy of the
 * isolate cannot swap an env a request is mid-way through reading.
 *
 * ★ THE FACADE IS A PLAIN OBJECT, NOT A LIVE PROXY.
 *
 * `bindEnvironment` DELETES absent keys, and a delete through a proxy into a
 * read-only environment would throw mid-request.
 */
function installProcessShim(): void {
  const source = runtimeEnv();
  if (!source) return;

  const target = globalThis as { process?: { env: Record<string, string> } };

  if (target.process?.env) {
    // Already installed: refresh so a changed environment (a platform-side
    // variable rotation) is observed by the next request.
    for (const [key, value] of Object.entries(source.toObject())) {
      target.process.env[key] = value;
    }
    return;
  }

  target.process = { env: { ...source.toObject() } };
}

export default {
  async fetch(request: Request): Promise<Response> {
    installProcessShim();

    // ★ Dynamic, after the shim. A static import would be hoisted above it and
    // `process` would be undefined when the driver first reads it.
    const { bindEnvironment, defaultClientFactory, runWithClient } = await import('./driver');

    bindEnvironment(undefined);

    const connectionString = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
    if (!connectionString) {
      return Response.json(
        { error: 'misconfigured', detail: 'DATABASE_URL is not set' },
        { status: 500 },
      );
    }

    return runWithClient(connectionString, defaultClientFactory, request);
  },
};
