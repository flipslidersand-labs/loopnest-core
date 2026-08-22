-- M10: Quote templates
-- items: JSONB array of {productId, quantity, unitPrice, notes?}
-- organizationId: optional scope for multi-tenant isolation

CREATE TABLE IF NOT EXISTS core.quote_templates (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  items           JSONB        NOT NULL DEFAULT '[]',
  organization_id UUID,
  created_by      VARCHAR(255) NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quote_templates_org
  ON core.quote_templates (organization_id)
  WHERE organization_id IS NOT NULL;

-- Sequence for auto-generated quote numbers when applying a template.
CREATE SEQUENCE IF NOT EXISTS core.quote_number_seq START 1;
