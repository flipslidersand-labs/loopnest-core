-- Issue #118: scanOverdue() deduplication was check-then-insert (NOT EXISTS
-- subquery, then a separate INSERT), which races under multiple EventWorker
-- replicas — two instances can both pass the NOT EXISTS check for the same
-- invoice before either one inserts, double-firing the outbox event, webhook,
-- and overdue email. Mirror the pattern already used for dunning_logs
-- (finance.dunning_logs UNIQUE(invoice_id, rule_id) + 23505 catch): enforce
-- "at most one payment_overdue outbox event per invoice per UTC day" with a
-- partial unique index so the INSERT itself is the atomic guard.
CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_payment_overdue_daily
  ON events.outbox_events (aggregate_id, ((created_at AT TIME ZONE 'UTC')::date))
  WHERE event_type = 'payment_overdue';
