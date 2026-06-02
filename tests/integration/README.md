# Integration Tests

Black-box tests that exercise the running API against the local Docker stack
(`loopnest-postgres`, `loopnest-redis`). They hit real endpoints over HTTP and
assert on status codes, headers, and persisted state.

## Run everything

```bash
tests/integration/run-all.sh
```

The runner will:
1. Start the `loopnest-postgres` / `loopnest-redis` containers if stopped and
   wait for them to report healthy.
2. Build `bizcore-db` and `api` (skip with `SKIP_BUILD=1`).
3. Start the API server (or reuse one already on `:3000`).
4. Run each suite and print a combined pass/fail summary.

Run a single suite:

```bash
SKIP_BUILD=1 tests/integration/run-all.sh rate_limit
```

## Suites

| Suite | What it covers |
|-------|----------------|
| `e2e_workflow` | Happy path CREATE → SUBMIT → APPROVE → INVOICE |
| `error_scenarios` | Invalid states (409), missing resources (404), constraint/validation (400) |
| `concurrency` | Atomic state machine under simultaneous requests (no double-transition) |
| `idempotency` | `Idempotency-Key` replay, body-conflict (422), in-flight (409), fail-open |
| `rate_limit` | Sliding-window limiter (60/min workflow bucket), `RateLimit-*` + `Retry-After` headers |

## Requirements

`node`, `jq`, `uuidgen`, `docker`, `curl`.

## Notes

- `rate_limit` intentionally sends 75 requests to trip the 60/min workflow cap,
  so it takes ~10s and leaves the bucket saturated. If you run it back-to-back,
  give the window 60s to drain or the next workflow-heavy suite may see 429s.
- Tests create fresh customers/quotes per run; they do not clean up afterwards.
  Re-running is safe (unique quote numbers via timestamp + `$RANDOM`).
