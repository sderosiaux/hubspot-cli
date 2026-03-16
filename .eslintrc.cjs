module.exports = {
  extends: ['plugin:@typescript-eslint/recommended'],
  root: true,
  env: {
    browser: false,
    node: true,
    commonjs: true,
    es6: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
  },
  plugins: ['@typescript-eslint', 'import'],
  rules: {
    'no-console': 'off',
    'no-return-await': 'error',
    '@typescript-eslint/no-non-null-assertion': 'off',
    '@typescript-eslint/ban-ts-comment': 'off',
    '@typescript-eslint/no-require-imports': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        caughtErrors: 'none',
      },
    ],
  },

  overrides: [
    {
      // Strict rules for our CRM commands
      files: ['commands/crm/**/*.ts', 'commands/crm.ts'],
      parserOptions: {
        project: './tsconfig.json',
      },
      extends: [
        'plugin:@typescript-eslint/recommended',
        'plugin:@typescript-eslint/recommended-requiring-type-checking',
      ],
      rules: {
        '@typescript-eslint/no-floating-promises': 'error',
        '@typescript-eslint/no-misused-promises': 'error',
        '@typescript-eslint/no-unsafe-assignment': 'warn',
        '@typescript-eslint/no-unsafe-member-access': 'warn',
        '@typescript-eslint/no-unsafe-call': 'warn',
        '@typescript-eslint/no-unsafe-return': 'warn',
        '@typescript-eslint/no-unsafe-argument': 'warn',
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/explicit-function-return-type': [
          'warn',
          { allowExpressions: true },
        ],
        '@typescript-eslint/strict-boolean-expressions': 'off',
        'no-return-await': 'off',
        '@typescript-eslint/return-await': ['error', 'always'],
        'import/no-duplicates': 'error',
        eqeqeq: ['error', 'always'],
        'no-var': 'error',
        'prefer-const': 'error',
      },
    },
    {
      files: ['**/__tests__/**/*.ts', '**/__mocks__/**/*.ts'],
      env: {
        node: true,
      },
    },
    {
      files: ['acceptance-tests/tests/**/*.ts'],
      env: {
        jasmine: true,
        node: true,
      },
    },
  ],
};
