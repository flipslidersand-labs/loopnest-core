-- Track when an invoice was paid.
ALTER TABLE finance.invoices
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
