/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: ['./tsconfig.json', './tsconfig.test.json'],
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'prettier',
  ],
  settings: {
    'import/resolver': {
      typescript: {
        project: ['./tsconfig.json', './tsconfig.test.json'],
      },
    },
  },
  rules: {
    // TypeScript strict rules
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/explicit-function-return-type': [
      'error',
      { allowExpressions: true },
    ],
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-non-null-assertion': 'error',
    '@typescript-eslint/strict-boolean-expressions': 'warn', // TODO: Fix and make error
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/await-thenable': 'error',
    '@typescript-eslint/no-misused-promises': 'error',
    '@typescript-eslint/require-await': 'error',

    // Import rules
    'import/order': [
      'error',
      {
        groups: [
          'builtin',
          'external',
          'internal',
          'parent',
          'sibling',
          'index',
        ],
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true },
      },
    ],
    'import/no-duplicates': 'error',
    'import/no-cycle': 'error',
    'import/no-self-import': 'error',

    // General rules
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'prefer-const': 'error',
    'no-var': 'error',
    eqeqeq: ['error', 'always'],
    curly: ['error', 'all'],
  },
  overrides: [
    {
      // Database adapters - I/O boundary with Supabase's untyped responses
      files: ['src/services/*.db.ts'],
      rules: {
        '@typescript-eslint/no-unsafe-assignment': 'off',
      },
    },
    {
      // Entry point and Vercel handler - stub implementations for DI
      files: ['src/index.ts', 'api/index.ts'],
      rules: {
        '@typescript-eslint/require-await': 'off',
        '@typescript-eslint/strict-boolean-expressions': 'off',
      },
    },
    {
      // API routes - Hono service injection uses loose types
      files: ['src/api/routes/*.ts', 'src/api/app.ts', 'src/api/middleware/*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'warn',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/require-await': 'off',
      },
    },
    {
      // Test files - mocking requires flexibility
      files: ['tests/**/*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
        '@typescript-eslint/require-await': 'off',
        '@typescript-eslint/await-thenable': 'off',
        '@typescript-eslint/unbound-method': 'off',
        '@typescript-eslint/strict-boolean-expressions': 'off',
        '@typescript-eslint/no-unused-vars': [
          'warn',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        'no-console': 'off',
      },
    },
    {
      // Enforce boundary: Backend cannot import Frontend
      files: ['src/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/frontend/**'],
                message: 'Backend code cannot import from frontend. Maintain strict separation.'
              }
            ]
          }
        ]
      }
    }
  ],
  ignorePatterns: ['dist', 'node_modules', 'scripts', 'frontend', 'api', '*.js', '*.cjs', '!.eslintrc.cjs'],
};
