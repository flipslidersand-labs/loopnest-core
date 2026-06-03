-- ============================================
-- M01: Core Schema Tables
-- ============================================

-- core.organizations (組織マスタ)
CREATE TABLE IF NOT EXISTS core.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  type VARCHAR(50) NOT NULL CHECK (type IN ('company', 'department', 'division')),
  parent_id UUID REFERENCES core.organizations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organizations_parent ON core.organizations(parent_id);

-- core.users (スタッフマスタ)
CREATE TABLE IF NOT EXISTS core.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  name_en VARCHAR(100),
  email VARCHAR(200) UNIQUE NOT NULL,
  organization_id UUID NOT NULL REFERENCES core.organizations(id),
  role VARCHAR(50) NOT NULL CHECK (role IN ('director', 'manager', 'senior', 'sales_rep')),
  profile JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON core.users(email);
CREATE INDEX IF NOT EXISTS idx_users_organization ON core.users(organization_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON core.users(role);

-- core.customers (顧客マスタ)
CREATE TABLE IF NOT EXISTS core.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  name_kana VARCHAR(200),
  registration_number VARCHAR(20),
  postal_code VARCHAR(10),
  address TEXT,
  phone VARCHAR(20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_name ON core.customers(name);
CREATE INDEX IF NOT EXISTS idx_customers_registration ON core.customers(registration_number);

-- core.products (商品マスタ)
CREATE TABLE IF NOT EXISTS core.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(100) NOT NULL CHECK (category IN ('laptop', 'desktop', 'server', 'network')),
  unit_price NUMERIC(12, 2) NOT NULL,
  stock_quantity INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_sku ON core.products(sku);
CREATE INDEX IF NOT EXISTS idx_products_category ON core.products(category);

-- core.quote_requests (見積依頼)
CREATE TABLE IF NOT EXISTS core.quote_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES core.customers(id),
  requested_by VARCHAR(100) NOT NULL,
  contact_email VARCHAR(200),
  requested_items JSONB NOT NULL,
  notes TEXT,
  status VARCHAR(50) NOT NULL CHECK (status IN ('received', 'quoted', 'closed')),
  created_by UUID NOT NULL REFERENCES core.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quote_requests_customer ON core.quote_requests(customer_id);
CREATE INDEX IF NOT EXISTS idx_quote_requests_status ON core.quote_requests(status);
CREATE INDEX IF NOT EXISTS idx_quote_requests_created_by ON core.quote_requests(created_by);

-- core.quotes (見積)
CREATE TABLE IF NOT EXISTS core.quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number VARCHAR(50) UNIQUE NOT NULL,
  quote_request_id UUID REFERENCES core.quote_requests(id),
  customer_id UUID NOT NULL REFERENCES core.customers(id),
  subtotal_amount NUMERIC(12, 2) NOT NULL,
  tax_amount NUMERIC(12, 2) NOT NULL,
  total_amount NUMERIC(12, 2) NOT NULL,
  status VARCHAR(50) NOT NULL CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected', 'invoiced')),
  notes TEXT,
  created_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotes_customer ON core.quotes(customer_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON core.quotes(status);
CREATE INDEX IF NOT EXISTS idx_quotes_created_by ON core.quotes(created_by);
CREATE INDEX IF NOT EXISTS idx_quotes_quote_number ON core.quotes(quote_number);

-- core.quote_items (見積明細)
CREATE TABLE IF NOT EXISTS core.quote_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES core.quotes(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES core.products(id),
  quantity INT NOT NULL,
  unit_price NUMERIC(12, 2) NOT NULL,
  line_total NUMERIC(12, 2) NOT NULL,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON core.quote_items(quote_id);
CREATE INDEX IF NOT EXISTS idx_quote_items_product ON core.quote_items(product_id);

-- core.accounting_exports (会計連携記録)
CREATE TABLE IF NOT EXISTS finance.accounting_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL,
  exported_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(50) NOT NULL CHECK (status IN ('success', 'failed')),
  request_payload JSONB NOT NULL,
  response_payload JSONB,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_accounting_exports_invoice ON finance.accounting_exports(invoice_id);
CREATE INDEX IF NOT EXISTS idx_accounting_exports_status ON finance.accounting_exports(status);
