import { RepositoryContainer } from '@loopnest/bizcore-db';
import { randomUUID } from 'node:crypto';
import { WebhookService } from './WebhookService.js';

/**
 * Polls the transactional outbox and dispatches events to their side effects.
 *
 * Delivery is at-least-once: a successful dispatch marks the event `processed`;
 * a failed dispatch goes through OutboxRepository.markFailed, which re-queues it
 * (`pending`) for retry until it exhausts its budget and is dead-lettered
 * (`failed`). Handlers must therefore be idempotent on the downstream side.
 */
export class EventWorker {
  private timer: NodeJS.Timeout | null = null;
  private overdueTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private isScanningOverdue = false;
  private readonly accountingApiUrl: string;
  private readonly maxRetries: number;

  constructor(
    private repos: RepositoryContainer,
    private pgPool: { query: (text: string, params?: unknown[]) => Promise<any> },
    private webhooks?: WebhookService
  ) {
    this.accountingApiUrl = process.env.MOCK_ACCOUNTING_API_URL || 'http://localhost:3991';
    this.maxRetries = Number(process.env.OUTBOX_MAX_RETRIES || 5);
  }

  start(intervalMs: number = Number(process.env.EVENT_WORKER_INTERVAL_MS) || 5000): void {
    console.log(`🔄 EventWorker started (interval: ${intervalMs}ms)`);
    this.timer = setInterval(() => this.processBatch(), intervalMs);

    // Overdue detection runs on a slower cadence (default hourly) — a payment
    // becoming overdue is a once-a-day transition, not something to poll at 5s.
    const overdueMs = Number(process.env.OVERDUE_SCAN_INTERVAL_MS) || 60 * 60 * 1000;
    this.overdueTimer = setInterval(() => this.scanOverdue(), overdueMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('⏸️  EventWorker stopped');
    }
    if (this.overdueTimer) {
      clearInterval(this.overdueTimer);
      this.overdueTimer = null;
    }
  }

