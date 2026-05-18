# @loopnest/bizcore-db

統合 DB クライアント基盤。Prisma / Kysely / Drizzle ORM / 生SQL を戦略的に使い分け。

## クライアント戦略

| クライアント | 用途 | テーブル |
|---|---|---|
| **Prisma** | マスタテーブル、migration 自動生成 | organizations / users / customers / products |
| **Kysely** | 複雑な JOIN、型安全な SQL | quotes / quote_items / invoices / invoice_items / accounting_exports |
| **Drizzle ORM** | 状態遷移が多い、ORM 的に扱う | approval_requests / approval_steps |
| **生SQL (pg)** | 高速書き込み、ログ系 | audit_logs / request_logs |
| **Redis (ioredis)** | idempotency_keys、キャッシュ | - |

## ディレクトリ構造

```
packages/bizcore-db/
├─ src/
│  ├─ clients/              # DB クライアント初期化
│  │  ├─ prisma-client.ts
│  │  ├─ kysely-client.ts
│  │  ├─ drizzle-client.ts
│  │  ├─ pg-client.ts
│  │  └─ redis-client.ts
│  ├─ repositories/         # (将来) Repository パターン
│  ├─ types/
│  │  └─ kysely-database.ts # Kysely 型定義
│  └─ index.ts              # 統合エントリーポイント
│
├─ prisma/
│  └─ schema.prisma         # Prisma スキーマ（マスタテーブル）
│
├─ drizzle/
│  ├─ schema.ts             # Drizzle スキーマ（approval 系）
│  └─ migrations/           # Drizzle migration ファイル
│
├─ drizzle.config.ts        # Drizzle Kit 設定
├─ tsconfig.json
└─ package.json
```

## セットアップ

```bash
# 依存パッケージインストール
pnpm install

# Prisma client 生成
pnpm prisma:generate

# Drizzle migration 生成
pnpm drizzle:generate

# 型チェック
pnpm type-check
```

## 使用例

### Prisma（マスタテーブル）

```typescript
import { prismaCoreDb } from '@loopnest/bizcore-db';

// Users を取得
const users = await prismaCoreDb.user.findMany();

// Customer を作成
const customer = await prismaCoreDb.customer.create({
  data: {
    name: 'ACME Corp',
    email: 'contact@acme.example',
  },
});
```

### Kysely（複雑な JOIN）

```typescript
import { kyselyDb } from '@loopnest/bizcore-db';

// Quote と Quote Items を取得
const quote = await kyselyDb
  .selectFrom('core.quotes')
  .innerJoin('core.quote_items', 'core.quotes.id', 'core.quote_items.quote_id')
  .where('core.quotes.id', '=', quoteId)
  .selectAll()
  .execute();
```

### Drizzle（状態遷移）

```typescript
import { drizzleDb } from '@loopnest/bizcore-db';
import { eq } from 'drizzle-orm';
import { approvalRequests } from '@loopnest/bizcore-db';

// 承認依頼を取得
const approval = await drizzleDb.query.approvalRequests.findFirst({
  where: eq(approvalRequests.id, approvalId),
  with: {
    steps: true,
  },
});

// ステータス更新
await drizzleDb
  .update(approvalRequests)
  .set({ status: 'approved' })
  .where(eq(approvalRequests.id, approvalId));
```

### 生SQL（高速書き込み）

```typescript
import { pgPool } from '@loopnest/bizcore-db';

// 監査ログ書き込み（高速）
await pgPool.query(
  `INSERT INTO audit.audit_logs (actor_id, action, resource_type, resource_id, metadata, correlation_id)
   VALUES ($1, $2, $3, $4, $5, $6)`,
  [actorId, 'quote_created', 'quote', quoteId, JSON.stringify(metadata), correlationId]
);
```

### Redis（idempotency）

```typescript
import { redis } from '@loopnest/bizcore-db';

// Idempotency チェック
const key = `idempotency:${requestId}`;
const existing = await redis.get(key);
if (existing) {
  return JSON.parse(existing);
}

// 処理後、24h TTL で記録
await redis.setex(key, 86400, JSON.stringify({
  processed_at: new Date().toISOString(),
  result,
}));
```

## 開発フロー

### 新しいテーブルを追加

1. **Prisma**（マスタテーブルの場合）
   ```bash
   # prisma/schema.prisma に model を追加
   pnpm prisma:generate
   pnpm prisma:migrate dev --name add_new_table
   ```

2. **Drizzle**（workflow 系の場合）
   ```bash
   # drizzle/schema.ts に export const を追加
   pnpm drizzle:generate
   pnpm drizzle:migrate
   ```

3. **Kysely**（複雑な JOIN の場合）
   ```bash
   # src/types/kysely-database.ts に interface を追加
   # SQL migration を別途作成
   ```

## ライセンス

MIT
