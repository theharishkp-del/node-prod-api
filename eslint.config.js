'use strict';

/** @file ESLint flat config: recommended rules for CommonJS on Node. */
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'logs/**', 'coverage/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_|^next$|^req$|^res$' }],
      'no-console': 'warn',
      eqeqeq: ['error', 'always'],
      strict: ['error', 'global'],
    },
  },
];
