import { randomUUID } from 'crypto';
import {
  RepositoryContainer,
  CreditNoteRecord,
  CreditNoteApplicationRecord,
  CreditNoteType,
  CreditNoteFilter,
} from '@loopnest/bizcore-db';
import { ApiErrorResponse } from '../middleware/errorHandler.js';

const CN_TYPES: CreditNoteType[] = ['return', 'pricing_error', 'goodwill', 'adjustment'];

export interface IssueCreditNoteInput {
  amount: number;
  reason: string;
  cnType?: CreditNoteType;
  metadata?: Record<string, any>;
}

export interface ApplyCreditNoteInput {
  targetInvoiceId: string;
  amount: number;
  notes?: string;
}

export interface CreditNoteBalance {
  creditNoteId: string;
  totalAmount: number;
  appliedAmount: number;
  refundedAmount: number;
  remaining: number;
  status: string;
}

export interface IssueCreditNoteResult {
  creditNote: CreditNoteRecord;
}

export interface ApplyCreditNoteResult {
  application: CreditNoteApplicationRecord;
  creditNoteBalance: CreditNoteBalance;
}

function money(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Credit Notes & Refunds (M14). A credit note reduces the amount a customer
 * owes, either by being applied against one or more invoices or returned as
 * cash. All mutations run in a Kysely transaction that locks the relevant rows
 * (FOR UPDATE) and enqueues outbox events atomically.
 */
export class CreditNoteService {
  constructor(
    private repos: RepositoryContainer,
    private db: any
  ) {}

  private async enqueue(
    trx: any,
    eventType: string,
    aggregateId: string,
    payload: Record<string, any>
  ): Promise<void> {
    await trx
      .insertInto('events.outbox_events')
      .values({
        id: randomUUID(),
        event_type: eventType,
        aggregate_id: aggregateId,
        payload,
        status: 'pending',
        created_at: new Date(),
      })
      .execute();
  }

  private async resolveOrgForInvoice(trx: any, inv: any): Promise<string | null> {
    if (inv.organization_id) return inv.organization_id;
    if (!inv.quote_id) return null;
    const q = await trx
      .selectFrom('core.quotes')
      .select('organization_id')
      .where('id', '=', inv.quote_id)
      .executeTakeFirst();
    return q?.organization_id ?? null;
  }

  private buildCreditNumber(seq: number): string {
    const year = new Date().getFullYear();
    return `CN-${year}-${String(seq).padStart(4, '0')}`;
  }

  /** Derive credit note status from applied and refunded amounts. */
  private deriveStatus(
    total: number,
    applied: number,
    refunded: number
  ): 'issued' | 'partially_applied' | 'fully_applied' | 'refunded' {
    const consumed = money(applied + refunded);
    if (consumed <= 0) return 'issued';
    if (money(total - consumed) <= 0) {
      if (refunded >= total) return 'refunded';
      return 'fully_applied';
    }
    return 'partially_applied';
  }

  /**
   * Issue a credit note against an existing invoice. The originating invoice
   * must be in a non-cancelled state. The credit note amount may not exceed
   * the invoice total (guards against creating phantom credit).
   */
  async issueCreditNote(
    invoiceId: string,
    input: IssueCreditNoteInput,
    userId: string
  ): Promise<IssueCreditNoteResult> {
    if (typeof input.amount !== 'number' || !(input.amount > 0)) {
      throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'amount must be a positive number');
    }
    if (!input.reason || !input.reason.trim()) {
      throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'reason is required');
    }
    const cnType: CreditNoteType = input.cnType ?? 'adjustment';
    if (!CN_TYPES.includes(cnType)) {
      throw new ApiErrorResponse(
        400,
        'VALIDATION_ERROR',
        `cnType must be one of: ${CN_TYPES.join(', ')}`
      );
    }

    return this.db.transaction().execute(async (trx: any) => {
      const inv = await trx
        .selectFrom('finance.invoices')
        .selectAll()
        .where('id', '=', invoiceId)
        .forUpdate()
        .executeTakeFirst();

      if (!inv) {
        throw new ApiErrorResponse(404, 'NOT_FOUND', 'Invoice not found');
      }
      if (inv.status === 'cancelled') {
        throw new ApiErrorResponse(409, 'INVALID_STATUS', 'Cannot issue credit note for a cancelled invoice');
      }

      const invoiceTotal = parseFloat(inv.total_amount.toString());
      if (input.amount > invoiceTotal + 0.001) {
        throw new ApiErrorResponse(
          409,
          'EXCEEDS_INVOICE',
          `Credit note amount ${input.amount} exceeds invoice total ${invoiceTotal}`
        );
      }

      const organizationId = await this.resolveOrgForInvoice(trx, inv);
      const seq = await this.repos.creditNotes.nextSequenceValue(trx);
      const creditNumber = this.buildCreditNumber(seq);

      const creditNote = await this.repos.creditNotes.insert(
        {
          organizationId,
          invoiceId,
          creditNumber,
          amount: input.amount,
          reason: input.reason.trim(),
          cnType,
          createdBy: userId,
        },
        trx
      );

      await this.enqueue(trx, 'credit_note_issued', creditNote.id, {
        creditNoteId: creditNote.id,
        creditNumber,
        invoiceId,
        amount: input.amount,
        cnType,
      });

      return { creditNote };
    });
  }

  /**
   * Apply a credit note (in whole or part) to reduce the outstanding balance
   * of a target invoice. Locks both the credit note and the target invoice row.
   * Recalculates invoice status the same way PaymentService does, treating
   * confirmed payments + applied credit notes as the combined offset.
   */
  async applyCreditNote(
    creditNoteId: string,
    input: ApplyCreditNoteInput,
    userId: string
  ): Promise<ApplyCreditNoteResult> {
    if (typeof input.amount !== 'number' || !(input.amount > 0)) {
      throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'amount must be a positive number');
    }

    return this.db.transaction().execute(async (trx: any) => {
      const cn = await trx
        .selectFrom('finance.credit_notes')
        .selectAll()
        .where('id', '=', creditNoteId)
        .forUpdate()
        .executeTakeFirst();

      if (!cn) {
        throw new ApiErrorResponse(404, 'NOT_FOUND', 'Credit note not found');
      }
      if (cn.status === 'void') {
        throw new ApiErrorResponse(409, 'INVALID_STATUS', 'Credit note is void');
      }
      if (cn.status === 'fully_applied' || cn.status === 'refunded') {
        throw new ApiErrorResponse(409, 'INVALID_STATUS', 'Credit note has no remaining balance');
      }

      const cnTotal = parseFloat(cn.amount.toString());
      const cnApplied = parseFloat(cn.applied_amount.toString());
      const cnRefunded = parseFloat(cn.refunded_amount.toString());
      const cnRemaining = money(cnTotal - cnApplied - cnRefunded);

      if (input.amount > cnRemaining + 0.001) {
        throw new ApiErrorResponse(
          409,
          'EXCEEDS_BALANCE',
          `Application amount ${input.amount} exceeds remaining credit balance ${cnRemaining}`
        );
      }

      const inv = await trx
        .selectFrom('finance.invoices')
        .selectAll()
        .where('id', '=', input.targetInvoiceId)
        .forUpdate()
        .executeTakeFirst();

      if (!inv) {
        throw new ApiErrorResponse(404, 'NOT_FOUND', 'Target invoice not found');
      }
      if (inv.status === 'cancelled') {
        throw new ApiErrorResponse(409, 'INVALID_STATUS', 'Cannot apply credit to a cancelled invoice');
      }
      if (inv.status === 'paid') {
        throw new ApiErrorResponse(409, 'INVALID_STATUS', 'Invoice is already paid');
      }

      const invTotal = parseFloat(inv.total_amount.toString());
      const paidTotal = await this.repos.payments.confirmedTotal(input.targetInvoiceId, trx);
      // Sum of credit already applied to this invoice (from all CNs, not just this one)
      const creditAppliedToInvoice = await this.repos.creditNotes.creditAppliedToInvoice(
        input.targetInvoiceId,
        trx
      );

      const invoiceOutstanding = money(invTotal - paidTotal - creditAppliedToInvoice);

      if (input.amount > invoiceOutstanding + 0.001) {
        throw new ApiErrorResponse(
          409,
          'EXCEEDS_OUTSTANDING',
          `Application amount ${input.amount} exceeds invoice outstanding balance ${invoiceOutstanding}`
        );
      }

      const application = await this.repos.creditNotes.insertApplication(
        {
          creditNoteId,
          invoiceId: input.targetInvoiceId,
          amount: input.amount,
          appliedBy: userId,
          notes: input.notes,
        },
        trx
      );

      // Update CN applied_amount + recalculate CN status
      const newCnApplied = money(cnApplied + input.amount);
      const newCnStatus = this.deriveStatus(cnTotal, newCnApplied, cnRefunded);
      await this.repos.creditNotes.updateStatus(
        creditNoteId,
        newCnStatus,
        { appliedAmount: newCnApplied },
        trx
      );

      // Recalculate invoice status
      const newInvoiceOutstanding = money(invoiceOutstanding - input.amount);
      const newInvoiceStatus =
        newInvoiceOutstanding <= 0
          ? 'paid'
          : paidTotal + creditAppliedToInvoice + input.amount > 0
          ? 'partially_paid'
          : inv.status;

      const paidAt =
        newInvoiceStatus === 'paid'
          ? await this.repos.payments.lastConfirmedPaidOn(input.targetInvoiceId, trx) ?? new Date()
          : null;

      await trx
        .updateTable('finance.invoices')
        .set({ status: newInvoiceStatus, paid_at: paidAt })
        .where('id', '=', input.targetInvoiceId)
        .execute();

      await this.enqueue(trx, 'credit_note_applied', creditNoteId, {
        creditNoteId,
        applicationId: application.id,
        targetInvoiceId: input.targetInvoiceId,
        amount: input.amount,
        cnRemaining: money(cnRemaining - input.amount),
        invoiceStatus: newInvoiceStatus,
      });

      return {
        application,
        creditNoteBalance: {
          creditNoteId,
          totalAmount: cnTotal,
          appliedAmount: newCnApplied,
          refundedAmount: cnRefunded,
          remaining: money(cnRemaining - input.amount),
          status: newCnStatus,
        },
      };
    });
  }

  /**
   * Mark a credit note as refunded (cash returned to customer). Only allowed
   * for issued/partially_applied credit notes; sets refunded_amount to the
   * full remaining balance and transitions status to 'refunded'.
   */
  async refundCreditNote(
    creditNoteId: string,
    userId: string
  ): Promise<{ creditNote: CreditNoteRecord; refundedAmount: number }> {
    return this.db.transaction().execute(async (trx: any) => {
      const cn = await trx
        .selectFrom('finance.credit_notes')
        .selectAll()
        .where('id', '=', creditNoteId)
        .forUpdate()
        .executeTakeFirst();

      if (!cn) {
        throw new ApiErrorResponse(404, 'NOT_FOUND', 'Credit note not found');
      }
      if (cn.status === 'void') {
        throw new ApiErrorResponse(409, 'INVALID_STATUS', 'Credit note is void');
      }
      if (cn.status === 'fully_applied' || cn.status === 'refunded') {
        throw new ApiErrorResponse(409, 'INVALID_STATUS', 'Credit note has no remaining balance to refund');
      }

      const cnTotal = parseFloat(cn.amount.toString());
      const cnApplied = parseFloat(cn.applied_amount.toString());
      const cnRefunded = parseFloat(cn.refunded_amount.toString());
      const remaining = money(cnTotal - cnApplied - cnRefunded);

      const newRefunded = money(cnRefunded + remaining);
      const updated = await this.repos.creditNotes.updateStatus(
        creditNoteId,
        'refunded',
        { refundedAmount: newRefunded },
        trx
      );

      await this.enqueue(trx, 'credit_note_refunded', creditNoteId, {
        creditNoteId,
        refundedAmount: remaining,
        issuedBy: userId,
      });

      return { creditNote: updated!, refundedAmount: remaining };
    });
  }

  /** Void a credit note that has not yet been applied or refunded. */
  async voidCreditNote(
    creditNoteId: string,
    _userId: string
  ): Promise<CreditNoteRecord> {
    return this.db.transaction().execute(async (trx: any) => {
      const cn = await trx
        .selectFrom('finance.credit_notes')
        .selectAll()
        .where('id', '=', creditNoteId)
        .forUpdate()
        .executeTakeFirst();

      if (!cn) {
        throw new ApiErrorResponse(404, 'NOT_FOUND', 'Credit note not found');
      }
      if (cn.status !== 'issued') {
        throw new ApiErrorResponse(
          409,
          'INVALID_STATUS',
          'Only issued (unapplied) credit notes can be voided'
        );
      }

      const voided = await this.repos.creditNotes.markVoid(creditNoteId, trx);
      if (!voided) {
        throw new ApiErrorResponse(409, 'INVALID_STATUS', 'Credit note could not be voided');
      }

      await this.enqueue(trx, 'credit_note_voided', creditNoteId, { creditNoteId });
      return voided;
    });
  }

  async getCreditNote(
    creditNoteId: string
  ): Promise<{ creditNote: CreditNoteRecord; balance: CreditNoteBalance; applications: CreditNoteApplicationRecord[] }> {
    const creditNote = await this.repos.creditNotes.findById(creditNoteId);
    if (!creditNote) {
      throw new ApiErrorResponse(404, 'NOT_FOUND', 'Credit note not found');
    }
    const applications = await this.repos.creditNotes.listApplications(creditNoteId);
    const remaining = money(creditNote.amount - creditNote.appliedAmount - creditNote.refundedAmount);
    return {
      creditNote,
      applications,
      balance: {
        creditNoteId,
        totalAmount: creditNote.amount,
        appliedAmount: creditNote.appliedAmount,
        refundedAmount: creditNote.refundedAmount,
        remaining,
        status: creditNote.status,
      },
    };
  }

  async listCreditNotes(filter: CreditNoteFilter): Promise<CreditNoteRecord[]> {
    return this.repos.creditNotes.list(filter);
  }
}
