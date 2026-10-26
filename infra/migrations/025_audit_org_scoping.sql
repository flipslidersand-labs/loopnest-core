-- Issue #286: audit.audit_logs / audit.request_logs had no tenant column, so any
-- org admin could read every tenant's logs. Add organization_id (nullable: rows
-- written before this migration and unauthenticated requests stay NULL and are
-- visible only to global admins, i.e. tokens without orgId).
ALTER TABLE audit.audit_logs
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES core.organizations(id);
ALTER TABLE audit.request_logs
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES core.organizations(id);

-- Best-effort backfill of existing audit rows from the acting user.
UPDATE audit.audit_logs a
   SET organization_id = u.organization_id
  FROM core.users u
 WHERE a.organization_id IS NULL AND u.id::text = a.actor_id;

CREATE INDEX IF NOT EXISTS idx_audit_logs_org ON audit.audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_org ON audit.request_logs(organization_id);
