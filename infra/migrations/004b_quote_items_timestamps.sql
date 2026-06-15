-- Add created_at to quote_items for ordering and auditing.
ALTER TABLE core.quote_items
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
