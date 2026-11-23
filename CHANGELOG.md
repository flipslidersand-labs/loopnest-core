# Changelog

All notable changes to this project are documented in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
Versioning: [Semantic Versioning](https://semver.org/)

> No version has been tagged yet. The entries below summarize the git history up to the first release.

---

## [Unreleased]

### Added

- Monorepo foundation: pnpm workspaces and Turborepo, Docker Compose (PostgreSQL and Redis), the `@loopnest/bizcore-db` data-access package (Kysely and raw `pg`), a migrations runner, an API image and a bring-up script.
- Quote-to-billing workflow: quotes with line items and automatic recalculation, workflow transitions (submit, approve, issue invoice), invoice management with list/filter and a status lifecycle, and idempotency-key support on workflow endpoints.
- Reliable asynchronous processing: Outbox pattern with at-least-once accounting dispatch and retry, an event worker driven by PostgreSQL LISTEN/NOTIFY, and a mock accounting API for integration tests.
- Billing features: PDF invoices and quotes, a tax-rate master with database lookup on invoice issue, quote-level and line-item discounts, customer credit limits, quote expiry with auto-reject, quote templates, invoice installments, recurring billing contracts (with pause/resume and auto-resume), and bulk invoice create/status with CSV export.
- Receivables and finance: payments and accounts-receivable aging, credit notes and refunds, dunning management with automated reminders, multi-currency support (exchange-rates table and CRUD API), customer statements of account (JSON and PDF), and a consumption-tax summary report.
- Financial reporting: monthly P&L, cash flow and revenue-by-customer reports.
- Authentication and tenancy: JWT authentication with RBAC, multi-tenant organization-scoped data, organization member management, a customer self-service portal (login plus invoice/quote read API), and a search API.
- Webhooks: delivery log with manual retry, timestamp-signed payloads to prevent replay, event-type validation and filtering, and a minimum secret length.
- Audit trail: audit logging for invoice, payment, customer and credit-note operations, with a query API and CSV export.
- Email notifications for issued invoices and overdue alerts (dry-run safe by default).
- Observability: structured JSON logging, Prometheus metrics (database queries, Outbox lag, webhook failures), a readiness probe, and OpenTelemetry trace propagation.
- API and developer experience: OpenAPI 3.1 specification with Swagger UI and a validation script, cursor-based pagination for invoices, customers and payments, a rate-limiting middleware (sliding window, fail-open on Redis errors), `.env.example`, an error-code reference, architecture decision records, a bilingual README, and a git-worktree setup script.
- Quality tooling: bash/curl integration suites, unit tests for core services and utilities, a load harness, per-package coverage thresholds with a README badge, an ESLint flat config, and a pre-commit hook (husky and lint-staged).
- CI: GitHub Actions integration pipeline, an AI review quality gate on pull requests, a gitleaks secrets scan, a lint job, and a stale-PR bot with size labels.

### Security

- Restricted CORS origins and required `JWT_SECRET` at startup; startup failures are now logged in a structured way.
- Enforced organization isolation and role checks across many endpoints: invoice reads, customer update/delete/credit, recurring contracts, reports, organizations, users, webhook deliveries, audit and request logs.
- Fixed IDOR on the approvals-by-user endpoint, added a `requireRole` guard to the invoice export, and stopped trusting spoofed workflow actors (the actor is now derived from the JWT; missing authentication returns 401 instead of a silent fallback).
- Portal login now requires email and password and is rate limited; the rate-limit identity no longer trusts unvalidated `X-Forwarded-For`.
- Blocked SSRF on webhook URL registration.
- Quote `PATCH` now rejects direct status changes and negative unit prices, forcing use of the workflow API.
- Reduced denial-of-service exposure: a 366-day maximum range on the cash-flow report, date validation on the revenue report, size caps on list endpoints, and streaming CSV export that respects backpressure.
- Updated dependencies to resolve known vulnerabilities (`qs` and `kysely`) and removed the `uuid` dependency in favor of `node:crypto`.

### Fixed

- Eliminated race conditions in quote-to-invoice transitions; quote status changes and Outbox publishes are now atomic, and a quote reverts to approved when invoice creation fails.
- Made Outbox claiming atomic and moved credit-used release into the Outbox for reliable retry; invoice creation and credit usage now run in one transaction.
- Recurring contracts are claimed atomically before billing, and overdue scans are deduplicated with a unique index.
- Fixed overdue detection to use the payment due date, computed a real opening balance in statements, and made statements fetch all invoices.
- Fixed date handling for DATE columns (local date parts instead of ISO conversion).
- Consolidated duplicate PostgreSQL pools into one with connection timeouts, added timeouts to the SMTP transport, the accounting API fetch and the readiness Redis ping, and cleared reconnect timers in the event worker.
- Removed an N+1 query in invoice lookup by quote, capped scan batch sizes, and handled SIGINT for graceful shutdown.
- Unified CSV escaping between invoice and audit exports, and warned when an export reaches the 10,000-row limit.
- Served `/openapi.json` and `/docs` directly instead of redirecting.
- Completed Prisma error-code mapping in the error handler and added logging to fire-and-forget code paths.
- Improved test and CI reliability: polling instead of fixed sleeps, per-run database isolation, server cleanup on self-hosted runners, and an ERR trap in integration suites.
- Refactored toward consistent typing and structure: removed `any` from repositories, consolidated database access on Kysely (Drizzle dead code removed, Prisma-based repositories migrated), switched list endpoints to cursor pagination, and moved services to scoped dependency injection.
