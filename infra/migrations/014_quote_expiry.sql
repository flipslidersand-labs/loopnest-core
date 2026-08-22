-- M09: Quote expiry — valid_until date for quotes
-- NULL = no expiry (legacy / unlimited)
-- Auto-rejection is handled by the EventWorker expiry scanner.

ALTER TABLE core.quotes
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_quotes_expires_at
  ON core.quotes (expires_at)
  WHERE expires_at IS NOT NULL AND status IN ('draft','pending_approval');
