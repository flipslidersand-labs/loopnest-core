-- M28: Portal customer credentials
-- Adds contact_email and portal_password_hash to core.customers.
-- contact_email was already referenced in CustomerRepository.map() but the column
-- was missing from the table — added here to enable email-based portal login.
ALTER TABLE core.customers
  ADD COLUMN IF NOT EXISTS contact_email VARCHAR(200),
  ADD COLUMN IF NOT EXISTS portal_password_hash TEXT;
