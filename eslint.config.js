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
  'expo-notifications',
  'expo-haptics',
];

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
const rtlBannedPropertyRule = {
  'no-restricted-syntax': [
    'error',
    {
      selector:
        'ObjectExpression > Property[key.name=/^(left|right|marginLeft|marginRight|paddingLeft|paddingRight|borderLeftWidth|borderRightWidth|borderLeftColor|borderRightColor)$/]',
      message:
        'Use logical properties (marginStart/marginEnd/paddingStart/paddingEnd) — physical ones do not mirror in RTL. Add `// rtl-ok: <reason>` to override.',
    },
    {
      selector:
        "Property[key.name='textAlign'][value.value=/^(left|right)$/]",
      message:
        "Use textAlign: 'start' | 'end' — 'left' | 'right' do not mirror in RTL. Add `// rtl-ok: <reason>` to override.",
    },
  ],
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
      '.expo/**',
      'android/**',
      'ios/**',
      'coverage/**',
      'scripts/docs/**',
      // Agent tooling that ships with the workspace, not the app.
      '.agents/**',
      '.claude/**',
      '.mimocode/**',
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
    // The banned-physical-property rule, scoped to app/** and src/** only.
    files: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
    rules: rtlBannedPropertyRule,
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
        },
      ],
    },
  },
  {
    files: ['scripts/**/*.{ts,tsx}'],
    rules: {
      'no-console': 'off',
    },
  },
);
