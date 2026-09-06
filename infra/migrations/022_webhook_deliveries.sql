-- events.webhook_deliveries: records each delivery attempt for an outbound webhook
CREATE TABLE IF NOT EXISTS events.webhook_deliveries (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id    UUID        NOT NULL REFERENCES events.webhooks(id) ON DELETE CASCADE,
  event_type    TEXT        NOT NULL,
  payload       JSONB       NOT NULL,
  status        TEXT        NOT NULL CHECK (status IN ('success', 'failed')),
  http_status   INT,
  error_message TEXT,
  delivered_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_id
  ON events.webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status
  ON events.webhook_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_delivered_at
  ON events.webhook_deliveries(delivered_at DESC);
