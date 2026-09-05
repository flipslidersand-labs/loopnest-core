import { randomUUID } from "crypto";
import {
  RepositoryContainer,
  PaymentRecord,
  PaymentMethod,
  PaymentFilter,
} from "@loopnest/bizcore-db";
import type { KyselyDatabase } from "@loopnest/bizcore-db";
import { ApiErrorResponse } from "../middleware/errorHandler.js";
import type { Kysely } from "kysely";

const METHODS: PaymentMethod[] = [
  "bank_transfer",
  "credit_card",
  "cash",
  "offset",
];

export interface RecordPaymentInput {
  amount: number;
  method: PaymentMethod;
  paidOn?: string; // ISO date (YYYY-MM-DD); defaults to today
  reference?: string | null;
}

export interface InvoiceBalance {
  invoiceId: string;
  totalAmount: number;
  paidTotal: number;
  outstanding: number;
  status: string;
}

export interface RecordPaymentResult {
  payment: PaymentRecord;
  balance: InvoiceBalance;
}

/** Round to 2 decimal places — money is always NUMERIC(12,2). */
function money(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Payments & Accounts Receivable (M13). Records payments against finance.invoices,
 * supporting partial payments and reversals. Invoice balance and status are
 * derived from the confirmed payments ledger rather than stored, so they can
 * never drift. Each mutation runs in a single Kysely transaction that locks the
 * invoice row (FOR UPDATE) and enqueues outbox events atomically, matching the
 * at-least-once delivery guarantees the rest of the platform relies on.
 */
export class PaymentService {
  constructor(
    private repos: RepositoryContainer,
    private db: Kysely<KyselyDatabase>,
  ) {}

  private async enqueue(
    trx: Kysely<KyselyDatabase>,
    eventType: string,
    aggregateId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await trx
      .insertInto("events.outbox_events")
      .values({
        id: randomUUID(),
        event_type: eventType,
        aggregate_id: aggregateId,
        payload,
        status: "pending",
        created_at: new Date(),
      })
      .execute();
  }

  /**
   * Resolve the owning org for an invoice. finance.invoices is not org-tagged
   * (M07 scoped core tables only), so the org is inherited from the originating
   * quote. Used to stamp payments and enforce tenant isolation.
   */
  private async resolveInvoiceOrg(trx: Kysely<KyselyDatabase>, inv: { organization_id?: string | null; quote_id?: string | null }): Promise<string | null> {
    if (inv.organization_id) return inv.organization_id;
    if (!inv.quote_id) return null;
    const q = await trx
      .selectFrom("core.quotes")
      .select("organization_id")
      .where("id", "=", inv.quote_id)
      .executeTakeFirst();
    return q?.organization_id ?? null;
  }

  private deriveStatus(
    currentStatus: string,
    paidTotal: number,
    total: number,
  ): string {
    if (money(total - paidTotal) <= 0) return "paid";
    if (paidTotal > 0) return "partially_paid";
    // No confirmed payments left: step back out of a paid/partial state.
    if (currentStatus === "paid" || currentStatus === "partially_paid")
      return "sent";
    return currentStatus;
  }

  /** Record a (possibly partial) payment and advance the invoice status. */
  async recordPayment(
    invoiceId: string,
    input: RecordPaymentInput,
    userId: string,
  ): Promise<RecordPaymentResult> {
    if (typeof input.amount !== "number" || !(input.amount > 0)) {
      throw new ApiErrorResponse(
        400,
        "VALIDATION_ERROR",
        "amount must be a positive number",
      );
    }
    if (!METHODS.includes(input.method)) {
      throw new ApiErrorResponse(
        400,
        "VALIDATION_ERROR",
        `method must be one of: ${METHODS.join(", ")}`,
      );
    }
    const paidOn = input.paidOn ?? new Date().toISOString().slice(0, 10);

    // Captured inside the transaction for post-commit credit adjustment.
    let paidCustomerId: string | null = null;
    let creditDecrement: number | null = null;

    const result = await this.db.transaction().execute(async (trx) => {
      const inv = await trx
        .selectFrom("finance.invoices")
        .selectAll()
        .where("id", "=", invoiceId)
        .forUpdate()
        .executeTakeFirst();

      if (!inv) {
        throw new ApiErrorResponse(404, "NOT_FOUND", "Invoice not found");
      }
      if (inv.status === "cancelled") {
        throw new ApiErrorResponse(
          409,
          "INVALID_STATUS",
          "Cannot record payment on a cancelled invoice",
        );
      }

      const total = parseFloat(inv.total_amount.toString());
      const priorPaid = await this.repos.payments.confirmedTotal(
        invoiceId,
        trx,
      );
      const priorCredit = await this.repos.creditNotes.creditAppliedToInvoice(
        invoiceId,
        trx,
      );
      const outstanding = money(total - priorPaid - priorCredit);

      if (input.amount > outstanding + 0.001) {
        throw new ApiErrorResponse(
          409,
          "OVERPAYMENT",
          `Payment ${input.amount} exceeds outstanding balance ${outstanding}`,
        );
      }

      const organizationId = await this.resolveInvoiceOrg(trx, inv);
      const payment = await this.repos.payments.insert(
        {
          invoiceId,
          organizationId,
          amount: input.amount,
          method: input.method,
          paidOn,
          reference: input.reference ?? null,
          createdBy: userId,
        },
        trx,
      );

      const paidTotal = money(priorPaid + input.amount);
      const newOutstanding = money(total - paidTotal - priorCredit);
      const newStatus = newOutstanding <= 0 ? "paid" : "partially_paid";
      const paidAt =
        newStatus === "paid"
          ? await this.repos.payments.lastConfirmedPaidOn(invoiceId, trx)
          : null;

      await trx
        .updateTable("finance.invoices")
        .set({ status: newStatus, paid_at: paidAt })
        .where("id", "=", invoiceId)
        .execute();

      // Outbox events use snake_case to match the EventWorker dispatch convention
      // (quote_submitted, invoice_created, …). Webhook fan-out uses dotted names
      // and is fired from the route, mirroring the invoice_created pattern.
      await this.enqueue(trx, "payment_recorded", invoiceId, {
        invoiceId,
        paymentId: payment.id,
        amount: input.amount,
        paidTotal,
        outstanding: newOutstanding,
        status: newStatus,
      });
      if (newStatus === "paid") {
        await this.enqueue(trx, "invoice_paid", invoiceId, {
          invoiceId,
          paidTotal,
          paidAt,
        });
        // Capture for post-commit credit release.
        paidCustomerId = inv.customer_id;
        creditDecrement = total;
      }

      return {
        payment,
        balance: {
          invoiceId,
          totalAmount: total,
          paidTotal,
          outstanding: newOutstanding,
          status: newStatus,
        },
      };
    });

    // Release credit_used after the DB transaction commits (fire-and-forget on error).
    if (paidCustomerId && creditDecrement) {
      await this.repos.customers.decrementCreditUsed(paidCustomerId, creditDecrement).catch((err) => {
        console.error('credit decrement failed', { operation: 'decrementCreditUsed', customerId: paidCustomerId, amount: creditDecrement, error: String(err) });
      });
    }

    return result;
  }

  /** Reverse a confirmed payment and re-evaluate the invoice status. */
  async reversePayment(
    paymentId: string,
    reason: string,
    _userId: string,
  ): Promise<RecordPaymentResult> {
    if (!reason || !reason.trim()) {
      throw new ApiErrorResponse(400, "VALIDATION_ERROR", "reason is required");
    }

    return this.db.transaction().execute(async (trx) => {
      const payment = await this.repos.payments.findById(paymentId, trx);
      if (!payment) {
        throw new ApiErrorResponse(404, "NOT_FOUND", "Payment not found");
      }
      if (payment.status !== "confirmed") {
        throw new ApiErrorResponse(
          409,
          "INVALID_STATUS",
          "Payment is already reversed",
        );
      }

      const inv = await trx
        .selectFrom("finance.invoices")
        .selectAll()
        .where("id", "=", payment.invoiceId)
        .forUpdate()
        .executeTakeFirst();
      if (!inv) {
        throw new ApiErrorResponse(404, "NOT_FOUND", "Invoice not found");
      }

      const reversed = await this.repos.payments.markReversed(
        paymentId,
        reason,
        trx,
      );
      if (!reversed) {
        // Lost a race to another reversal of the same payment.
        throw new ApiErrorResponse(
          409,
          "INVALID_STATUS",
          "Payment is already reversed",
        );
      }

      const total = parseFloat(inv.total_amount.toString());
      const paidTotal = await this.repos.payments.confirmedTotal(
        payment.invoiceId,
        trx,
      );
      const creditApplied = await this.repos.creditNotes.creditAppliedToInvoice(
        payment.invoiceId,
        trx,
      );
      const newOutstanding = money(total - paidTotal - creditApplied);
      const newStatus = this.deriveStatus(
        inv.status,
        money(paidTotal + creditApplied),
        total,
      );
      const paidAt =
        newStatus === "paid"
          ? await this.repos.payments.lastConfirmedPaidOn(
              payment.invoiceId,
              trx,
            )
          : null;

      await trx
        .updateTable("finance.invoices")
        .set({ status: newStatus, paid_at: paidAt })
        .where("id", "=", payment.invoiceId)
        .execute();

      await this.enqueue(trx, "payment_reversed", payment.invoiceId, {
        invoiceId: payment.invoiceId,
        paymentId,
        reason,
        paidTotal,
        outstanding: newOutstanding,
        status: newStatus,
      });

      return {
        payment: reversed,
        balance: {
          invoiceId: payment.invoiceId,
          totalAmount: total,
          paidTotal,
          outstanding: newOutstanding,
          status: newStatus,
        },
      };
    });
  }

  /** Derived balance for an invoice (no mutation). */
  async getInvoiceBalance(invoiceId: string): Promise<InvoiceBalance> {
    const inv = await this.repos.invoices.findById(invoiceId);
    if (!inv) {
      throw new ApiErrorResponse(404, "NOT_FOUND", "Invoice not found");
    }
    const paidTotal = await this.repos.payments.confirmedTotal(invoiceId);
    const creditApplied =
      await this.repos.creditNotes.creditAppliedToInvoice(invoiceId);
    return {
      invoiceId,
      totalAmount: inv.totalAmount,
      paidTotal,
      outstanding: money(inv.totalAmount - paidTotal - creditApplied),
      status: inv.status,
    };
  }

  async getPaymentHistory(
    invoiceId: string,
  ): Promise<{ payments: PaymentRecord[]; balance: InvoiceBalance }> {
    const balance = await this.getInvoiceBalance(invoiceId);
    const payments = await this.repos.payments.listByInvoice(invoiceId);
    return { payments, balance };
  }

  async listPayments(filter: PaymentFilter) {
    return this.repos.payments.list(filter);
  }
}
