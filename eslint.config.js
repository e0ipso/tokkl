import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/', 'node_modules/', 'test-results/', 'data/', 'docs/', '.ai/', '.agents/', '.claude/', 'desktop/'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'max-statements-per-line': ['error', { max: 1 }],
      // Input validation deliberately matches control characters.
      'no-control-regex': 'off',
      'no-restricted-syntax': ['error', { selector: 'SequenceExpression', message: 'Use separate statements.' }],
    },
  },
  {
    // Tests read untyped JSON responses; asserting on them through `any` is the point.
    files: ['**/*.test.ts', '**/test/**/*.ts', 'e2e/**/*.ts', 'bench/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    files: ['packages/web/public/**/*.js'],
    languageOptions: { globals: { ...globals.browser }, sourceType: 'script' },
  },
  {
    files: ['packages/web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
);
