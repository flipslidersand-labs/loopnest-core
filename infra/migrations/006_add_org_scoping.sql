-- M07: Add organization_id to tenant-scoped tables (nullable for backward compat).
ALTER TABLE core.customers
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES core.organizations(id);
ALTER TABLE core.products
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES core.organizations(id);
ALTER TABLE core.quotes
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES core.organizations(id);

CREATE INDEX IF NOT EXISTS idx_customers_org ON core.customers(organization_id);
CREATE INDEX IF NOT EXISTS idx_products_org  ON core.products(organization_id);
CREATE INDEX IF NOT EXISTS idx_quotes_org    ON core.quotes(organization_id);
