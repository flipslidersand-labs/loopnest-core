-- M10: Webhook registrations per organisation.
CREATE TABLE IF NOT EXISTS events.webhooks (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID    REFERENCES core.organizations(id) ON DELETE CASCADE,
  url             VARCHAR(500) NOT NULL,
  events          TEXT[]  NOT NULL DEFAULT '{}',  -- ['quote.submitted','*', ...]
  secret          VARCHAR(200),                   -- HMAC-SHA256 signing secret
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhooks_org    ON events.webhooks(organization_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_active ON events.webhooks(is_active);
