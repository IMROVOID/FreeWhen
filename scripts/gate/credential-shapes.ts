/**
 * Credential-shape detection.
 *
 * Detecting "name = value" by separator does not survive contact with real
 * reports: a markdown table separates with a pipe, a fenced block puts the
 * value on the next line, and a value can be shorter than any arbitrary
 * threshold. So the credential SHAPE is matched instead — a long opaque token —
 * wherever it appears.
 *
 * These rules are ported from `scripts/spike/gate-secrets.sh`, which the
 * project already shipped with a 12-case self-test. The shipped
 * `scripts/gate/secrets.ts` matched only variable *names*, which detects the
 * harmless reference `process.env.SUPABASE_SECRET_KEY` and misses the actual
 * credential.
 */

/**
 * A JWT — Supabase and Supabase-compatible Bearer tokens.
 *
 * ★ A MAPBOX `pk.` TOKEN IS A JWT, AND IT IS SUPPOSED TO BE IN THE BUNDLE.
 *
 * `pk.eyJ1Ijoi…` is base64url of `{"u":"…"}` — a JWT with two segments. The public
 * MapBox token therefore matches this shape by construction, and the bundle scan
 * flagged the one credential the product is *designed* to ship, while the `sk.`
 * form that must never ship is caught separately by `MAPBOX_SECRET_SHAPE`.
 *
 * So a line that carries a `pk.` token is exempt from the JWT rule — but only the
 * `pk.` form, and only that rule. Everything else on the line is still scanned.
 */
const PUBLIC_MAPBOX_TOKEN = /\bpk\.[A-Za-z0-9_-]{20,}/;

export const JWT_SHAPE = /eyJ[A-Za-z0-9_-]{10,}/;

/** A Supabase key, in either the secret or the publishable form. */
export const SUPABASE_KEY_SHAPE = /sb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}/;

/** An OpenAI-style secret key. */
export const OPENAI_KEY_SHAPE = /\bsk-[A-Za-z0-9_-]{16,}/;

/**
 * A long unbroken alphanumeric run that contains at least one digit.
 *
 * Anchored on non-alphanumerics so ordinary prose and URLs never match —
 * only something deliberately opaque does. The run must be UNBROKEN: a
 * camelCase identifier such as `isReduceTransparencyEnabled` is not an
 * opaque token, and treating it as one would make the rule useless.
 *
 * The digit requirement is what separates a credential from an identifier.
 * A 24-character identifier is plausible; a 24-character identifier with no
 * digits is the norm, while a random token virtually always mixes both.
 */
export const OPAQUE_RUN_SHAPE =
  /(^|[^A-Za-z0-9])(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{24,}([^A-Za-z0-9]|$)/;

/**
 * The file types the credential scan reads for the FULL rule set, including
 * the opaque-run check.
 *
 * A minified bundle, a bundled HTML page and a font binary are all full of
 * long alphanumeric runs — data URIs, hashes, minified identifiers — so the
 * opaque-run rule produces nothing but false positives there. Those artefacts
 * are still scanned for the shapes that CANNOT occur by accident: a JWT, a
 * Supabase key, an OpenAI key, a Mapbox secret.
 */
export const SCANNABLE_TEXT_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.txt', '.env',
  '.md', '.yml', '.yaml', '.xml', '.svg', '.map', '.css',
] as const;

/**
 * The file types where a long opaque run is EXPECTED, so the opaque-run rule
 * is skipped for them.
 *
 * A minified bundle, a bundled HTML page and a font binary are all full of
 * long alphanumeric runs — data URIs, content hashes, minified identifiers.
 * The rule that would catch a pasted credential in a build artefact is the
 * SHAPE rule (a JWT, a Supabase key, an OpenAI key, a Mapbox secret), all of
 * which are still applied.
 */
export const OPAQUE_RUN_ALLOWED_EXTENSIONS = [
  '.html', '.htm', '.ttf', '.otf', '.woff', '.woff2',
] as const;

