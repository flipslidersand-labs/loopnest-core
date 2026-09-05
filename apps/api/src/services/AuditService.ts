import { v4 as uuidv4 } from 'uuid';
import { logger } from '../lib/logger.js';
import type { PgPool } from '../lib/pg-pool-types.js';

export interface AuditLogEntry {
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
  correlationId?: string;
}

export interface AuditLogRecord {
  id: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: Record<string, unknown> | null;
  correlationId: string | null;
  createdAt: Date;
}

export interface RequestLogRecord {
  id: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  correlationId: string | null;
  actorId: string | null;
  createdAt: Date;
}

export interface AuditLogFilter {
  actorId?: string;
  resourceType?: string;
  resourceId?: string;
  action?: string;
  dateFrom?: string;
  dateTo?: string;
  skip?: number;
  take?: number;
}

export interface RequestLogFilter {
  actorId?: string;
  statusCode?: number;
  method?: string;
  path?: string;
  dateFrom?: string;
  dateTo?: string;
  skip?: number;
  take?: number;
}

export class AuditService {
  constructor(private readonly pgPool: PgPool) {}

  async log(entry: AuditLogEntry): Promise<void> {
    const correlationId = entry.correlationId || uuidv4();
    const id = uuidv4();

    try {
      await this.pgPool.query(
        `INSERT INTO audit.audit_logs
           (id, actor_id, action, resource_type, resource_id, metadata, correlation_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          id,
          entry.actorId,
          entry.action,
          entry.resourceType,
          entry.resourceId,
          JSON.stringify(entry.metadata ?? {}),
          correlationId,
        ]
      );
    } catch (error) {
      logger.error({ err: error }, 'audit log write failed');
      throw error;
    }
  }

  // ── Query methods ───────────────────────────────────────────────────────────

  async queryLogs(filter: AuditLogFilter = {}): Promise<AuditLogRecord[]> {
    const { conditions, params } = this.buildLogConditions(filter);
    const skip = filter.skip ?? 0;
    const take = filter.take ?? 20;
    params.push(take, skip);
    const limitParam = params.length - 1;
    const offsetParam = params.length;

    const sql = `
      SELECT id, actor_id, action, resource_type, resource_id, metadata, correlation_id, created_at
      FROM audit.audit_logs
      ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
      ORDER BY created_at DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `;
    const result = await this.pgPool.query(sql, params);
    return result.rows.map(this.mapLogRow);
  }

  async countLogs(filter: AuditLogFilter = {}): Promise<number> {
    const { conditions, params } = this.buildLogConditions(filter);
    const sql = `
      SELECT COUNT(*) FROM audit.audit_logs
      ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
    `;
    const result = await this.pgPool.query(sql, params);
    return Number.parseInt(result.rows[0].count as string, 10);
  }

  async getResourceHistory(resourceType: string, resourceId: string): Promise<AuditLogRecord[]> {
    const result = await this.pgPool.query(
      `SELECT id, actor_id, action, resource_type, resource_id, metadata, correlation_id, created_at
       FROM audit.audit_logs
       WHERE resource_type = $1 AND resource_id = $2
       ORDER BY created_at ASC`,
      [resourceType, resourceId]
    );
    return result.rows.map(this.mapLogRow);
  }

  async queryRequestLogs(filter: RequestLogFilter = {}): Promise<RequestLogRecord[]> {
    const { conditions, params } = this.buildRequestConditions(filter);
    const skip = filter.skip ?? 0;
    const take = filter.take ?? 20;
    params.push(take, skip);
    const limitParam = params.length - 1;
    const offsetParam = params.length;

    const sql = `
      SELECT id, method, path, status_code, duration_ms, correlation_id, actor_id, created_at
      FROM audit.request_logs
      ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
      ORDER BY created_at DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `;
    const result = await this.pgPool.query(sql, params);
    return result.rows.map(this.mapRequestRow);
  }

  async countRequestLogs(filter: RequestLogFilter = {}): Promise<number> {
    const { conditions, params } = this.buildRequestConditions(filter);
    const sql = `
      SELECT COUNT(*) FROM audit.request_logs
      ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
    `;
    const result = await this.pgPool.query(sql, params);
    return Number.parseInt(result.rows[0].count as string, 10);
  }

  // ── Convenience log helpers ─────────────────────────────────────────────────

  async logQuoteSubmitted(quoteId: string, userId: string): Promise<void> {
    await this.log({ actorId: userId, action: 'QUOTE_SUBMITTED', resourceType: 'quote', resourceId: quoteId, metadata: { status: 'pending_approval' } });
  }

  async logQuoteApproved(quoteId: string, userId: string): Promise<void> {
    await this.log({ actorId: userId, action: 'QUOTE_APPROVED', resourceType: 'quote', resourceId: quoteId, metadata: { status: 'approved' } });
  }

  async logQuoteRejected(quoteId: string, userId: string, reason: string): Promise<void> {
    await this.log({ actorId: userId, action: 'QUOTE_REJECTED', resourceType: 'quote', resourceId: quoteId, metadata: { status: 'rejected', reason } });
  }

  async logInvoiceCreated(invoiceId: string, quoteId: string, userId: string): Promise<void> {
    await this.log({ actorId: userId, action: 'INVOICE_CREATED', resourceType: 'invoice', resourceId: invoiceId, metadata: { sourceQuote: quoteId } });
  }

  async logResourceCreated(resourceType: string, resourceId: string, userId: string, metadata?: Record<string, unknown>): Promise<void> {
    await this.log({ actorId: userId, action: `${resourceType.toUpperCase()}_CREATED`, resourceType, resourceId, metadata });
  }

  async logResourceUpdated(resourceType: string, resourceId: string, userId: string, changes: Record<string, unknown>): Promise<void> {
    await this.log({ actorId: userId, action: `${resourceType.toUpperCase()}_UPDATED`, resourceType, resourceId, metadata: { changes } });
  }

  async logResourceDeleted(resourceType: string, resourceId: string, userId: string): Promise<void> {
    await this.log({ actorId: userId, action: `${resourceType.toUpperCase()}_DELETED`, resourceType, resourceId });
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private buildLogConditions(f: AuditLogFilter): { conditions: string[]; params: unknown[] } {
    const conditions: string[] = [];
    const params: unknown[] = [];
    const p = () => `$${params.length}`;

    if (f.actorId)       { params.push(f.actorId);       conditions.push(`actor_id = ${p()}`); }
    if (f.resourceType)  { params.push(f.resourceType);  conditions.push(`resource_type = ${p()}`); }
    if (f.resourceId)    { params.push(f.resourceId);    conditions.push(`resource_id = ${p()}`); }
    if (f.action)        { params.push(f.action);        conditions.push(`action = ${p()}`); }
    if (f.dateFrom)      { params.push(f.dateFrom);      conditions.push(`created_at >= ${p()}`); }
    if (f.dateTo)        { params.push(f.dateTo);        conditions.push(`created_at <= ${p()}`); }

    return { conditions, params };
  }

  private buildRequestConditions(f: RequestLogFilter): { conditions: string[]; params: unknown[] } {
    const conditions: string[] = [];
    const params: unknown[] = [];
    const p = () => `$${params.length}`;

    if (f.actorId)    { params.push(f.actorId);    conditions.push(`actor_id = ${p()}`); }
    if (f.statusCode) { params.push(f.statusCode); conditions.push(`status_code = ${p()}`); }
    if (f.method)     { params.push(f.method.toUpperCase()); conditions.push(`method = ${p()}`); }
    if (f.path)       { params.push(f.path + '%'); conditions.push(`path LIKE ${p()}`); }
    if (f.dateFrom)   { params.push(f.dateFrom);   conditions.push(`created_at >= ${p()}`); }
    if (f.dateTo)     { params.push(f.dateTo);     conditions.push(`created_at <= ${p()}`); }

    return { conditions, params };
  }

  private mapLogRow(row: Record<string, unknown>): AuditLogRecord {
    return {
      id: row.id as string,
      actorId: row.actor_id as string,
      action: row.action as string,
      resourceType: row.resource_type as string,
      resourceId: row.resource_id as string,
      metadata: row.metadata as Record<string, unknown> | null,
      correlationId: row.correlation_id as string | null,
      createdAt: row.created_at as Date,
    };
  }

  private mapRequestRow(row: Record<string, unknown>): RequestLogRecord {
    return {
      id: row.id as string,
      method: row.method as string,
      path: row.path as string,
      statusCode: row.status_code as number,
      durationMs: row.duration_ms as number,
      correlationId: row.correlation_id as string | null,
      actorId: row.actor_id as string | null,
      createdAt: row.created_at as Date,
    };
  }
}
