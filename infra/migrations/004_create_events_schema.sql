-- ============================================
-- M02: Events Schema - Outbox Pattern
-- ============================================

-- Create events schema
CREATE SCHEMA IF NOT EXISTS events;

-- events.outbox_events (Transactional Outbox for event reliability)
CREATE TABLE IF NOT EXISTS events.outbox_events (
  id VARCHAR(36) PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  aggregate_id VARCHAR(36) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'processed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  retry_count INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_outbox_events_status ON events.outbox_events(status);
CREATE INDEX idx_outbox_events_created_at ON events.outbox_events(created_at);
CREATE INDEX idx_outbox_events_status_created ON events.outbox_events(status, created_at);
CREATE INDEX idx_outbox_events_aggregate_id ON events.outbox_events(aggregate_id);