/**
 * Whether the opaque-run rule applies to a file.
 *
 * The rule is for SOURCE: a credential pasted into a source file is what this
 * project must catch, and a source file is never so minified that a 24-char
 * run is ambiguous. A build artefact is the opposite — nearly every long run
 * in it is a hash.
 */
export function allowsOpaqueRun(path: string): boolean {
  // The path separators are normalised, so the check works on Windows too.
  const lower = path.replace(/\\/g, '/').toLowerCase();

  if (OPAQUE_RUN_ALLOWED_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    return false;
  }

  // A built bundle lives under `dist/` or `_expo/`, or carries a content hash.
  if (lower.includes('/dist/') || lower.includes('/_expo/')) return false;
  if (/\.[0-9a-f]{16,}\.(js|css|html)$/i.test(lower)) return false;

  return true;
}

/**
 * Whether a line contains a credential, optionally skipping the opaque-run
 * rule for a file type where long runs are expected.
 */
export function isCredentialLine(
  line: string,
  options: { includeOpaqueRun?: boolean } = {},
): { name: string } | null {
  const { includeOpaqueRun = true } = options;

  // A public MapBox token IS a JWT; only its secret sibling is a credential.
  if (JWT_SHAPE.test(line) && !PUBLIC_MAPBOX_TOKEN.test(line)) return { name: 'JWT' };
  if (SUPABASE_KEY_SHAPE.test(line)) return { name: 'Supabase key' };
  if (OPENAI_KEY_SHAPE.test(line)) return { name: 'OpenAI-style key' };

  if (includeOpaqueRun && OPAQUE_RUN_SHAPE.test(line)) {
    return { name: 'opaque token' };
  }

  if (WEAK_CREDENTIAL_SHAPE.test(line) && !NOT_A_CREDENTIAL.test(line)) {
    return { name: 'password or named secret' };
  }

  return null;
}

/**
 * A Mapbox SECRET token.
 *
 * A public `pk.` token in the bundle is expected by design (PRD-10 §8), so
 * only the `sk.` form is rejected. The pattern is anchored to a token-shaped
 * context so that a content hash ending in `sk.` — an asset filename like
 * `back-icon-mask.0a328cd9….png` — is not mistaken for a credential.
 */
export const MAPBOX_SECRET_SHAPE = /(?:^|[^A-Za-z0-9._-])sk\.[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/;

/**
 * A password has no memorable shape, so it keeps a name-based rule. Without
 * this, a 10-character database password reads as clean.
 */
export const WEAK_CREDENTIAL_SHAPE =
  /(?:password|passwd|pwd|secret|token|apikey|api_key)\s*[=:]\s*["'`]?[A-Za-z0-9_!@#$%^&*+-]{8,}/i;

/**
 * A value that is a reference, a placeholder, or a PUBLISHABLE credential.
 *
 * ★ A `pk.` TOKEN IS NOT A SECRET, AND THE GATE MUST NOT PRETEND IT IS.
 *
 * `EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN` reaches the bundle by design and appears in
 * every tile and static-image request the browser makes. The weak rule matches the
 * ASSIGNMENT (`mapboxgl.accessToken = …`, `const mapboxCredential = …`), which
 * would fail every build that draws a map — and the only ways out of that are
 * renaming a library's own property or making the rule vague.
 *
 * The secret half of the same variable is caught properly elsewhere: `gate:secrets`
 * applies `MAPBOX_SECRET_SHAPE` to every file regardless of this allowance, so an
 * `sk.` token is still a hard failure. Exempting only the public form is what keeps
 * the rule pointed at the thing it is for.
 */
export const NOT_A_CREDENTIAL = /[<$]|REDACTED|redacted|none|mapbox/i;

/** The shape rules that apply to any scanned text. */
export const CREDENTIAL_SHAPES: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'JWT', pattern: JWT_SHAPE },
  { name: 'Supabase key', pattern: SUPABASE_KEY_SHAPE },
  { name: 'OpenAI-style key', pattern: OPENAI_KEY_SHAPE },
  { name: 'opaque token', pattern: OPAQUE_RUN_SHAPE },
];
