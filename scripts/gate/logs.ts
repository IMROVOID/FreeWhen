/**
 * gate:logs — all logging passes through the redaction module.
 *
 * A log line is a data leak with a timestamp (PRD-13 §7, PRD-08 §15).
 *
 * The rule is enforced on the AST rather than with line regexes, because a
 * line regex cannot see a payload spread over several lines — which is the
 * most natural formatting for exactly the payload this gate warns about:
 *
 *     logSafe('event', {
 *       lat: 35.7,
 *     });
 *
 * Two things are rejected outright:
 *
 *   1. any `console.*` call outside the redaction module, and
 *   2. any sensitive key passed to a logger.
 */

import { join } from 'node:path';
import ts from 'typescript';

import { PROJECT_ROOT, collectFiles, fail, isTextSource, pass, readFile, relativePath } from './shared';

const GATE = 'gate:logs';

const REDACT_MODULE = 'src/lib/redact.ts';

/**
 * The keys that must never be passed to a logger.
 *
 * These are the same fragments the redaction module treats as sensitive, so
 * the gate and the module agree on what "sensitive" means.
 */
const SENSITIVE_KEYS = new Set([
  'lat',
  'lng',
  'lon',
  'latitude',
  'longitude',
  'coord',
  'coords',
  'coordinate',
  'startpoint',
  'accuracy',
  'accuracym',
  'token',
  'invitetoken',
  'invitetokenhash',
  'secret',
  'password',
  'passwd',
  'apikey',
  'authheader',
  'authorization',
  'bearer',
  'credential',
  'phone',
  'text',
  'message',
  'body',
  'content',
  'note',
  'snippet',
  'caption',
  'comment',
  'displayname',
  'fullname',
]);

/** The logger functions whose payload is inspected. */
const LOGGER_NAMES = new Set(['logSafe', 'log', 'logger', 'logEvent', 'track', 'capture']);

function normalise(key: string): string {
  return key.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(normalise(key));
}

/** The `console` member being called, if the expression is a console call. */
function consoleMethod(node: ts.Node): string | null {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    return null;
  }
  const target = node.expression.expression;
  if (!ts.isIdentifier(target) || target.text !== 'console') return null;
  return node.expression.name.text;
}

/** The name of a called function, if the expression is a plain call. */
function calledName(node: ts.Node): string | null {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return null;
  return node.expression.text;
}

/**
 * Collects the object-literal keys passed to a logging call, across however
 * many lines the literal spans.
 *
 * A key is reported once, even when the literal is nested.
 */
function collectPayloadKeys(argument: ts.Expression | undefined): string[] {
  if (!argument) return [];

  const keys = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
      keys.add(node.name.text);
    } else if (ts.isShorthandPropertyAssignment(node)) {
      keys.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };

  visit(argument);
  return [...keys];
}

const failures: string[] = [];
let scannedFiles = 0;

for (const file of collectFiles(['src', 'app'])) {
  if (!isTextSource(file)) continue;

  const relative = relativePath(file);
  if (relative === REDACT_MODULE) continue;

  scannedFiles += 1;

  const content = readFile(file);
  const sourceFile = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const lineOf = (node: ts.Node): number =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  const visit = (node: ts.Node): void => {
    // 1. Any console call outside the redaction module.
    const method = consoleMethod(node);
    if (method) {
      failures.push(
        `${relative}:${lineOf(node)} calls \`console.${method}\` — use \`logSafe()\` from ${REDACT_MODULE}`,
      );
    }

    // 2. A sensitive key passed to a logger.
    const called = calledName(node);
    if (called && LOGGER_NAMES.has(called) && ts.isCallExpression(node)) {
      // Every argument is inspected, not just the first: `logSafe` takes the
      // event name first and the payload second, and the payload is the part
      // that can carry a coordinate.
      for (const argument of node.arguments) {
        for (const key of collectPayloadKeys(argument)) {
          if (isSensitiveKey(key)) {
            failures.push(
              `${relative}:${lineOf(node)} passes the sensitive key \`${key}\` to \`${called}()\` — \`logSafe()\` redacts, but do not rely on it`,
            );
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
}

// The redaction module must exist and export the single entry point.
const redactPath = join(PROJECT_ROOT, REDACT_MODULE);
try {
  const redactContent = readFile(redactPath);
  if (!/export function logSafe/.test(redactContent)) {
    failures.push(`${REDACT_MODULE} does not export \`logSafe\``);
  }
} catch {
  failures.push(`${REDACT_MODULE} is missing — there is no logging path`);
}

if (failures.length > 0) fail(GATE, failures);

pass(GATE, 'all logging passes through src/lib/redact.ts', scannedFiles);
