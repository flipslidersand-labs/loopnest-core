-- Add updated_at column to core.users (was omitted from initial schema)
ALTER TABLE core.users
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
