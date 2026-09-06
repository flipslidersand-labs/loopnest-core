# ADR 002: ORM Consolidation Roadmap (Prisma + Kysely + Drizzle → Kysely)

**Status**: Accepted  
**Date**: 2026-09-06  
**Issues**: #32 (spike), #60 (Phase 1), #61 (Phase 2), #62 (Phase 3)

## Context

`packages/bizcore-db` simultaneously uses four DB clients. Each has different
error types, transaction semantics, and migration tooling. Every new feature
must pick one and bridge the gap to others. Maintenance burden compounds.

## Current state

### ORM inventory

| ORM | Repositories / Locations | Reason introduced |
|---|---|---|
| **Prisma** | Customer, Organization, Product, Quote, QuoteItem, User | First ORM added; auto-generated types from schema |
| **Kysely** | CreditNote, Payment, Webhook, QuoteTemplate, Invoice, Outbox, Dunning, Installment, ExchangeRate, RecurringContract, TaxRate | Type-safe builder; no codegen; fits JOIN-heavy queries |
| **Drizzle** | `clients/drizzle-client.ts` (client only) | Evaluated for state machines; never wired to any repository |
| **raw pg** | AuditService, ReportingService, SearchService, EventWorker (overdue scan), requestMetrics middleware | High-throughput bulk queries; escape hatch for `EXPLAIN`/`COPY` |

### Notes

- **Drizzle is dead code**: initialized but referenced by zero repositories. The client creates a pool connection that is never used.
- **Kysely is already the majority ORM** by repository count (11 of 18 non-container repos).
- **Prisma** owns 6 "master table" repositories (low-churn entities: organizations, customers, products, users, quotes, quote items). These use Prisma's CRUD convenience; no complex JOINs.
- **raw pg** remains appropriate for three patterns: bulk `INSERT … SELECT`, multi-row aggregation (reporting), and full-text search. These would not benefit from a query builder.

## Decision

**Consolidate to Kysely as the single ORM target.**

### Rationale

| Criterion | Prisma | Kysely | Drizzle |
|---|---|---|---|
| Type safety | Generated types (codegen required) | Compile-time from schema interface | Generated types |
| No codegen | ✗ | ✓ | ✗ |
| Raw SQL escape hatch | Limited | `sql` tagged template | ✓ |
| Multi-schema support | Limited (`multiSchema` preview) | ✓ (schema-qualified names) | ✓ |
| Transaction API | Simple | Composable | Composable |
| Bundle size | Heavy (query engine binary) | Minimal | Moderate |
| Already in use | ✓ | ✓ (majority) | Dead code |

Kysely requires no separate code-generation step, supports our `core.*` / `finance.*` / `events.*` multi-schema naming natively via `KyselyDatabase`, and already handles the more complex repositories. Eliminating Prisma removes the Prisma engine binary from production images (~50 MB).

raw pg stays for AuditService, ReportingService, SearchService, and EventWorker's overdue scan — query builder overhead adds no value for bulk aggregation and `LIKE` full-text search.

## Migration phases

### Phase 1 — Remove Drizzle (Effort: S | Issue: #60)

Drizzle is dead code. No repositories consume `drizzleDb`. Delete:

- `packages/bizcore-db/src/clients/drizzle-client.ts`
- `packages/bizcore-db/drizzle/` schema files
- `drizzle-orm` from package.json

Zero risk: no application code path calls into Drizzle.

### Phase 2 — Migrate raw pg scans to Kysely where appropriate (Effort: M | Issue: #61)

Target: `EventWorker.scanOverdue()` and `SearchService` — these are ad-hoc queries that
would benefit from compile-time safety and the existing `KyselyDatabase` schema types.

Not targeted: `AuditService`, `ReportingService` (bulk INSERT/SELECT patterns; raw pg is correct).

Deliverable: `kyselyDb` injected into `EventWorker` and `SearchService`; raw SQL replaced with Kysely builder.

### Phase 3 — Migrate Prisma master tables to Kysely (Effort: L | Issue: #62)

Repositories: Customer, Organization, Product, Quote, QuoteItem, User.

Steps:
1. Add table interfaces to `KyselyDatabase` for each master table (core schema).
2. Rewrite each repository using Kysely builder methods.
3. Remove Prisma schema validation from CI.
4. Delete `prisma-client.ts` and `prisma/schema.prisma`.
5. Remove `@prisma/client` and `prisma` from package.json.

Risk: Quote and QuoteItem repos have 22 and 9 Prisma call sites respectively.
Full test coverage required before merge; run `tests/integration/` on each PR.

## Effort summary

| Phase | Effort | Risk | Deliverable |
|---|---|---|---|
| 1 — Remove Drizzle | S (< 1 day) | None | Clean dependency tree |
| 2 — raw pg → Kysely (partial) | M (2–3 days) | Low | Type-safe overdue/search queries |
| 3 — Prisma → Kysely | L (5–8 days) | Medium | Single ORM, smaller image |

## What stays as raw pg

- `AuditService`: multi-row INSERT for request logs (high throughput, no ORM benefit)
- `ReportingService`: aggregation queries with CTEs (complex enough that raw SQL is clearer)
- Migration scripts in `infra/migrations/` (always raw SQL by design)
