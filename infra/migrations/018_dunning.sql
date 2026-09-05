-- M15: Dunning Management
-- Dunning rules define when and how many times to send reminders for overdue invoices.
-- Dunning logs record each reminder sent, preventing duplicates.

CREATE TABLE IF NOT EXISTS core.dunning_rules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(255) NOT NULL,
  days_overdue INT  NOT NULL CHECK (days_overdue >= 0),
  action       VARCHAR(50) NOT NULL DEFAULT 'reminder'
               CHECK (action IN ('reminder', 'warning', 'suspend', 'collection')),
  message_template TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (days_overdue, action)
);

-- Seed default dunning schedule
INSERT INTO core.dunning_rules (name, days_overdue, action, message_template) VALUES
  ('First reminder',   3,  'reminder',   'Your invoice {{invoice_number}} is 3 days overdue. Please arrange payment.'),
  ('Second reminder',  7,  'reminder',   'Your invoice {{invoice_number}} is 7 days overdue. Immediate payment required.'),
  ('Final warning',    14, 'warning',    'FINAL NOTICE: Invoice {{invoice_number}} is 14 days overdue. Service may be suspended.'),
  ('Suspend service',  30, 'suspend',    'Service suspended due to unpaid invoice {{invoice_number}} (30 days overdue).'),
  ('Collections',      60, 'collection', 'Invoice {{invoice_number}} referred to collections (60 days overdue).')
ON CONFLICT (days_overdue, action) DO NOTHING;

CREATE TABLE IF NOT EXISTS finance.dunning_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   UUID NOT NULL REFERENCES finance.invoices(id) ON DELETE CASCADE,
  rule_id      UUID NOT NULL REFERENCES core.dunning_rules(id) ON DELETE CASCADE,
  days_overdue INT  NOT NULL,
  action       VARCHAR(50) NOT NULL,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (invoice_id, rule_id)
);

CREATE INDEX IF NOT EXISTS idx_dunning_logs_invoice ON finance.dunning_logs(invoice_id);
