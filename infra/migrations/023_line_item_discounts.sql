-- M27: per-item discount on quote_items and invoice_items
ALTER TABLE core.quote_items
  ADD COLUMN IF NOT EXISTS discount_pct  NUMERIC(5, 2)  DEFAULT NULL CHECK (discount_pct  >= 0 AND discount_pct  <= 100),
  ADD COLUMN IF NOT EXISTS discount_amt  NUMERIC(12, 2) DEFAULT NULL CHECK (discount_amt  >= 0);

ALTER TABLE finance.invoice_items
  ADD COLUMN IF NOT EXISTS discount_pct  NUMERIC(5, 2)  DEFAULT NULL CHECK (discount_pct  >= 0 AND discount_pct  <= 100),
  ADD COLUMN IF NOT EXISTS discount_amt  NUMERIC(12, 2) DEFAULT NULL CHECK (discount_amt  >= 0);