  private async processBatch(): Promise<void> {
    if (this.isProcessing) return;

    this.isProcessing = true;
    try {
      const events = await this.repos.outbox.claimPending(50);

      if (events.length > 0) {
        console.log(`📨 Processing ${events.length} pending events`);
      }

      for (const event of events) {
        try {
          await this.dispatch(event);
          await this.repos.outbox.markProcessed(event.id);
        } catch (error) {
          console.error(`❌ Failed to dispatch event ${event.id}:`, error);
          // Re-queues for retry, or dead-letters after maxRetries.
          await this.repos.outbox.markFailed(event.id, this.maxRetries);
        }
      }
    } catch (error) {
      console.error('❌ Error in EventWorker batch processing:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  private async dispatch(event: any): Promise<void> {
    const { eventType, aggregateId, payload } = event;

    switch (eventType) {
      case 'quote_submitted':
        console.log(`✅ Quote submitted: ${aggregateId}`);
        break;
      case 'quote_approved':
        console.log(`✅ Quote approved: ${aggregateId}`);
        break;
      case 'quote_rejected':
        console.log(`❌ Quote rejected: ${aggregateId}`);
        break;
      case 'invoice_created':
        await this.handleInvoiceCreated(aggregateId, payload);
        break;
      case 'payment_recorded':
        console.log(`💰 Payment recorded for invoice ${aggregateId}`);
        break;
      case 'invoice_paid':
        console.log(`✅ Invoice fully paid: ${aggregateId}`);
        break;
      case 'payment_reversed':
        console.log(`↩️  Payment reversed for invoice ${aggregateId}`);
        break;
      case 'payment_overdue':
        console.log(`⏰ Invoice overdue: ${aggregateId}`);
        break;
      default:
        console.warn(`Unknown event type: ${eventType}`);
    }
  }

  /**
   * M13: detect invoices past their payment_due_date that still carry an
   * outstanding balance, and emit a `payment_overdue` event (durable outbox row)
   * plus a fire-and-forget `payment.overdue` webhook. Dedup is by invoice per
   * UTC day, so re-running the scan does not spam duplicate alerts.
   */
  private async scanOverdue(): Promise<void> {
    if (this.isScanningOverdue) return;
    this.isScanningOverdue = true;
    try {
      const { rows } = await this.pgPool.query(
        `SELECT i.id, i.organization_id, i.customer_id, i.total_amount,
                (CURRENT_DATE - i.payment_due_date) AS days_overdue
           FROM finance.invoices i
          WHERE i.status IN ('issued', 'sent', 'partially_paid')
            AND i.payment_due_date IS NOT NULL
            AND i.payment_due_date < CURRENT_DATE
            AND NOT EXISTS (
              SELECT 1 FROM events.outbox_events e
               WHERE e.event_type = 'payment_overdue'
                 AND e.aggregate_id = i.id::text
                 AND e.created_at::date = CURRENT_DATE
            )`
      );

      for (const row of rows) {
        const paid = await this.repos.payments.confirmedTotal(row.id);
        const outstanding = Math.round((Number(row.total_amount) - paid) * 100) / 100;
        if (outstanding <= 0) continue;

        const payload = {
          invoiceId: row.id,
          customerId: row.customer_id,
          daysOverdue: Number(row.days_overdue),
          outstanding,
        };
        await this.repos.outbox.publish('payment_overdue', row.id, payload);
        if (this.webhooks && row.organization_id) {
          this.webhooks
            .deliver(row.organization_id, 'payment.overdue', payload)
            .catch((err) => console.error('[OVERDUE_WEBHOOK_ERROR]', row.id, err?.message));
        }
      }

      if (rows.length > 0) {
        console.log(`⏰ Overdue scan flagged ${rows.length} invoice(s)`);
      }
    } catch (error) {
      console.error('❌ Error in overdue scan:', error);
    } finally {
      this.isScanningOverdue = false;
    }
  }

  /**
   * Export an invoice to the (mock) accounting system and record the outcome in
   * finance.accounting_exports. Throws on failure so the outbox retries — this
   * is the reliability contract: a failed export must NOT be silently dropped.
   */
  private async handleInvoiceCreated(quoteId: string, payload: any): Promise<void> {
    const requestPayload = {
      quoteId,
      invoiceId: payload.invoiceId,
      invoiceNumber: payload.invoiceNumber,
      customerId: payload.customerId,
      totalAmount: payload.totalAmount,
      exportedAt: new Date().toISOString(),
    };

    let response: Response;
    try {
      response = await fetch(`${this.accountingApiUrl}/api/exports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
      });
    } catch (err) {
      await this.recordExport(payload.invoiceId, 'failed', requestPayload, null, String(err));
      throw new Error(`accounting API unreachable: ${err}`);
    }

    const responseBody = await response.json().catch(() => null);

    if (!response.ok) {
      await this.recordExport(
        payload.invoiceId,
        'failed',
        requestPayload,
        responseBody,
        `accounting API returned ${response.status}`
      );
      throw new Error(`accounting API returned ${response.status}`);
    }

    await this.recordExport(payload.invoiceId, 'success', requestPayload, responseBody, null);
    console.log(`📤 Exported invoice ${payload.invoiceNumber} to accounting API`);
  }

  private async recordExport(
    invoiceId: string,
    status: 'success' | 'failed',
    requestPayload: unknown,
    responsePayload: unknown,
    errorMessage: string | null
  ): Promise<void> {
    try {
      await this.pgPool.query(
        `INSERT INTO finance.accounting_exports
           (id, invoice_id, exported_at, status, request_payload, response_payload, error_message)
         VALUES ($1, $2, NOW(), $3, $4, $5, $6)`,
        [
          randomUUID(),
          invoiceId,
          status,
          JSON.stringify(requestPayload),
          responsePayload ? JSON.stringify(responsePayload) : null,
          errorMessage,
        ]
      );
    } catch (err) {
      // Recording the export must not mask the dispatch result; just log.
      console.error('Failed to record accounting_export:', err);
    }
  }
}
