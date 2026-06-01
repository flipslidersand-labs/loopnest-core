import { v4 as uuidv4 } from 'uuid';

export interface AuditLogEntry {
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, any>;
  correlationId?: string;
}

export class AuditService {
  constructor(private pgPool: any) {}

  /**
   * Log an audit entry (operation)
   */
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
      console.error('[AUDIT_ERROR]', error);
      throw error;
    }
  }

  /**
   * Log quote submission
   */
  async logQuoteSubmitted(quoteId: string, userId: string): Promise<void> {
    await this.log({
      actorId: userId,
      action: 'QUOTE_SUBMITTED',
      resourceType: 'quote',
      resourceId: quoteId,
      metadata: { status: 'pending_approval' },
    });
  }

  /**
   * Log quote approval
   */
  async logQuoteApproved(quoteId: string, userId: string): Promise<void> {
    await this.log({
      actorId: userId,
      action: 'QUOTE_APPROVED',
      resourceType: 'quote',
      resourceId: quoteId,
      metadata: { status: 'approved' },
    });
  }

  /**
   * Log quote rejection
   */
  async logQuoteRejected(quoteId: string, userId: string, reason: string): Promise<void> {
    await this.log({
      actorId: userId,
      action: 'QUOTE_REJECTED',
      resourceType: 'quote',
      resourceId: quoteId,
      metadata: { status: 'rejected', reason },
    });
  }

  /**
   * Log invoice creation
   */
  async logInvoiceCreated(invoiceId: string, quoteId: string, userId: string): Promise<void> {
    await this.log({
      actorId: userId,
      action: 'INVOICE_CREATED',
      resourceType: 'invoice',
      resourceId: invoiceId,
      metadata: { sourceQuote: quoteId },
    });
  }

  /**
   * Log resource creation (generic)
   */
  async logResourceCreated(
    resourceType: string,
    resourceId: string,
    userId: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.log({
      actorId: userId,
      action: `${resourceType.toUpperCase()}_CREATED`,
      resourceType,
      resourceId,
      metadata,
    });
  }

  /**
   * Log resource update (generic)
   */
  async logResourceUpdated(
    resourceType: string,
    resourceId: string,
    userId: string,
    changes: Record<string, any>
  ): Promise<void> {
    await this.log({
      actorId: userId,
      action: `${resourceType.toUpperCase()}_UPDATED`,
      resourceType,
      resourceId,
      metadata: { changes },
    });
  }

  /**
   * Log resource deletion (generic)
   */
  async logResourceDeleted(
    resourceType: string,
    resourceId: string,
    userId: string
  ): Promise<void> {
    await this.log({
      actorId: userId,
      action: `${resourceType.toUpperCase()}_DELETED`,
      resourceType,
      resourceId,
    });
  }
}
