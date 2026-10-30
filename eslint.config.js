import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Modules that a SHARED file may not import.
 *
 * `react-native-reanimated` and `expo-blur` are deliberately NOT here: both
 * ship a web build (`react-native-reanimated/lib/module/ReanimatedModule/js-reanimated`
 * and `expo-blur/build/BlurView.web.js`), and the web export proves it.
 *
 * `expo-haptics` IS here, because the platform layer is the only place that
 * may reach for it (Plan 01, Task 10) — the `.native.ts` implementation file
 * is exempt below.
 */
const NATIVE_ONLY_MODULES = [
  '@rnmapbox/maps',
  '@maplibre/maplibre-react-native',
  // Plan 64 - the native map surface. Web uses `mapbox-gl`; reaching this from a
  // shared file would put a native module in the web bundle and kill the export.
  'react-native-maps',
  'expo-notifications',
  'expo-haptics',
];

/**
 * `mapbox-gl` is the mirror image: a DOM library that must never reach a native
 * bundle.
 *
 * It is not in the list above because that list is checked against `*.web.tsx`
 * too (a native module may not be imported there). This one is banned everywhere
 * EXCEPT the web implementation, which is enforced by the override below.
 */
const WEB_ONLY_MODULES = ['mapbox-gl'];

/**
 * The banned-physical-property rule (PRD-11 §7, Style Guide §5).
 *
 * `marginStart`/`paddingStart`/`textAlign: 'start'` mirror automatically;
 * `marginLeft`/`textAlign: 'left'` do not, and each one is an RTL bug that
 * only shows up visually on a Persian-locale device. Lint is far cheaper
 * than finding it in Phase 11.
 *
 * `// rtl-ok: <reason>` on the offending line is the documented escape.
 */
/**
 * The banned-physical-property rule (PRD-11 §7, Style Guide §5), WITH its escape.
 *
 * `marginStart`/`paddingStart`/`textAlign: 'start'` mirror automatically;
 * `marginLeft`/`textAlign: 'left'` do not, and each one is an RTL bug that only shows
 * up visually on a Persian-locale device. Lint is far cheaper than finding it in Phase
 * 11.
 *
 * ★ THE DOCUMENTED `// rtl-ok: <reason>` ESCAPE IS HONOURED HERE.
 *
 * The message always told authors to write it, but `no-restricted-syntax` has no such
 * concept — the escape was prose that no code read. A file that legitimately needs a
 * physical `left` (a window coordinate from `measureInWindow`, an off-canvas parking
 * spot) had no way to say so, and the only options were disabling the rule for the
 * whole file or inventing a logical property that does not mean what the code needs.
 *
 * A comment carrying `rtl-ok` on the offending property's line, or on the line
 * immediately above it, suppresses the report for that property and no other.
 */

const RTL_BANNED_KEYS = new Set([
  'left',
  'right',
  'marginLeft',
  'marginRight',
  'paddingLeft',
  'paddingRight',
  'borderLeftWidth',
  'borderRightWidth',
  'borderLeftColor',
  'borderRightColor',
]);

const RTL_ESCAPE = /\/\/\s*rtl-ok\b/;

const PHYSICAL_MESSAGE =
  'Use logical properties (marginStart/marginEnd/paddingStart/paddingEnd) — physical ones do not mirror in RTL. Add `// rtl-ok: <reason>` to override.';

const TEXT_ALIGN_MESSAGE =
  "Use textAlign: 'start' | 'end' — 'left' | 'right' do not mirror in RTL. Add `// rtl-ok: <reason>` to override.";

const rtlPhysicalPropertyRule = {
  meta: {
    type: 'problem',
    docs: { description: 'Bans physical left/right layout properties in favour of logical ones.' },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    /** Whether the property, or the line above it, carries the escape. */
    const escaped = (node) => {
      const line = node.loc.start.line;
      const lines = sourceCode.getLines();

      // The property's own line covers a trailing comment and a single-line object; the
      // line above covers the usual "explain, then the value" shape.
      return [lines[line - 1] ?? '', lines[line - 2] ?? ''].some((text) => RTL_ESCAPE.test(text));
    };

    return {
      Property(node) {
        const key = node.key;
        const name = key && key.type === 'Identifier' ? key.name : null;
        if (!name) return;

        if (RTL_BANNED_KEYS.has(name)) {
          if (escaped(node)) return;
          context.report({ node, message: PHYSICAL_MESSAGE });
          return;
        }

        if (
          name === 'textAlign' &&
          node.value?.type === 'Literal' &&
          (node.value.value === 'left' || node.value.value === 'right')
        ) {
          if (escaped(node)) return;
          context.report({ node, message: TEXT_ALIGN_MESSAGE });
        }
      },
    };
  },
};

