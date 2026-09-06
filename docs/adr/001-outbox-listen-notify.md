# ADR 001: Replace EventWorker polling with PostgreSQL LISTEN/NOTIFY

**Status**: Accepted  
**Date**: 2026-09-05  
**Issue**: #30

## Context

`EventWorker` polls `events.outbox_events` every 5 seconds (configurable via `EVENT_WORKER_INTERVAL_MS`). This introduces up to 5 s dispatch latency on idle queues and generates continuous DB load even when no events are pending. Under horizontal scaling, multiple API pods issue identical SELECT queries simultaneously (thundering herd).

## Decision

Implement LISTEN/NOTIFY as the primary wake mechanism while keeping a 60-second fallback poll.

### Implementation

1. **Migration 020**: A PostgreSQL trigger on `events.outbox_events AFTER INSERT` calls `pg_notify('loopnest_outbox', NEW.id::text)`.
2. **EventWorker**: Maintains a dedicated `pg.Client` that runs `LISTEN loopnest_outbox`. On notification, calls `processBatch()` immediately.
3. **Fallback poll**: `setInterval` at `max(EVENT_WORKER_INTERVAL_MS, 60_000)` ms. Catches any events missed during reconnect windows.
4. **Reconnect**: On client error, `stopListening()` + 5 s retry. Fallback poll guarantees at-most-60 s gap in delivery.

## Tradeoffs

| Concern | Assessment |
|---|---|
| **Extra connection** | +1 pg connection per API pod. Acceptable given pool size. |
| **Missed NOTIFYs on reconnect** | Handled by fallback poll (≤60 s gap). |
| **Ordering** | NOTIFY payload carries event ID; `claimPending` still uses `ORDER BY created_at` — ordering unchanged. |
| **At-least-once delivery** | Unchanged — `claimPending` uses `UPDATE … RETURNING` as the mutex. |
| **Multi-pod thundering herd** | NOTIFY wakes all pods; `claimPending` ensures only one pod claims each event row. |

## Expected outcome

- **p99 dispatch latency**: ≤200 ms under light load (from ≤5000 ms)
- **DB idle query load**: eliminated on quiet queues
- **Reliability**: equivalent to before — fallback poll is the safety net

## Rejected alternatives

- **Advisory locks on poll**: reduces herd but doesn't reduce idle queries
- **Dedicated worker process**: operationally heavier, no reliability advantage
