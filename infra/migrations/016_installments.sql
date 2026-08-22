-- M11: Invoice installment schedule
-- An invoice can be split into N equal installments, each with its own due_date.
-- Constraint: total of installment amounts must equal invoice total_amount.

CREATE TABLE IF NOT EXISTS finance.invoice_installments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  UUID        NOT NULL REFERENCES finance.invoices(id) ON DELETE CASCADE,
  seq         INT         NOT NULL,           -- 1-based sequence number within the invoice
  due_date    DATE        NOT NULL,
  amount      NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  status      VARCHAR(20) NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','paid','cancelled')),
  paid_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (invoice_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_installments_invoice
  ON finance.invoice_installments (invoice_id);
CREATE INDEX IF NOT EXISTS idx_installments_due_date
  ON finance.invoice_installments (due_date)
  WHERE status = 'pending';