/** The engine is pure: no React Native, no Expo, no Supabase (PRD-10 §6). */
const enginePurityRule = {
  'no-restricted-imports': [
    'error',
    {
      paths: [
        { name: 'react-native', message: 'src/engine/ must be pure — no React Native import.' },
        { name: 'react-native-reanimated', message: 'src/engine/ must be pure — no Reanimated import.' },
        { name: 'expo-font', message: 'src/engine/ must be pure — no Expo import.' },
        { name: 'expo-haptics', message: 'src/engine/ must be pure — no Expo import.' },
        { name: 'expo-blur', message: 'src/engine/ must be pure — no Expo import.' },
        { name: '@supabase/supabase-js', message: 'src/engine/ must be pure — no Supabase import.' },
      ],
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      // Generated deploy artifacts: `api/` is the bundled serverless function
      // and `static/` is the composed single-root tree. Both are gitignored but
      // were still being linted, so a local `npm run lint` failed on
      // minified bundles rather than on source.
      'api/**',
      'static/**',
      '.expo/**',
      'android/**',
      'ios/**',
      'coverage/**',
      // Headless-browser verification artefacts: screenshots, DOM dumps and
      // small page-probe scripts, all gitignored. The probes are evaluated
      // inside a browser and use `document` and DOM events by definition.
      '.verify/**',
      'scripts/docs/**',
      // Agent tooling that ships with the workspace, not the app.
      '.agents/**',
      '.claude/**',
      '.mimocode/**',
      // Per-agent git worktrees are full copies of this repo. Linting them
      // reports every file twice and drowns the real output.
      '.worktrees/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // A `require` is legitimate for a Metro asset reference and for a
      // lazily-loaded native module. Both are marked with an explanatory
      // comment, so the rule is a warning rather than an error.
      '@typescript-eslint/no-require-imports': 'warn',
    },
  },
  {
    // The font assets are Metro asset references, and the language store
    // lazily loads a native module. Neither is a module import in the
    // TypeScript sense.
    files: ['src/theme/font-assets.ts', 'src/i18n/store.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // The banned-physical-property rule, scoped to app/** and src/** only, with the
    // documented `// rtl-ok:` escape honoured.
    files: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
    plugins: { rtl: { rules: { 'physical-only-when-stated': rtlPhysicalPropertyRule } } },
    rules: { 'rtl/physical-only-when-stated': 'error' },
  },
  {
    // Logging discipline: only src/lib/redact.ts may write to the console.
    files: ['**/*.{ts,tsx}'],
    ignores: ['src/lib/redact.ts', 'scripts/**', 'tests/**'],
    rules: {
      'no-console': [
        'error',
        { allow: ['warn', 'error'] },
      ],
    },
  },
  {
    files: ['src/engine/**/*.{ts,tsx}'],
    rules: enginePurityRule,
  },
  {
    // Native-only modules may only be imported from their platform-suffixed
    // implementation files (plan-18 Task 2). A shared import reaches the web
    // bundle and kills the export at import time, not at call time.
    files: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
    ignores: [
      'src/platform/*.native.ts',
      'src/platform/*.web.ts',
      'src/map/**',
      // Plan 64 - the map surfaces are the only files that may import a map
      // library. Everything else imports the bare `InteractiveMap` specifier.
      'src/components/ui/InteractiveMap.native.tsx',
      'src/components/ui/InteractiveMap.web.tsx',
      'src/theme/useMotion.ts',
      'src/theme/useMotion.web.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: NATIVE_ONLY_MODULES.map((name) => ({
            name,
            message: `${name} is native-only. Import it from a *.native.ts implementation and expose a shared interface, or the web export fails at import time.`,
          })),
        },
      ],
    },
  },
  {
    // The web implementation files may not import native modules either.
    files: ['**/*.web.ts', '**/*.web.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: NATIVE_ONLY_MODULES.map((name) => ({
            name,
            message: `${name} cannot be imported on web.`,
          })),
          // The mirror of the rule above: a DOM library in a native bundle fails
          // at import time on a device, not at call time.
          patterns: WEB_ONLY_MODULES.map((name) => ({
            group: [`${name}`, `${name}/*`],
            message: `${name} is a browser library. Only *.web.tsx may import it.`,
          })),
        },
      ],
    },
  },
  {
    // The web map implementation is the one place `mapbox-gl` belongs.
    files: ['src/components/ui/InteractiveMap.web.tsx'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['scripts/**/*.{ts,tsx,mjs}'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // A `.mjs` build script has no TypeScript block above to declare its Node
    // globals, so `console` reads as undefined. Declaring them here rather than
    // ignoring the directory keeps every real error in `scripts/` reportable.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
      },
    },
  },
  {
    // ★ THE CI WORKFLOW AIRLOCK.
    //
    // `.github/**` is not TypeScript, so it never receives the `no-undef: off`
    // the TS block above applies — and the one plain-JS file there legitimately
    // reads `process.stdin`. Declaring the Node globals is the correct fix;
    // adding `.github/` to `ignores` would silence every real error in it too,
    // and `.github/` is already outside every release gate's scan set.
    files: ['.github/**/*.{js,cjs,mjs}'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        require: 'readonly',
        module: 'writable',
        __dirname: 'readonly',
      },
    },
  },
  {
    // ★ THE METRO BUILD CONFIG.
    //
    // `babel.config.js` is CommonJS by definition — Metro `require`s it — so it
    // has no TypeScript block above to declare its Node globals and `module`
    // reads as undefined. Declaring them here rather than ignoring the file
    // keeps a real error in the transform reportable.
    files: ['babel.config.js'],
    languageOptions: {
      globals: {
        module: 'writable',
        require: 'readonly',
      },
    },
  },
);
