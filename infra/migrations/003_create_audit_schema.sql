-- ============================================
-- M01: Audit Schema Tables
-- ============================================

-- audit.audit_logs (操作ログ)
CREATE TABLE IF NOT EXISTS audit.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id VARCHAR(255) NOT NULL,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50) NOT NULL,
  resource_id UUID NOT NULL,
  metadata JSONB,
  correlation_id VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit.audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_type ON audit.audit_logs(resource_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_correlation ON audit.audit_logs(correlation_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit.audit_logs(created_at DESC);

-- audit.request_logs (リクエストログ)
CREATE TABLE IF NOT EXISTS audit.request_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  method VARCHAR(10) NOT NULL,
  path VARCHAR(500) NOT NULL,
  status_code INT NOT NULL,
  duration_ms INT NOT NULL,
  correlation_id VARCHAR(100),
  actor_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_request_logs_correlation ON audit.request_logs(correlation_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_method_path ON audit.request_logs(method, path);
CREATE INDEX IF NOT EXISTS idx_request_logs_status_code ON audit.request_logs(status_code);
CREATE INDEX IF NOT EXISTS idx_request_logs_created_at ON audit.request_logs(created_at DESC);
