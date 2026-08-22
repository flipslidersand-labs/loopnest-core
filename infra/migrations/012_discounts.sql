-- M07: Discount columns on quotes and invoices
-- discount_type: 'percentage' (0..100) or 'fixed' (absolute amount)
-- discount_value: the magnitude (10 = 10% or ¥10)
-- discount_amount: computed and stored by the application

ALTER TABLE core.quotes
  ADD COLUMN IF NOT EXISTS discount_type   TEXT    CHECK (discount_type IN ('percentage','fixed')),
  ADD COLUMN IF NOT EXISTS discount_value  NUMERIC(15,4),
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(15,2);

ALTER TABLE finance.invoices
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(15,2) NOT NULL DEFAULT 0;
