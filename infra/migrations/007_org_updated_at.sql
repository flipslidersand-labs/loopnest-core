-- Add updated_at to organizations (missing from initial migration).
ALTER TABLE core.organizations
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
