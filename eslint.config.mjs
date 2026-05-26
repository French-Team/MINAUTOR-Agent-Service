// @ts-check
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // ignores — pas de lint sur les builds, node_modules, ou agents générés
  {
    ignores: ['dist/', 'node_modules/', '.agents/', '*.js', '*.mjs', '*.cjs', '**/*.d.ts'],
  },

  // règles recommandées pour TS (non-type-aware)
  ...tseslint.configs.recommended,

  // nos règles personnalisées + config type-aware
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      // on désactive la règle de base (ne comprend pas les types TS)
      'no-unused-vars': 'off',
      // on utilise la version TS qui comprend les types et les imports
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
)
