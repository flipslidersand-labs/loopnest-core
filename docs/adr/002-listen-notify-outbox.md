# ADR-002: PostgreSQL LISTEN/NOTIFY for Outbox Dispatch

**Status**: Accepted  
**Date**: 2026-09-05  
**Issue**: #30

## Context

`EventWorker` polled `events.outbox_events` every 5 seconds (configurable via `EVENT_WORKER_INTERVAL_MS`). This caused:

1. Up to 5 s dispatch latency under light load (a webhook fires 0–5 s after the business event)
2. A `SELECT … WHERE status='pending'` query every 5 s even when the outbox is empty
3. Under multi-pod deployments: simultaneous polls ("thundering herd") on idle DBs

## Decision

**Use PostgreSQL `LISTEN`/`NOTIFY` as the primary wake-up mechanism, with a 60 s fallback poll.**

### Mechanism

1. A `AFTER INSERT` trigger on `events.outbox_events` calls `pg_notify('outbox_event', NEW.id)`.
2. `EventWorker` holds a dedicated, persistent `pg.Pool` client that issues `LISTEN outbox_event`.
3. On each notification, `processBatch()` runs immediately — dispatch latency drops to ~O(RTT).
4. A 60 s fallback poll (`LISTEN_NOTIFY_FALLBACK_MS`, default 60 000) catches events that were
   inserted before `LISTEN` was established, and covers the reconnect gap.
5. If the LISTEN client errors (network blip, DB restart), it reconnects with a 5 s back-off and
   the fallback poll covers the gap.

### Backward Compatibility

- If `pgPool.connect` is not provided (unit test stubs that only mock `query`), the worker falls
  back to the original polling interval — zero test-infrastructure changes needed.
- `EVENT_WORKER_INTERVAL_MS` still controls the fallback when `connect` is absent; the new
  `LISTEN_NOTIFY_FALLBACK_MS` controls the fallback when LISTEN is active.

## Tradeoffs

| Concern | Assessment |
|---------|------------|
| Connection cost | One additional persistent connection per API pod. Acceptable: pg default `max_connections=100`, typical pod count <10. |
| Missed notifies on reconnect | Covered by 60 s fallback poll. No event is permanently missed. |
| Ordering | `NOTIFY` is best-effort and unordered. `processBatch()` claims rows with `FOR UPDATE SKIP LOCKED` — ordering is DB-determined regardless of notification order. |
| Multi-pod fan-out | Multiple pods each receive the NOTIFY and race to claim rows. `FOR UPDATE SKIP LOCKED` already handles this correctly; duplicate wakes are harmless. |
| Trigger overhead | `pg_notify` is O(1) and async — negligible compared to the INSERT cost. |

## Alternatives Rejected

| Alternative | Reason |
|-------------|--------|
| Keep 5 s poll | Latency stays high; idle load is real cost at scale. |
| Redis pub/sub | Extra infrastructure; adds a new failure domain when pg is already present. |
| Dedicated queue (SQS, RabbitMQ) | Overengineered for current scale; breaks transactional outbox atomicity guarantee. |
| Reduce poll to 500 ms | Drops latency but 10× DB query rate — worse than NOTIFY. |

## Consequences

- p99 dispatch latency under light load: ≤5000 ms → ≤200 ms (measured as time from `INSERT` to `processBatch` start)
- Idle DB queries: 720/hour → 60/hour per pod
- One extra persistent connection per pod
- Migration `019_outbox_notify_trigger.sql` must run before deploying this version
