# Load Test

A dependency-free Node harness (`load.mjs`) that drives concurrent mixed traffic
at the API and reports throughput, latency percentiles, and a status-code
breakdown, then diffs the server's `/metrics` counters across the run.

## Run

```bash
# defaults: 20 workers, 15s
node tests/load/load.mjs

# tune
DURATION_S=30 CONCURRENCY=50 node tests/load/load.mjs
BASE_URL=http://localhost:3000/api node tests/load/load.mjs
```

The API server must already be running. To relax rate limits for a pure
throughput measurement, start it with high caps:

```bash
RATE_LIMIT_GLOBAL_MAX=100000 RATE_LIMIT_WORKFLOW_MAX=100000 \
  node apps/api/dist/src/server.js
```

(The harness also gives each iteration a unique `X-Forwarded-For`, so the
per-IP limiter does not throttle the run by default.)

## Scenario mix

| Scenario | Weight | Calls |
|----------|--------|-------|
| `read_customers` | 45 | GET /customers |
| `read_products` | 25 | GET /products |
| `full_workflow` | 30 | create customer → quote → submit → approve → invoice |

## Baseline (local dev, 20 workers / 15s)

| Metric | Value |
|--------|-------|
| Throughput | ~1,000 req/s |
| Success | 100% |
| p50 / p95 / p99 | ~12 / ~41 / ~51 ms |

Numbers are machine-dependent; treat as a smoke/regression baseline, not an SLA.

## Bugs this harness caught

- **P2022 on `product.findMany()`** — Prisma `Product` model declared a
  non-existent `updated_at` column. Model realigned to the table
  (`stock_quantity`, no `updated_at`).
- **Duplicate invoice numbers** — `INV-YYYYMM-{5-digit random}` collided under
  concurrency (birthday paradox). Replaced with a Postgres sequence
  (`finance.invoice_number_seq`).
