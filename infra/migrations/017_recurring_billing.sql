-- M12: Recurring Billing contracts
-- Stores subscription/recurring invoice contracts that auto-generate invoices.

CREATE TABLE IF NOT EXISTS core.recurring_contracts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     UUID        NOT NULL REFERENCES core.customers(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  -- Billing schedule
  interval_unit   VARCHAR(10) NOT NULL CHECK (interval_unit IN ('day','week','month','year')),
  interval_value  INT         NOT NULL CHECK (interval_value >= 1),
  -- Amount
  amount          NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  tax_rate        NUMERIC(5,4)  NOT NULL DEFAULT 0.10,
  -- Lifecycle
  status          VARCHAR(20) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','paused','cancelled','completed')),
  starts_at       DATE        NOT NULL,
  ends_at         DATE,                      -- NULL = indefinite
  next_billing_at DATE        NOT NULL,
  -- Items snapshot (JSONB array of { name, quantity, unit_price })
  line_items      JSONB       NOT NULL DEFAULT '[]',
  -- Audit
  created_by      VARCHAR(255) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recurring_customer
  ON core.recurring_contracts (customer_id);

CREATE INDEX IF NOT EXISTS idx_recurring_next_billing
  ON core.recurring_contracts (next_billing_at)
  WHERE status = 'active';

-- Allow recurring invoices that are not linked to a quote
ALTER TABLE finance.invoices
  ALTER COLUMN quote_id DROP NOT NULL;

ALTER TABLE finance.invoices
  ADD COLUMN IF NOT EXISTS contract_id UUID REFERENCES core.recurring_contracts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_contract
  ON finance.invoices (contract_id)
  WHERE contract_id IS NOT NULL;
