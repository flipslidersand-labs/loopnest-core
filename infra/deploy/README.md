# Deployment

Everything needed to stand up LoopNest Core from a clean machine.

## Components

| Piece | Where |
|-------|-------|
| Infra (Postgres 17, Valkey 8) | `compose.yml` |
| Schema bootstrap (schemas + grants) | `infra/docker/postgres/init.sql` (runs on first DB init) |
| Migrations (tables, indexes, sequence) | `infra/migrations/*.sql` |
| Migration runner (idempotent) | `infra/migrations/run.sh` |
| API image | `apps/api/Dockerfile` (multi-stage) |
| One-command bring-up | `infra/deploy/up.sh` |

## Quick start

```bash
# Infra + migrations (no app container; run the API from source or separately)
infra/deploy/up.sh

# Infra + migrations + build & run the API container
infra/deploy/up.sh --with-api

# Start over, wiping the database volume (DESTROYS DATA)
infra/deploy/up.sh --fresh --with-api
```

`up.sh` auto-detects `docker compose` (v2) or `docker-compose` (v1), waits for
Postgres/Redis to report healthy, then applies migrations.

## Migrations

Applied in lexical order; every file is idempotent (`IF NOT EXISTS`,
`CREATE SEQUENCE IF NOT EXISTS`), so re-running is safe.

```bash
DATABASE_URL=postgres://loopnest:loopnest_dev_password@localhost:5432/omni_local \
  infra/migrations/run.sh
```

| File | Contents |
|------|----------|
| `000_create_schemas.sql` | core, workflow, finance, audit, events |
| `001_create_core_schema.sql` | organizations, users, customers, products, quotes, quote_items |
| `002_create_workflow_finance_schema.sql` | invoices (+ `invoice_number_seq`), approvals |
| `003_create_audit_schema.sql` | audit_logs, request_logs |
| `004_create_events_schema.sql` | outbox_events |

## Building the API image

Build context is the **monorepo root** (the API has a `file:` dependency on
`packages/bizcore-db`):

```bash
docker build -f apps/api/Dockerfile -t loopnest-api .
```

The build builds `bizcore-db` (Prisma generate + tsc), then the API. The runtime
stage runs as the unprivileged `node` user and ships a `HEALTHCHECK` hitting
`/health`.

## Runtime configuration

| Env var | Purpose | Default |
|---------|---------|---------|
| `DATABASE_URL` | Postgres connection string | — (required) |
| `REDIS_HOST` / `REDIS_PORT` | Valkey/Redis | `localhost` / `6379` |
| `PORT` | API listen port | `3000` |
| `RATE_LIMIT_GLOBAL_MAX` | `/api` requests per window | `300` |
| `RATE_LIMIT_WORKFLOW_MAX` | `/api/workflow` requests per window | `60` |
| `RATE_LIMIT_WINDOW_SECONDS` | Rate-limit window | `60` |

## Health / observability endpoints

| Endpoint | Use |
|----------|-----|
| `GET /health` | Liveness (no dependencies) |
| `GET /ready` | Readiness — checks Postgres + Redis, 200/503 |
| `GET /metrics` | Prometheus scrape |

## Notes / current limitations

- The API service is run as a standalone container by `up.sh --with-api`
  (via `--network host`) rather than a compose service, so ordering works on
  docker-compose v1 (which lacks `depends_on: service_completed_successfully`).
  On a v2 host you can add an `api` service to `compose.yml` and gate it on the
  migration step.
- Secrets (DB password) are local-dev defaults here; supply real values via the
  environment in non-local deploys.
