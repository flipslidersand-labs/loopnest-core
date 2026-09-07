-- Add pause_reason and pause_until to recurring_contracts (M22)
ALTER TABLE core.recurring_contracts
  ADD COLUMN IF NOT EXISTS pause_reason TEXT,
  ADD COLUMN IF NOT EXISTS pause_until  DATE;
