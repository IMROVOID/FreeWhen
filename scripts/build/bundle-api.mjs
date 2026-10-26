/**
 * Bundles the API into a single Vercel function.
 *
 * ★ WHY A BUNDLE AND NOT `api/index.ts` PLUS THE WHOLE SERVER TREE.
 *
 * Vercel installs a function's dependencies from a `package.json` inside the
 * function directory. The first attempt did exactly that and shipped a function
 * that hung on its first request: the build restored a cache, printed
 * "Installing dependencies... up to date in 456ms", installed nothing, and the
 * missing module surfaced as a timeout with no error in the log.
 *
 * So everything is inlined into one file. `pg` is pure JavaScript, and only its
 * optional native binding (`pg-native`) stays out.
 *
 * ★ COMMONJS, NOT ESM.
 *
 * Bundling `pg` into ESM produced `Dynamic require of "events" is not
 * supported` — `pg` is CommonJS and its internal `require` calls cannot survive
 * an ESM wrapper. esbuild's CJS output keeps them working, and the Vercel Node
 * runtime loads a CommonJS function natively.
 *
 * ★ `server/runtime/fetch-entry.ts` IS THE ENTRY, NOT `web-fetch.ts`.
 *
 * `web-fetch.ts` exports a default handler, and Vercel's Node runtime reads a
 * default export as `(req, res) => void` — it DISCARDS the returned `Response`.
 * The function ran, its result went nowhere, and every request hung until the
 * 30 s timeout. Its own warning names the fix: export a `fetch` function.
 * `fetch-entry.ts` is three lines that do exactly that and delegate to the
 * unchanged adapter.
 */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';

mkdirSync('api', { recursive: true });

await build({
  entryPoints: ['server/runtime/fetch-entry.ts'],
  outfile: 'api/index.js',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  external: ['pg-native'],
  // ★ THE `fetch` EXPORT MUST SURVIVE AS A NAMED PROPERTY.
  //
  // esbuild's CJS output already puts `fetch` on `exports`, and Vercel's Node
  // runtime looks for exactly that name. Nothing needs moving — an earlier
  // version reassigned `module.exports` to the default export, which would
  // remove `fetch` now that the entry exports one.
  logLevel: 'info',
});

console.log('api/index.js written');
