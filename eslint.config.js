import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
export default [
  {
    ignores: [
      'node_modules/**',
      '.svelte-kit/**',
      '.wrangler/**',
      'build/**',
      'dist/**',
      'test-results/**',
      'playwright-report/**',
      'worker-configuration.d.ts',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    files: ['**/*.svelte'],
    languageOptions: { parserOptions: { parser: ts.parser } },
  },
  {
    files: ['worker/domain/**/*.ts', 'worker/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['cloudflare:*', '**/adapters/**', '@sveltejs/*'] },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Use the injected Clock.',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Use the injected Clock.',
        },
      ],
    },
  },
  prettier,
];
