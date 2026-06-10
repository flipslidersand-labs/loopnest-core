import { randomUUID } from 'crypto';

export type PaymentMethod = 'bank_transfer' | 'credit_card' | 'cash' | 'offset';
export type PaymentStatus = 'confirmed' | 'reversed';

export interface PaymentRecord {
  id: string;
  invoiceId: string;
  organizationId: string | null;
  amount: number;
  method: PaymentMethod;
  paidOn: Date;
  reference: string | null;
  status: PaymentStatus;
  reversedAt: Date | null;
  reversalReason: string | null;
  createdBy: string | null;
  createdAt: Date;
}

export interface PaymentInput {
  invoiceId: string;
  organizationId?: string | null;
  amount: number;
  method: PaymentMethod;
  paidOn: Date | string;
  reference?: string | null;
  createdBy?: string | null;
}

export interface PaymentFilter {
  organizationId?: string;
  invoiceId?: string;
  status?: PaymentStatus;
  method?: PaymentMethod;
  from?: Date | string;
  to?: Date | string;
  skip?: number;
  take?: number;
}

const COLS = [
  'id', 'invoice_id', 'organization_id', 'amount', 'method', 'paid_on',
  'reference', 'status', 'reversed_at', 'reversal_reason', 'created_by', 'created_at',
] as const;

/**
 * Kysely-backed access to finance.payments. The `db` passed in may be the pool
 * or an open transaction, so the same repository works inside PaymentService's
 * record/reverse transactions and for plain reads.
 */
export class PaymentRepository {
  constructor(private db: any) {}

  /** Sum of confirmed payments for an invoice. Pass a trx for read-after-write. */
  async confirmedTotal(invoiceId: string, db: any = this.db): Promise<number> {
    const { sql } = await import('kysely');
    const r = await db
      .selectFrom('finance.payments')
      .select((eb: any) => eb.fn.coalesce(eb.fn.sum('amount'), sql`0`).as('total'))
      .where('invoice_id', '=', invoiceId)
      .where('status', '=', 'confirmed')
      .executeTakeFirst();
    return Number(r?.total ?? 0);
  }

  /** Latest paid_on among confirmed payments (used to stamp invoice.paid_at). */
  async lastConfirmedPaidOn(invoiceId: string, db: any = this.db): Promise<Date | null> {
    const r = await db
      .selectFrom('finance.payments')
      .select((eb: any) => eb.fn.max('paid_on').as('last'))
      .where('invoice_id', '=', invoiceId)
      .where('status', '=', 'confirmed')
      .executeTakeFirst();
    return r?.last ? new Date(r.last) : null;
  }

  async insert(data: PaymentInput, db: any = this.db): Promise<PaymentRecord> {
    const id = randomUUID();
    const r = await db
      .insertInto('finance.payments')
      .values({
        id,
        invoice_id: data.invoiceId,
        organization_id: data.organizationId ?? null,
        amount: data.amount.toString(),
        method: data.method,
        paid_on: typeof data.paidOn === 'string' ? data.paidOn : data.paidOn.toISOString().slice(0, 10),
        reference: data.reference ?? null,
        status: 'confirmed',
        created_by: data.createdBy ?? null,
        created_at: new Date(),
      })
      .returning(COLS)
      .executeTakeFirst();
    return this.map(r);
  }

  async findById(id: string, db: any = this.db): Promise<PaymentRecord | null> {
    const r = await db
      .selectFrom('finance.payments')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return r ? this.map(r) : null;
  }

  async markReversed(id: string, reason: string, db: any = this.db): Promise<PaymentRecord | null> {
    const r = await db
      .updateTable('finance.payments')
      .set({ status: 'reversed', reversed_at: new Date(), reversal_reason: reason })
      .where('id', '=', id)
      .where('status', '=', 'confirmed')
      .returning(COLS)
      .executeTakeFirst();
    return r ? this.map(r) : null;
  }

  async listByInvoice(invoiceId: string): Promise<PaymentRecord[]> {
    const rows = await this.db
      .selectFrom('finance.payments')
      .selectAll()
      .where('invoice_id', '=', invoiceId)
      .orderBy('paid_on', 'asc')
      .orderBy('created_at', 'asc')
      .execute();
    return rows.map((r: any) => this.map(r));
  }

  async list(filter: PaymentFilter = {}): Promise<PaymentRecord[]> {
    let q = this.db
      .selectFrom('finance.payments')
      .selectAll()
      .orderBy('paid_on', 'desc')
      .orderBy('created_at', 'desc')
      .limit(filter.take ?? 20)
      .offset(filter.skip ?? 0);
    if (filter.organizationId) q = q.where('organization_id', '=', filter.organizationId);
    if (filter.invoiceId)      q = q.where('invoice_id', '=', filter.invoiceId);
    if (filter.status)         q = q.where('status', '=', filter.status);
    if (filter.method)         q = q.where('method', '=', filter.method);
    if (filter.from)           q = q.where('paid_on', '>=', filter.from);
    if (filter.to)             q = q.where('paid_on', '<=', filter.to);
    const rows = await q.execute();
    return rows.map((r: any) => this.map(r));
  }

  private map(r: any): PaymentRecord {
    return {
      id: r.id,
      invoiceId: r.invoice_id,
      organizationId: r.organization_id ?? null,
      amount: parseFloat(r.amount.toString()),
      method: r.method,
      paidOn: r.paid_on instanceof Date ? r.paid_on : new Date(r.paid_on),
      reference: r.reference ?? null,
      status: r.status,
      reversedAt: r.reversed_at ?? null,
      reversalReason: r.reversal_reason ?? null,
      createdBy: r.created_by ?? null,
      createdAt: r.created_at,
    };
  }
}
