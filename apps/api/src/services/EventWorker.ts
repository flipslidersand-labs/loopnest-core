import { logger } from "../lib/logger.js";
import { RepositoryContainer } from "@loopnest/bizcore-db";
import { randomUUID } from "node:crypto";
import { WebhookService } from "./WebhookService.js";
import { outboxEventLagMs } from "../observability/metrics.js";

function advanceDate(from: string, unit: string, value: number): string {
  const d = new Date(from + 'T00:00:00Z');
  switch (unit) {
    case 'day':   d.setUTCDate(d.getUTCDate() + value); break;
    case 'week':  d.setUTCDate(d.getUTCDate() + value * 7); break;
    case 'month': d.setUTCMonth(d.getUTCMonth() + value); break;
    case 'year':  d.setUTCFullYear(d.getUTCFullYear() + value); break;
  }
  return d.toISOString().slice(0, 10);
}

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
  private expiryTimer: NodeJS.Timeout | null = null;
  private recurringTimer: NodeJS.Timeout | null = null;
  private dunningTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private isScanningOverdue = false;
  private isScanningExpiry = false;
  private isScanningRecurring = false;
  private isScanningDunning = false;
  private readonly accountingApiUrl: string;
  private readonly maxRetries: number;

  constructor(
    private repos: RepositoryContainer,
    private pgPool: {
      query: (text: string, params?: unknown[]) => Promise<any>;
    },
    private webhooks?: WebhookService,
  ) {
    this.accountingApiUrl =
      process.env.MOCK_ACCOUNTING_API_URL || "http://localhost:3991";
    this.maxRetries = Number(process.env.OUTBOX_MAX_RETRIES || 5);
  }

  start(
    intervalMs: number = Number(process.env.EVENT_WORKER_INTERVAL_MS) || 5000,
  ): void {
    logger.info(`🔄 EventWorker started (interval: ${intervalMs}ms)`);
    this.timer = setInterval(() => this.processBatch(), intervalMs);

    // Overdue detection runs on a slower cadence (default hourly) — a payment
    // becoming overdue is a once-a-day transition, not something to poll at 5s.
    const overdueMs =
      Number(process.env.OVERDUE_SCAN_INTERVAL_MS) || 60 * 60 * 1000;
    this.overdueTimer = setInterval(() => this.scanOverdue(), overdueMs);

    // Quote expiry scan — same slow cadence; auto-rejects expired quotes.
    const expiryMs =
      Number(process.env.EXPIRY_SCAN_INTERVAL_MS) || 60 * 60 * 1000;
    this.expiryTimer = setInterval(() => this.scanExpiredQuotes(), expiryMs);
    // Run once at startup to catch any already-expired quotes.
    void this.scanExpiredQuotes();

    const recurringMs =
      Number(process.env.RECURRING_SCAN_INTERVAL_MS) || 60 * 60 * 1000;
    this.recurringTimer = setInterval(() => this.scanRecurring(), recurringMs);
    // Run once immediately at startup so contracts due today are billed without
    // waiting for the first interval tick.
    this.scanRecurring();

    const dunningMs =
      Number(process.env.DUNNING_SCAN_INTERVAL_MS) || 60 * 60 * 1000;
    this.dunningTimer = setInterval(() => this.scanDunning(), dunningMs);
    void this.scanDunning();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('EventWorker stopped');
    }
    if (this.overdueTimer) {
      clearInterval(this.overdueTimer);
      this.overdueTimer = null;
    }
    if (this.expiryTimer) {
      clearInterval(this.expiryTimer);
      this.expiryTimer = null;
    }
    if (this.recurringTimer) {
      clearInterval(this.recurringTimer);
      this.recurringTimer = null;
    }
    if (this.dunningTimer) {
      clearInterval(this.dunningTimer);
      this.dunningTimer = null;
    }
  }

  private async processBatch(): Promise<void> {
    if (this.isProcessing) return;

    this.isProcessing = true;
    try {
      const events = await this.repos.outbox.claimPending(50);

      if (events.length > 0) {
        logger.info(`📨 Processing ${events.length} pending events`);
      }

      for (const event of events) {
        try {
          if (event.createdAt) {
            outboxEventLagMs.observe(Date.now() - new Date(event.createdAt).getTime());
          }
          await this.dispatch(event);
          await this.repos.outbox.markProcessed(event.id);
        } catch (error) {
          logger.error({ eventId: event.id, err: error }, 'failed to dispatch event');
          // Re-queues for retry, or dead-letters after maxRetries.
          await this.repos.outbox.markFailed(event.id, this.maxRetries);
        }
      }
    } catch (error) {
      logger.error({ err: error }, 'EventWorker batch processing error');
    } finally {
      this.isProcessing = false;
    }
  }

  private async dispatch(event: any): Promise<void> {
    const { eventType, aggregateId, payload } = event;

    switch (eventType) {
      case "quote_submitted":
        logger.info(`✅ Quote submitted: ${aggregateId}`);
        break;
      case "quote_approved":
        logger.info(`✅ Quote approved: ${aggregateId}`);
        break;
      case "quote_rejected":
        logger.info(`❌ Quote rejected: ${aggregateId}`);
        break;
      case "invoice_created":
        await this.handleInvoiceCreated(aggregateId, payload);
        break;
      case "payment_recorded":
        logger.info(`💰 Payment recorded for invoice ${aggregateId}`);
        break;
      case "invoice_paid":
        logger.info(`✅ Invoice fully paid: ${aggregateId}`);
        break;
      case "payment_reversed":
        logger.info(`↩️  Payment reversed for invoice ${aggregateId}`);
        break;
      case "payment_overdue":
        logger.info(`⏰ Invoice overdue: ${aggregateId}`);
        break;
      case "credit_note_issued":
        logger.info(`📋 Credit note issued: ${aggregateId}`);
        break;
      case "credit_note_applied":
        logger.info(`credit_note applied to invoice ${payload?.targetInvoiceId}`);
        break;
      case "credit_note_refunded":
        logger.info(`💸 Credit note refunded: ${aggregateId}`);
        break;
      case "credit_note_voided":
        logger.info(`🗑️  Credit note voided: ${aggregateId}`);
        break;
      case "quote_expired":
        logger.info(`⏰ Quote expired: ${aggregateId}`);
        break;
      case "recurring_invoice_created":
        logger.info(`🔁 Recurring invoice created for contract ${aggregateId}: ${payload?.invoiceNumber}`);
        break;
      case "dunning_action":
        console.log(`📬 Dunning action '${payload?.action}' for invoice ${aggregateId} (${payload?.daysOverdue}d overdue)`);
        break;
      default:
        logger.warn(`Unknown event type: ${eventType}`);
    }
  }

  /**
   * M12: auto-generate invoices for recurring contracts whose next_billing_at
   * is today or in the past, then advance next_billing_at by one interval.
   * Contracts that have passed their ends_at are auto-completed first.
   */
  private async scanRecurring(): Promise<void> {
    if (this.isScanningRecurring) return;
    this.isScanningRecurring = true;
    try {
      const today = new Date().toISOString().slice(0, 10);

      // Auto-complete expired contracts before billing.
      await this.repos.recurringContracts.expireCompleted(today);

      const due = await this.repos.recurringContracts.findDue(today);
      for (const contract of due) {
        try {
          await this.billContract(contract, today);
        } catch (err) {
          logger.error({ contractId: contract.id, err }, 'failed to bill contract');
        }
      }
      if (due.length > 0) {
        logger.info(`🔁 Recurring scan billed ${due.length} contract(s)`);
      }
    } catch (error) {
      logger.error({ err: error }, 'recurring scan error');
    } finally {
      this.isScanningRecurring = false;
    }
  }

  private async billContract(contract: any, today: string): Promise<void> {
    const seq = await this.repos.invoices.nextSequenceValue();
    const yyyymm = today.slice(0, 7).replace('-', '');
    const invoiceNumber = `REC-${yyyymm}-${String(seq).padStart(6, '0')}`;

    const subtotal = Math.round(contract.amount * 100) / 100;
    const taxAmount = Math.round(subtotal * contract.taxRate * 100) / 100;
    const totalAmount = Math.round((subtotal + taxAmount) * 100) / 100;

    const invoice = await this.repos.invoices.create({
      quoteId: null,
      contractId: contract.id,
      invoiceNumber,
      customerId: contract.customerId,
      subtotal,
      taxAmount,
      totalAmount,
      createdBy: 'recurring-worker',
    });

    // Advance next_billing_at by one interval.
    const next = advanceDate(contract.nextBillingAt, contract.intervalUnit, contract.intervalValue);
    await this.repos.recurringContracts.advanceNextBilling(contract.id, next);

    // Publish outbox event for observability / downstream hooks.
    await this.repos.outbox.publish('recurring_invoice_created', contract.id, {
      contractId: contract.id,
      invoiceId: invoice.id,
      invoiceNumber,
      customerId: contract.customerId,
      totalAmount,
      billingDate: today,
      nextBillingAt: next,
    });
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
        `SELECT i.id, q.organization_id, i.customer_id, i.total_amount,
                (CURRENT_DATE - i.payment_due_date) AS days_overdue,
                COALESCE(p.paid, 0) AS paid_total,
                COALESCE(cn.applied, 0) AS credit_applied
           FROM finance.invoices i
           LEFT JOIN core.quotes q ON q.id = i.quote_id
           LEFT JOIN (
             SELECT invoice_id, SUM(amount) AS paid
               FROM finance.payments
              WHERE status = 'confirmed'
              GROUP BY invoice_id
           ) p ON p.invoice_id = i.id
           LEFT JOIN (
             SELECT invoice_id, SUM(amount) AS applied
               FROM finance.credit_note_applications
              GROUP BY invoice_id
           ) cn ON cn.invoice_id = i.id
          WHERE i.status IN ('issued', 'sent', 'partially_paid')
            AND i.payment_due_date IS NOT NULL
            AND i.payment_due_date < CURRENT_DATE
            AND NOT EXISTS (
              SELECT 1 FROM events.outbox_events e
               WHERE e.event_type = 'payment_overdue'
                 AND e.aggregate_id = i.id::text
                 AND e.created_at AT TIME ZONE 'UTC' >= CURRENT_DATE
            )`,
      );

      for (const row of rows) {
        const outstanding =
          Math.round(
            (Number(row.total_amount) -
              Number(row.paid_total) -
              Number(row.credit_applied)) *
              100,
          ) / 100;
        if (outstanding <= 0) continue;

        const payload = {
          invoiceId: row.id,
          customerId: row.customer_id,
          daysOverdue: Number(row.days_overdue),
          outstanding,
        };
        await this.repos.outbox.publish("payment_overdue", row.id, payload);
        if (this.webhooks && row.organization_id) {
          this.webhooks
            .deliver(row.organization_id, "payment.overdue", payload)
            .catch((err) =>
              logger.error({ invoiceId: row.id, err }, 'overdue webhook delivery failed'),
            );
        }
      }

      if (rows.length > 0) {
        logger.info(`⏰ Overdue scan flagged ${rows.length} invoice(s)`);
      }
    } catch (error) {
      logger.error({ err: error }, 'overdue scan error');
    } finally {
      this.isScanningOverdue = false;
    }
  }

  /**
   * Export an invoice to the (mock) accounting system and record the outcome in
   * finance.accounting_exports. Throws on failure so the outbox retries — this
   * is the reliability contract: a failed export must NOT be silently dropped.
   */
  private async handleInvoiceCreated(
    quoteId: string,
    payload: any,
  ): Promise<void> {
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload),
      });
    } catch (err) {
      await this.recordExport(
        payload.invoiceId,
        "failed",
        requestPayload,
        null,
        String(err),
      );
      throw new Error(`accounting API unreachable: ${err}`);
    }

    const responseBody = await response.json().catch((err) => {
      console.error('response JSON parse failed', { operation: 'response.json', invoiceId: payload.invoiceId, statusCode: response.status, error: String(err) });
      return null;
    });

    if (!response.ok) {
      await this.recordExport(
        payload.invoiceId,
        "failed",
        requestPayload,
        responseBody,
        `accounting API returned ${response.status}`,
      );
      throw new Error(`accounting API returned ${response.status}`);
    }

    await this.recordExport(
      payload.invoiceId,
      "success",
      requestPayload,
      responseBody,
      null,
    );
    logger.info(`exported invoice ${payload.invoiceNumber} to accounting API`);
  }

  private async recordExport(
    invoiceId: string,
    status: "success" | "failed",
    requestPayload: unknown,
    responsePayload: unknown,
    errorMessage: string | null,
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
        ],
      );
    } catch (err) {
      // Recording the export must not mask the dispatch result; just log.
      logger.error({ err }, 'failed to record accounting_export');
    }
  }

  /**
   * M09: auto-reject quotes that have passed their expires_at.
   * Transitions draft/pending_approval → rejected and enqueues a quote_expired event.
   * Idempotent: only quotes still in an actionable status are touched.
   */
  private async scanExpiredQuotes(): Promise<void> {
    if (this.isScanningExpiry) return;
    this.isScanningExpiry = true;
    try {
      const expired = await this.repos.quotes.findExpired();
      for (const quote of expired) {
        try {
          const result = await this.repos.quotes.transitionStatus(
            quote.id,
            quote.status as any,
            'rejected',
            { notes: `Auto-rejected: quote expired at ${quote.expiresAt?.toISOString()}` },
          );
          if (result) {
            await this.repos.outbox.publish('quote_expired', quote.id, {
              quoteId: quote.id,
              quoteNumber: quote.quoteNumber,
              expiredAt: quote.expiresAt?.toISOString(),
            });
            logger.info(`⏰ Quote expired and auto-rejected: ${quote.quoteNumber}`);
          }
        } catch (err) {
          logger.error({ quoteId: quote.id, err }, 'failed to expire quote');
        }
      }
      if (expired.length > 0) {
        logger.info(`⏰ Expiry scan: auto-rejected ${expired.length} quote(s)`);
      }
    } catch (error) {
      logger.error({ err: error }, 'quote expiry scan error');
    } finally {
      this.isScanningExpiry = false;
    }
  }

  /**
   * M15: For each overdue invoice, apply matching dunning rules that haven't
   * fired yet. Records a dunning_log row (UNIQUE constraint prevents duplicates)
   * and publishes a dunning_action outbox event + webhook per rule fired.
   */
  private async scanDunning(): Promise<void> {
    if (this.isScanningDunning) return;
    this.isScanningDunning = true;
    try {
      const { rows } = await this.pgPool.query(
        `SELECT i.id, i.invoice_number, i.customer_id, i.total_amount,
                q.organization_id,
                (CURRENT_DATE - i.payment_due_date)::int AS days_overdue,
                COALESCE(p.paid, 0) AS paid_total,
                COALESCE(cn.applied, 0) AS credit_applied
           FROM finance.invoices i
           LEFT JOIN core.quotes q ON q.id = i.quote_id
           LEFT JOIN (
             SELECT invoice_id, SUM(amount) AS paid
               FROM finance.payments WHERE status = 'confirmed'
              GROUP BY invoice_id
           ) p ON p.invoice_id = i.id
           LEFT JOIN (
             SELECT invoice_id, SUM(amount) AS applied
               FROM finance.credit_note_applications
              GROUP BY invoice_id
           ) cn ON cn.invoice_id = i.id
          WHERE i.status IN ('issued', 'sent')
            AND i.payment_due_date IS NOT NULL
            AND i.payment_due_date < CURRENT_DATE`,
      );

      let fired = 0;
      for (const row of rows) {
        const outstanding =
          Math.round((Number(row.total_amount) - Number(row.paid_total) - Number(row.credit_applied)) * 100) / 100;
        if (outstanding <= 0) continue;

        const daysOverdue = Number(row.days_overdue);
        const pending = await this.repos.dunning.findPendingRules(row.id, daysOverdue);

        for (const rule of pending) {
          try {
            await this.repos.dunning.recordLog(row.id, rule, daysOverdue);

            const message = (rule.messageTemplate ?? '')
              .replace('{{invoice_number}}', row.invoice_number);

            const payload = {
              invoiceId: row.id,
              invoiceNumber: row.invoice_number,
              customerId: row.customer_id,
              daysOverdue,
              outstanding,
              action: rule.action,
              ruleId: rule.id,
              ruleName: rule.name,
              message,
            };

            await this.repos.outbox.publish('dunning_action', row.id, payload);

            if (this.webhooks && row.organization_id) {
              this.webhooks
                .deliver(row.organization_id, 'dunning.action', payload)
                .catch((err: any) =>
                  console.error('[DUNNING_WEBHOOK_ERROR]', row.id, err?.message),
                );
            }
            fired++;
          } catch (err: any) {
            if (err?.code === '23505') continue; // unique constraint — already logged
            console.error(`[DUNNING] Failed rule ${rule.id} for invoice ${row.id}:`, err);
          }
        }
      }

      if (fired > 0) console.log(`📬 Dunning scan fired ${fired} action(s)`);
    } catch (error) {
      console.error('❌ Error in dunning scan:', error);
    } finally {
      this.isScanningDunning = false;
    }
  }
}
