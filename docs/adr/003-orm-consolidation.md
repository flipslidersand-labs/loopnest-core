# ADR-003: ORM Consolidation — Kysely as Target State

**Status**: Accepted  
**Date**: 2026-09-06  
**Issue**: #32

## Context

The codebase concurrently uses four database access layers, each introduced incrementally as the feature surface grew:

| Layer | Package | Tables / Operations |
|-------|---------|---------------------|
| **Prisma** | `@prisma/client` | Master data: `organizations`, `users`, `customers`, `products`, `quote_requests`, `quotes`, `quote_items`, `quote_templates`, `recurring_contracts` |
| **Kysely** | `kysely` | Finance: `invoices`, `payments`, `credit_notes`, `installments`, `dunning`, `webhooks`, `exchange_rates`; also `outbox_events` (claimPending, markProcessed, markFailed) |
| **Drizzle** | `drizzle-orm` | Workflow state machines: `approval_requests`, `approval_steps`; legacy schema mirror for `outbox_events` and `invoices` (unused at runtime) |
| **Raw `pg`** | `pg` | High-throughput append-only tables: `audit.request_logs`; read-side queries in `SearchService`, `ReportingService`; overdue/dunning scans in `EventWorker` |

Each layer introduces its own:

- Error type hierarchy (`PrismaClientKnownRequestError` vs Kysely `NoResultError` vs Drizzle `DrizzleError` vs `pg.DatabaseError`)
- Transaction semantics (`$transaction` vs `db.transaction().execute()` vs Drizzle transactions vs `pg.PoolClient`)
- Schema definition mechanism (Prisma DSL, Kysely interface types, Drizzle `pgTable`, raw SQL migrations)
- Type generation pipeline (Prisma generate, Drizzle Kit, no-op for Kysely/pg)

The result is four error-handling paths, two schema-definition formats, and cognitive overhead whenever a developer adds a cross-boundary operation.

## Decision

**Consolidate to Kysely as the single query layer.** Prisma is retained short-term for its migration tooling and master-data convenience, but all new repositories must use Kysely.

### Why Kysely

1. **Already the dominant layer** — all finance repositories (invoices, payments, credit_notes, etc.) are Kysely. New features default to it.
2. **Type-safe without codegen** — the `KyselyDatabase` interface in `packages/bizcore-db/src/types/kysely-database.ts` is the schema source of truth; adding a column is a one-file edit.
3. **SQL-transparent** — complex JOINs, CTEs, and window functions are written as SQL-shaped TypeScript, not abstracted away. The raw-pg scans in `EventWorker` and `SearchService` would be straightforward Kysely queries.
4. **Transaction parity** — `db.transaction().execute(fn)` covers all patterns currently spread across `prisma.$transaction`, `pg.PoolClient`, and Drizzle transactions.
5. **No codegen friction** — Prisma's `generate` step costs 3–5 s per CI run and requires re-running after every schema change. Kysely type edits are instant.

### Why not Prisma as target

Prisma adds a generated client with a rigid query DSL that struggles with complex aggregations and multi-schema setups. The `finance.*` schema is already fully on Kysely; pulling master tables back to Prisma would reverse that work.

### Why not Drizzle as target

Drizzle is only used for the workflow state machines (approvals), and its schema definition duplicates the SQL migrations. Migrating Kysely finance tables to Drizzle would be regression rather than progress.

## Migration Phases

### Phase 1 — Drizzle → Kysely (Effort: S, ~2–3 days)

**Scope**: `ApprovalService` and all `workflow.approval_*` tables.

1. Add `approval_requests` and `approval_steps` to `KyselyDatabase` in `kysely-database.ts`.
2. Rewrite `ApprovalRepository` using Kysely (currently uses Drizzle internally).
3. Remove `drizzle/schema.ts`, `drizzle-client.ts`, and the `drizzle-orm` dependency.
4. Update exports in `packages/bizcore-db/src/index.ts`.

No data migration required — tables are unchanged; only the query layer changes.

**Risk**: Low. ApprovalService is well-tested. Integration tests cover the full approval workflow.

### Phase 2 — Raw `pg` scans → Kysely (Effort: S, ~1 day)

**Scope**: `EventWorker` overdue/dunning scans, `SearchService` full-text queries, `ReportingService` aggregations.

1. Move the two `pgPool.query(...)` calls in `EventWorker.scanOverdue()` and `scanDunning()` to `OutboxRepository`/`InvoiceRepository` Kysely methods.
2. Rewrite `SearchService` queries using Kysely's raw `sql` tagged template (preserves query text, adds compile-time safety on the result columns).
3. Rewrite `ReportingService` aggregations similarly.
4. Remove `pg` direct imports from services; retain `pg.Pool` only in `kysely-client.ts` (Kysely uses it as its dialect driver) and the EventWorker's LISTEN/NOTIFY dedicated connection.

**Note**: The LISTEN/NOTIFY dedicated connection (`pgPool.connect()`) must keep a raw `pg.PoolClient` — Kysely does not expose a persistent subscribe model. This is the only justified remaining raw-pg usage.

**Risk**: Low-medium. SearchService has integration test coverage; scan queries are straightforward SQL.

### Phase 3 — Prisma master tables → Kysely (Effort: M, ~1 week)

**Scope**: `organizations`, `users`, `customers`, `products`, `quote_requests`, `quotes`, `quote_items`, `quote_templates`, `recurring_contracts`.

1. Add all Prisma-managed tables to `KyselyDatabase`.
2. Port each Prisma repository to Kysely, starting with `OrganizationRepository` and `UserRepository` (simplest schemas).
3. Retain `prisma/schema.prisma` for migration generation only (CI step: `prisma migrate diff` to validate SQL; no more `prisma generate` in the compile path).
4. Remove `@prisma/client` from runtime dependencies; keep `prisma` as a devDependency for migration tooling.

**Risk**: Medium. Prisma handles `updatedAt` auto-update via `@updatedAt`. Kysely requires explicit `set({ updatedAt: new Date() })` — repositories need to add this. Integration tests will catch any misses.

## Post-Migration Target State

```
packages/bizcore-db/
  prisma/               ← migration files only (devDependency)
  src/
    clients/
      kysely-client.ts  ← single DB access pool
      redis-client.ts   ← unchanged
    repositories/       ← all Kysely
    types/
      kysely-database.ts ← schema source of truth
```

No Drizzle, no `@prisma/client` at runtime, no raw `pg` in service code (except the LISTEN/NOTIFY connection).

## Consequences

- **Positive**: One error type, one transaction API, one schema source of truth.
- **Positive**: Removes one `npm install` dependency group (`drizzle-orm`, `drizzle-kit`) from production.
- **Positive**: Eliminates the `prisma generate` CI step (saves ~4 s per run after Phase 3).
- **Negative**: Phase 3 is non-trivial migration of ~9 repositories; risk of regressions in master-data paths.
- **Negative**: Loses Prisma Studio as a visual query tool (acceptable for a BtoB billing API with an existing Swagger UI).
- **Neutral**: `prisma migrate` tooling is retained as devDependency — migration workflow is unchanged.

## Acceptance Criteria

- [x] ADR document exists at `docs/adr/003-orm-consolidation.md`
- [x] Current ORM usage is mapped per table/service
- [x] Target ORM is justified with trade-offs documented
- [x] Phased migration plan with effort estimates defined
- [ ] Phase 1 (Drizzle → Kysely) tracked as follow-up Issue
- [ ] Phase 2 (pg scans → Kysely) tracked as follow-up Issue
- [ ] Phase 3 (Prisma → Kysely) tracked as follow-up Issue
