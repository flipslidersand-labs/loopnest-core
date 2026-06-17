-- M13: Payments & Accounts Receivable.
-- Payment ledger against finance.invoices, supporting partial payments and
-- reversals. Invoice balance/status are derived from confirmed payments.

CREATE TABLE IF NOT EXISTS finance.payments (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      UUID    NOT NULL REFERENCES finance.invoices(id),
  organization_id UUID    REFERENCES core.organizations(id),  -- M07 org scoping
  amount          NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  method          VARCHAR(50) NOT NULL
                    CHECK (method IN ('bank_transfer', 'credit_card', 'cash', 'offset')),
  paid_on         DATE    NOT NULL,
  reference       VARCHAR(255),                  -- payer name / external txn id
  status          VARCHAR(20) NOT NULL DEFAULT 'confirmed'
                    CHECK (status IN ('confirmed', 'reversed')),
  reversed_at     TIMESTAMPTZ,
  reversal_reason TEXT,
  metadata        JSONB,
  created_by      VARCHAR(255),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_invoice ON finance.payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_org     ON finance.payments(organization_id);
CREATE INDEX IF NOT EXISTS idx_payments_paid_on ON finance.payments(paid_on);
CREATE INDEX IF NOT EXISTS idx_payments_status  ON finance.payments(status);

-- Allow the 'partially_paid' state in the invoice status lifecycle.
ALTER TABLE finance.invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE finance.invoices ADD  CONSTRAINT invoices_status_check
  CHECK (status IN ('issued', 'sent', 'partially_paid', 'paid', 'cancelled'));
