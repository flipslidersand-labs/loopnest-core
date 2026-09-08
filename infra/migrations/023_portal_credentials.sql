-- M28: Portal customer credentials
-- Adds portal_password_hash to core.customers so /api/portal/login
-- requires email + password instead of accepting any known customerId.
ALTER TABLE core.customers
  ADD COLUMN IF NOT EXISTS portal_password_hash TEXT;
