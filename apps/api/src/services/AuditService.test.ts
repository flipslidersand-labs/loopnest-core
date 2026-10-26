import { describe, it, expect, vi } from 'vitest';
import { AuditService } from './AuditService.js';

function makePool() {
  return { query: vi.fn().mockResolvedValue({ rows: [{ count: '0' }] }) } as any;
}

describe('AuditService tenant isolation (#286)', () => {
  it('queryLogs/countLogs filter by organization_id when given', async () => {
    const pool = makePool();
    const svc = new AuditService(pool);
    await svc.queryLogs({ organizationId: 'org-a' });
    await svc.countLogs({ organizationId: 'org-a' });
    for (const [sql, params] of pool.query.mock.calls) {
      expect(sql).toContain('organization_id = $1');
      expect(params[0]).toBe('org-a');
    }
  });

  it('queryRequestLogs/countRequestLogs filter by organization_id when given', async () => {
    const pool = makePool();
    const svc = new AuditService(pool);
    await svc.queryRequestLogs({ organizationId: 'org-a', method: 'get' });
    await svc.countRequestLogs({ organizationId: 'org-a' });
    for (const [sql, params] of pool.query.mock.calls) {
      expect(sql).toContain('organization_id = $1');
      expect(params[0]).toBe('org-a');
    }
  });

  it('no organizationId (global admin) adds no org condition', async () => {
    const pool = makePool();
    await new AuditService(pool).queryLogs({});
    expect(pool.query.mock.calls[0][0]).not.toContain('organization_id');
  });

  it('getResourceHistory scopes by org', async () => {
    const pool = makePool();
    await new AuditService(pool).getResourceHistory('quote', 'q1', 'org-a');
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('organization_id = $3');
    expect(params).toEqual(['quote', 'q1', 'org-a']);
  });

  it('log() records the actor\'s organization', async () => {
    const pool = makePool();
    await new AuditService(pool).log({ actorId: 'u1', action: 'X', resourceType: 'quote', resourceId: 'q1' });
    expect(pool.query.mock.calls[0][0]).toContain('FROM core.users WHERE id::text = $2::text');
  });
});
