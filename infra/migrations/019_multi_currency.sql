-- M16: Multi-currency support
-- Adds exchange_rates table and currency/exchange_rate columns to quotes and invoices.
-- All existing rows default to JPY / 1.0 (no data migration required).

-- Exchange rate registry: one row per currency code with the rate relative to JPY.
CREATE TABLE IF NOT EXISTS exchange_rates (
  currency_code   CHAR(3)           PRIMARY KEY,  -- ISO 4217 (e.g. 'USD', 'EUR')
  rate_to_jpy     DECIMAL(19, 6)    NOT NULL,     -- 1 unit of this currency = N JPY
  effective_date  DATE              NOT NULL,
  updated_at      TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

-- Insert JPY as the reference currency (rate = 1).
INSERT INTO exchange_rates (currency_code, rate_to_jpy, effective_date)
VALUES ('JPY', 1.000000, CURRENT_DATE)
ON CONFLICT (currency_code) DO NOTHING;

-- Quotes: add currency fields.
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS currency      CHAR(3)        NOT NULL DEFAULT 'JPY',
  ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(19, 6) NOT NULL DEFAULT 1.000000;

-- Invoices: add currency fields.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS currency      CHAR(3)        NOT NULL DEFAULT 'JPY',
  ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(19, 6) NOT NULL DEFAULT 1.000000;
