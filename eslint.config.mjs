import js from '@eslint/js';
import noUnsanitized from 'eslint-plugin-no-unsanitized';
import security from 'eslint-plugin-security';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'store/**'] },
  js.configs.recommended,
  noUnsanitized.configs.recommended,
  security.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.serviceworker, ...globals.webextensions },
    },
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      // Too noisy for plain property access on our own objects.
      'security/detect-object-injection': 'off',
    },
  },
  {
    files: ['tests/**', 'eslint.config.mjs'],
    languageOptions: { globals: globals.node },
    rules: {
      // Tests build paths from temp dirs they create themselves.
      'security/detect-non-literal-fs-filename': 'off',
    },
  },
];
