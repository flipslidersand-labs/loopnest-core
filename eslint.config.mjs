import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/build/**', '**/coverage/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // 既存コードに多数あるため warn で段階的に解消する
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Express の Request 型拡張 (declare global namespace) を許可する
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
    },
  },
  // #273: repositories 配下は any 禁止(error)。
  {
    files: ['packages/bizcore-db/src/repositories/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
);
