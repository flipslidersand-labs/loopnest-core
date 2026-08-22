-- M06: Tax Rate Master
-- Introduces a tax_rates lookup table in the core schema.
-- Existing quotes/invoices keep their stored tax_amount unchanged;
-- new documents will reference a tax_rate_id for audit traceability.

CREATE TABLE IF NOT EXISTS core.tax_rates (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(50) NOT NULL,
  rate        NUMERIC(5,4) NOT NULL CHECK (rate >= 0 AND rate <= 1),
  is_default  BOOLEAN     NOT NULL DEFAULT false,
  valid_from  DATE        NOT NULL DEFAULT CURRENT_DATE,
  valid_to    DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tax_rates_name_unique UNIQUE (name),
  CONSTRAINT tax_rates_valid_to_check CHECK (valid_to IS NULL OR valid_to > valid_from)
);

-- Partial index: only one default rate at a time
CREATE UNIQUE INDEX IF NOT EXISTS tax_rates_single_default
  ON core.tax_rates (is_default)
  WHERE is_default = true;

-- Seed: Japan standard and reduced rates
INSERT INTO core.tax_rates (name, rate, is_default, valid_from)
VALUES
  ('標準税率', 0.1000, true,  '2019-10-01'),
  ('軽減税率', 0.0800, false, '2019-10-01')
ON CONFLICT (name) DO NOTHING;

-- FK columns (nullable: existing docs are unaffected)
ALTER TABLE core.quotes
  ADD COLUMN IF NOT EXISTS tax_rate_id UUID REFERENCES core.tax_rates(id);

ALTER TABLE finance.invoices
  ADD COLUMN IF NOT EXISTS tax_rate_id UUID REFERENCES core.tax_rates(id);

CREATE INDEX IF NOT EXISTS idx_quotes_tax_rate    ON core.quotes(tax_rate_id);
CREATE INDEX IF NOT EXISTS idx_invoices_tax_rate  ON finance.invoices(tax_rate_id);
