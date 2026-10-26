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
  // #273: repositories 配下は any 禁止(error)。ただし既存違反のあるファイルは
  // 解消するまで warn に据え置く(新規ファイルは自動で error)。解消したら一覧から外す。
  {
    files: ['packages/bizcore-db/src/repositories/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
  {
    files: [
      'packages/bizcore-db/src/repositories/BaseRepository.ts',
      'packages/bizcore-db/src/repositories/CreditNoteRepository.ts',
      'packages/bizcore-db/src/repositories/CustomerRepository.ts',
      'packages/bizcore-db/src/repositories/DunningRepository.ts',
      'packages/bizcore-db/src/repositories/ExchangeRateRepository.ts',
      'packages/bizcore-db/src/repositories/InstallmentRepository.ts',
      'packages/bizcore-db/src/repositories/InvoiceRepository.ts',
      'packages/bizcore-db/src/repositories/OrganizationRepository.ts',
      'packages/bizcore-db/src/repositories/OutboxRepository.ts',
      'packages/bizcore-db/src/repositories/PaymentRepository.ts',
      'packages/bizcore-db/src/repositories/ProductRepository.ts',
      'packages/bizcore-db/src/repositories/QuoteItemRepository.ts',
      'packages/bizcore-db/src/repositories/QuoteRepository.ts',
      'packages/bizcore-db/src/repositories/QuoteTemplateRepository.ts',
      'packages/bizcore-db/src/repositories/RecurringContractRepository.ts',
      'packages/bizcore-db/src/repositories/TaxRateRepository.ts',
      'packages/bizcore-db/src/repositories/UserRepository.ts',
      'packages/bizcore-db/src/repositories/WebhookDeliveryRepository.ts',
      'packages/bizcore-db/src/repositories/WebhookRepository.ts',
    ],
    rules: { '@typescript-eslint/no-explicit-any': 'warn' },
  },
);
