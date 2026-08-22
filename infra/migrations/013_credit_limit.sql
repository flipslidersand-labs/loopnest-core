-- M08: Customer credit limit
-- credit_limit  NULL = unlimited
-- credit_used   running total of outstanding invoice amounts (unpaid/issued/sent)

ALTER TABLE core.customers
  ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS credit_used  NUMERIC(15,2) NOT NULL DEFAULT 0;
