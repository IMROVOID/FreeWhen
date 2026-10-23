/**
 * Compatibility surface for `server/runtime/binding-fetch.ts`.
 *
 * ★ THIS FILE EXISTS SO PLAN 40'S PROOF-OF-PORT TESTS STAY UNMODIFIED.
 *
 * Two tests pin the binding-object path and are the contract that the shared-core
 * extraction changed nothing:
 *
 *  - `tests/server/worker-entry.test.ts` — the lifecycle (AC-40.2 requires it
 *    unmodified)
 *  - `tests/db/worker-route.test.ts` — a real route through the adapter against a
 *    real database
 *
 * Both name their binding `HYPERDRIVE`, which was the vendor's own name. The
 * adapter now takes a neutral `DB` binding so it describes the convention rather
 * than the host. Mapping the old name here keeps both tests byte-identical, which
 * is exactly what makes them evidence.
 *
 * ★ THE MAPPING IS IN THIS FILE, NOT IN THE ADAPTER.
 *
 * The adapter must not know a legacy name, or every future reader would think the
 * binding is really called `HYPERDRIVE`. New code imports
 * `server/runtime/binding-fetch` directly; nothing in `server/` imports this file.
 */

import {
  createBindingFetchHandler,
  type ClientFactory,
  type Env as BindingEnv,
} from './runtime/binding-fetch';

export type { ClientFactory };

/**
 * The binding shape the legacy name implies.
 *
 * Structurally a `DB` binding under an older key, so a caller written against
 * either name type-checks.
 */
export type Env = Omit<BindingEnv, 'DB'> & {
  DB?: { connectionString: string };
  /** The former binding name. Accepted and mapped onto `DB`. */
  HYPERDRIVE?: { connectionString: string };
};

/**
 * The handler, accepting either binding name.
 *
 * `createWorkerHandler()` keeps its historical name so the two tests above import
 * the same symbol they always did.
 */
export function createWorkerHandler(options: { createClient?: ClientFactory } = {}) {
  const handler = createBindingFetchHandler(options);

  return async function fetch(request: Request, env: Env): Promise<Response> {
    const connectionString = env.DB?.connectionString ?? env.HYPERDRIVE?.connectionString;

    if (!connectionString) {
      // Same answer the adapter gives for a missing `DB` binding: a deployment
      // error, reported rather than thrown.
      return Response.json(
        { error: 'misconfigured', detail: 'DB binding is missing' },
        { status: 500 },
      );
    }

    return handler(request, { ...env, DB: { connectionString } } as BindingEnv);
  };
}

export default {
  fetch: createWorkerHandler(),
};
