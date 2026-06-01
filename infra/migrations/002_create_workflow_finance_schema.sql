-- ============================================
-- M01: Workflow & Finance Schema Tables
-- ============================================

-- finance.invoices (請求書)
CREATE TABLE IF NOT EXISTS finance.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number VARCHAR(50) UNIQUE NOT NULL,
  quote_id UUID NOT NULL REFERENCES core.quotes(id),
  customer_id UUID NOT NULL REFERENCES core.customers(id),
  registration_number VARCHAR(20),
  subtotal_amount NUMERIC(12, 2) NOT NULL,
  tax_amount NUMERIC(12, 2) NOT NULL,
  total_amount NUMERIC(12, 2) NOT NULL,
  issue_date DATE,
  payment_due_date DATE,
  status VARCHAR(50) NOT NULL CHECK (status IN ('issued', 'sent', 'paid', 'cancelled')),
  metadata JSONB,
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invoices_quote ON finance.invoices(quote_id);
CREATE INDEX idx_invoices_customer ON finance.invoices(customer_id);
CREATE INDEX idx_invoices_status ON finance.invoices(status);
CREATE INDEX idx_invoices_invoice_number ON finance.invoices(invoice_number);
CREATE INDEX idx_invoices_issue_date ON finance.invoices(issue_date);

-- finance.invoice_items (請求書明細)
CREATE TABLE IF NOT EXISTS finance.invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES finance.invoices(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES core.products(id),
  quantity INT NOT NULL,
  unit_price NUMERIC(12, 2) NOT NULL,
  line_total NUMERIC(12, 2) NOT NULL,
  notes TEXT
);

CREATE INDEX idx_invoice_items_invoice ON finance.invoice_items(invoice_id);
CREATE INDEX idx_invoice_items_product ON finance.invoice_items(product_id);

-- workflow.approval_requests (承認依頼)
CREATE TABLE IF NOT EXISTS workflow.approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES core.quotes(id),
  total_amount NUMERIC(12, 2) NOT NULL,
  route_type VARCHAR(50) NOT NULL CHECK (route_type IN ('standard', 'high_value')),
  status VARCHAR(50) NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_approval_requests_quote ON workflow.approval_requests(quote_id);
CREATE INDEX idx_approval_requests_status ON workflow.approval_requests(status);
CREATE INDEX idx_approval_requests_route_type ON workflow.approval_requests(route_type);

-- workflow.approval_steps (承認ステップ)
CREATE TABLE IF NOT EXISTS workflow.approval_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_request_id UUID NOT NULL REFERENCES workflow.approval_requests(id) ON DELETE CASCADE,
  step_order INT NOT NULL,
  approver_id UUID NOT NULL REFERENCES core.users(id),
  status VARCHAR(50) NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_at TIMESTAMPTZ,
  comment TEXT
);

CREATE INDEX idx_approval_steps_request ON workflow.approval_steps(approval_request_id);
CREATE INDEX idx_approval_steps_approver ON workflow.approval_steps(approver_id);
CREATE INDEX idx_approval_steps_status ON workflow.approval_steps(status);
