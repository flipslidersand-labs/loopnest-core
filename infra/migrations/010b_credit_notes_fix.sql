-- Fix: created_by and applied_by should be VARCHAR(255) consistent with
-- finance.payments.created_by, not UUID — tokens use arbitrary string sub claims.
BEGIN;

ALTER TABLE finance.credit_notes
  ALTER COLUMN created_by TYPE VARCHAR(255);

ALTER TABLE finance.credit_note_applications
  ALTER COLUMN applied_by TYPE VARCHAR(255);

COMMIT;
