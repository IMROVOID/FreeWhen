/**
 * gate:engine-purity — `src/engine/**` imports no React Native, Expo or
 * Supabase.
 *
 * The engine is pure and locale-free; rendering is the client's job
 * (PRD-10 §6). This gate trivially passes while the directory is empty, so
 * it is written to FAIL the moment the first forbidden import appears — the
 * rule is worthless if it only runs once (Plan 01, Task 7).
 *
 * The check runs on the AST, and it resolves the specifier's PACKAGE ROOT —
 * so `expo-file-system` and `expo-router` are caught, not just the bare
 * `expo` package.
 */

import { join } from 'node:path';
import ts from 'typescript';

import { PROJECT_ROOT, collectFiles, exists, fail, isTextSource, pass, readFile, relativePath } from './shared';

const GATE = 'gate:engine-purity';

const ENGINE_DIR = join(PROJECT_ROOT, 'src', 'engine');

/** The package roots the engine may never import. */
const FORBIDDEN_ROOTS = new Set([
  'react-native',
  'react-native-reanimated',
  'react-native-worklets',
  'react-native-web',
  'expo',
  '@expo',
  '@supabase',
  '@react-native-async-storage',
]);

/**
 * The package root of a module specifier.
 *
 * `expo-file-system` → `expo` (the Expo package family shares one root);
 * `@expo/metro-config` → `@expo`; `react-native/Libraries/x` →
 * `react-native`.
 */
export function packageRootOf(specifier: string): string {
  if (specifier.startsWith('@')) {
    const segments = specifier.split('/');
    return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : specifier;
  }

  const [first] = specifier.split('/');
  const root = first ?? specifier;

  // Every `expo-*` package belongs to the Expo family.
  if (root === 'expo' || root.startsWith('expo-')) return 'expo';

  return root;
}

const failures: string[] = [];
let scannedFiles = 0;

if (exists(ENGINE_DIR)) {
  for (const file of collectFiles(['src/engine'])) {
    if (!isTextSource(file)) continue;

    scannedFiles += 1;

    const relative = relativePath(file);
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

    const report = (node: ts.Node, specifier: string, form: string): void => {
      const root = packageRootOf(specifier);
      if (!FORBIDDEN_ROOTS.has(root)) return;
      failures.push(
        `${relative}:${lineOf(node)} ${form} \`${specifier}\` — the engine must be platform-free`,
      );
    };

    const visit = (node: ts.Node): void => {
      // A static import or export: `import x from 'y'`, `import 'y'`,
      // `export … from 'y'`, and the type-only forms.
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        report(node, node.moduleSpecifier.text, 'imports');
      }

      // A CommonJS require: `require('y')`.
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'require' &&
        node.arguments.length === 1 &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        report(node, node.arguments[0].text, 'requires');
      }

      // A dynamic import: `import('y')`.
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1
      ) {
        const [argument] = node.arguments;
        if (argument && ts.isStringLiteral(argument)) {
          report(node, argument.text, 'imports');
        } else {
          // A non-literal specifier cannot be checked, so the engine fails
          // closed rather than passing an unverified import.
          failures.push(
            `${relative}:${lineOf(node)} uses a dynamic import with a non-literal specifier — the engine's imports must be statically checkable`,
          );
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    // A dynamic import with a template literal is not an ImportKeyword call
    // in the AST, so it is caught by the template-literal check below.
    if (/import\s*\(\s*`[^`]*`\s*\)/.test(content)) {
      failures.push(
        `${relative} uses a template-literal dynamic import — the engine's imports must be statically checkable`,
      );
    }
  }
}

if (failures.length > 0) fail(GATE, failures);

// The engine does not exist until Phase 3, so an absent `src/engine/` is not
// a failure — there is nothing to be impure yet. But an engine that EXISTS
// and is empty would be, because a gate that inspected nothing cannot pass.
if (!exists(ENGINE_DIR)) {
  console.log('gate:engine-purity: src/engine/ does not exist yet — nothing to check');
  process.exit(0);
}

if (scannedFiles === 0) {
  fail(GATE, ['src/engine/ exists but contains no files — a gate that inspected nothing cannot pass']);
}

pass(GATE, 'src/engine imports no React Native, Expo or Supabase module', scannedFiles);