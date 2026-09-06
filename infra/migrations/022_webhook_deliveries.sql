-- M18: Webhook delivery log for retry / observability.
CREATE TABLE IF NOT EXISTS events.webhook_deliveries (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id      UUID         NOT NULL REFERENCES events.webhooks(id) ON DELETE CASCADE,
  event_type      VARCHAR(100) NOT NULL,
  payload         JSONB        NOT NULL,
  status          VARCHAR(20)  NOT NULL CHECK (status IN ('success', 'failed')),
  http_status     INT,
  error_message   TEXT,
  delivered_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON events.webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status  ON events.webhook_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_event   ON events.webhook_deliveries(event_type);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_at      ON events.webhook_deliveries(delivered_at DESC);
