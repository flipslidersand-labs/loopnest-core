-- M16: exchange_rates master table
CREATE TABLE IF NOT EXISTS exchange_rates (
  currency_code CHAR(3)        NOT NULL,
  rate_to_jpy   DECIMAL(19, 6) NOT NULL,
  effective_date DATE          NOT NULL,
  updated_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  PRIMARY KEY (currency_code)
);

-- M16: currency + exchange_rate columns on core.quotes
ALTER TABLE core.quotes
  ADD COLUMN IF NOT EXISTS currency      CHAR(3)        NOT NULL DEFAULT 'JPY',
  ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(19, 6) NOT NULL DEFAULT 1.0;

-- M16: currency + exchange_rate columns on finance.invoices
ALTER TABLE finance.invoices
  ADD COLUMN IF NOT EXISTS currency      CHAR(3)        NOT NULL DEFAULT 'JPY',
  ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(19, 6) NOT NULL DEFAULT 1.0;
