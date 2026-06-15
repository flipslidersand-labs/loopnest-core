-- M14: Credit Notes & Refunds
-- A credit note reduces what a customer owes. It can be applied against one or
-- more (future) invoices, or refunded as cash. Applications are tracked in a
-- separate ledger table so the remaining balance is always derivable.
BEGIN;

CREATE SEQUENCE IF NOT EXISTS finance.credit_note_seq START 1;

CREATE TABLE IF NOT EXISTS finance.credit_notes (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID          NULL,
  invoice_id       UUID          NULL REFERENCES finance.invoices(id),
  credit_number    TEXT          NOT NULL UNIQUE,
  amount           NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  reason           TEXT          NOT NULL,
  cn_type          TEXT          NOT NULL DEFAULT 'adjustment'
                   CHECK (cn_type IN ('return', 'pricing_error', 'goodwill', 'adjustment')),
  status           TEXT          NOT NULL DEFAULT 'issued'
                   CHECK (status IN ('issued', 'partially_applied', 'fully_applied', 'refunded', 'void')),
  applied_amount   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (applied_amount >= 0),
  refunded_amount  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  issued_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  metadata         JSONB         NULL,
  created_by       UUID          NULL,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS finance.credit_note_applications (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_id UUID          NOT NULL REFERENCES finance.credit_notes(id),
  invoice_id     UUID          NOT NULL REFERENCES finance.invoices(id),
  amount         NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  applied_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  applied_by     UUID          NULL,
  notes          TEXT          NULL
);

CREATE INDEX IF NOT EXISTS idx_credit_notes_invoice ON finance.credit_notes(invoice_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_org     ON finance.credit_notes(organization_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_status  ON finance.credit_notes(status);
CREATE INDEX IF NOT EXISTS idx_cn_apps_cn           ON finance.credit_note_applications(credit_note_id);
CREATE INDEX IF NOT EXISTS idx_cn_apps_invoice      ON finance.credit_note_applications(invoice_id);

COMMIT;
