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
 * ★ `server/runtime/web-fetch.ts` IS THE ENTRY, UNCHANGED.
 *
 * It already implements `default (request: Request) => Promise<Response>`,
 * which is Vercel's convention. Nothing host-specific is added here.
 */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';

mkdirSync('api', { recursive: true });

await build({
  entryPoints: ['server/runtime/web-fetch.ts'],
  outfile: 'api/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['pg-native'],
  // ★ THE DEFAULT EXPORT MUST BECOME `module.exports`.
  //
  // `web-fetch.ts` uses `export default handler`. esbuild's CJS output would put
  // that on `exports.default`, but a Vercel Node function is the MODULE ITSELF —
  // it calls `module.exports` as the handler. Without this footer the built file
  // exports `{ default: [Function] }`, Vercel calls an object, and the request
  // hangs with nothing in the log.
  footer: {
    js: 'module.exports = module.exports.default ?? module.exports;',
  },
  logLevel: 'info',
});

console.log('api/index.js written');
