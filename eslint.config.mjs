// @ts-check
import tseslint from 'typescript-eslint'

import noShallowObjectSpread from './eslint-rules/no-shallow-object-spread.mjs'
import noUselessCatch from './eslint-rules/no-useless-catch.mjs'
import noUnusedExpressions from './eslint-rules/no-unused-expressions.mjs'

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
        projectService: {
          allowDefaultProject: ['eslint-rules/*.mjs'],
        },
      },
    },
    plugins: {
      'local': {
        rules: {
          'no-shallow-object-spread': noShallowObjectSpread,
          'no-useless-catch': noUselessCatch,
          'no-unused-expressions': noUnusedExpressions,
        },
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
      // règle personnalisée : détecte les spreads de constantes avec objets/tableaux imbriqués
      'local/no-shallow-object-spread': 'error',
      'local/no-useless-catch': 'error',
      'local/no-unused-expressions': 'error',
    },
  },
)
