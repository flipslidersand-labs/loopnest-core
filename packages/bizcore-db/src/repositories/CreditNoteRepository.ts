import { randomUUID } from 'crypto';

export type CreditNoteType = 'return' | 'pricing_error' | 'goodwill' | 'adjustment';
export type CreditNoteStatus =
  | 'issued'
  | 'partially_applied'
  | 'fully_applied'
  | 'refunded'
  | 'void';

export interface CreditNoteRecord {
  id: string;
  organizationId: string | null;
  invoiceId: string | null;
  creditNumber: string;
  amount: number;
  reason: string;
  cnType: CreditNoteType;
  status: CreditNoteStatus;
  appliedAmount: number;
  refundedAmount: number;
  issuedAt: Date;
  createdBy: string | null;
  createdAt: Date;
}

export interface CreditNoteApplicationRecord {
  id: string;
  creditNoteId: string;
  invoiceId: string;
  amount: number;
  appliedAt: Date;
  appliedBy: string | null;
  notes: string | null;
}

export interface CreditNoteInput {
  organizationId?: string | null;
  invoiceId?: string | null;
  creditNumber: string;
  amount: number;
  reason: string;
  cnType: CreditNoteType;
  createdBy?: string | null;
}

export interface CreditNoteApplicationInput {
  creditNoteId: string;
  invoiceId: string;
  amount: number;
  appliedBy?: string | null;
  notes?: string | null;
}

export interface CreditNoteFilter {
  organizationId?: string;
  invoiceId?: string;
  status?: CreditNoteStatus;
  cnType?: CreditNoteType;
  skip?: number;
  take?: number;
}

const CN_COLS = [
  'id', 'organization_id', 'invoice_id', 'credit_number', 'amount',
  'reason', 'cn_type', 'status', 'applied_amount', 'refunded_amount',
  'issued_at', 'created_by', 'created_at',
] as const;

/**
 * Kysely-backed access to finance.credit_notes and credit_note_applications.
 * The `db` parameter may be the pool or an open transaction — same repository
 * works for reads and within CreditNoteService transactions.
 */
export class CreditNoteRepository {
  constructor(private db: any) {}

  async nextSequenceValue(db: any = this.db): Promise<number> {
    const { sql } = await import('kysely');
    const r = await sql<{ nextval: string }>`
      SELECT nextval('finance.credit_note_seq') AS nextval
    `.execute(db);
    return Number(r.rows[0].nextval);
  }

  async insert(data: CreditNoteInput, db: any = this.db): Promise<CreditNoteRecord> {
    const id = randomUUID();
    const r = await db
      .insertInto('finance.credit_notes')
      .values({
        id,
        organization_id: data.organizationId ?? null,
        invoice_id: data.invoiceId ?? null,
        credit_number: data.creditNumber,
        amount: data.amount.toString(),
        reason: data.reason,
        cn_type: data.cnType,
        status: 'issued',
        applied_amount: '0',
        refunded_amount: '0',
        created_by: data.createdBy ?? null,
        created_at: new Date(),
      })
      .returning(CN_COLS)
      .executeTakeFirst();
    return this.map(r);
  }

  async findById(id: string, db: any = this.db): Promise<CreditNoteRecord | null> {
    const r = await db
      .selectFrom('finance.credit_notes')
      .select(CN_COLS)
      .where('id', '=', id)
      .executeTakeFirst();
    return r ? this.map(r) : null;
  }

  async findByNumber(creditNumber: string): Promise<CreditNoteRecord | null> {
    const r = await this.db
      .selectFrom('finance.credit_notes')
      .select(CN_COLS)
      .where('credit_number', '=', creditNumber)
      .executeTakeFirst();
    return r ? this.map(r) : null;
  }

  async list(filter: CreditNoteFilter = {}): Promise<CreditNoteRecord[]> {
    let q = this.db
      .selectFrom('finance.credit_notes')
      .select(CN_COLS)
      .orderBy('created_at', 'desc')
      .limit(filter.take ?? 20)
      .offset(filter.skip ?? 0);
    if (filter.organizationId) q = q.where('organization_id', '=', filter.organizationId);
    if (filter.invoiceId)      q = q.where('invoice_id', '=', filter.invoiceId);
    if (filter.status)         q = q.where('status', '=', filter.status);
    if (filter.cnType)         q = q.where('cn_type', '=', filter.cnType);
    const rows = await q.execute();
    return rows.map((r: any) => this.map(r));
  }

  /** Sum of all application amounts for a credit note. */
  async appliedTotal(creditNoteId: string, db: any = this.db): Promise<number> {
    const { sql } = await import('kysely');
    const r = await db
      .selectFrom('finance.credit_note_applications')
      .select((eb: any) => eb.fn.coalesce(eb.fn.sum('amount'), sql`0`).as('total'))
      .where('credit_note_id', '=', creditNoteId)
      .executeTakeFirst();
    return Number(r?.total ?? 0);
  }

  /** Sum of all credit note application amounts applied TO a specific invoice (across all CNs). */
  async creditAppliedToInvoice(invoiceId: string, db: any = this.db): Promise<number> {
    const { sql } = await import('kysely');
    const r = await db
      .selectFrom('finance.credit_note_applications')
      .select((eb: any) => eb.fn.coalesce(eb.fn.sum('amount'), sql`0`).as('total'))
      .where('invoice_id', '=', invoiceId)
      .executeTakeFirst();
    return Number(r?.total ?? 0);
  }

  async insertApplication(
    data: CreditNoteApplicationInput,
    db: any = this.db
  ): Promise<CreditNoteApplicationRecord> {
    const id = randomUUID();
    const r = await db
      .insertInto('finance.credit_note_applications')
      .values({
        id,
        credit_note_id: data.creditNoteId,
        invoice_id: data.invoiceId,
        amount: data.amount.toString(),
        applied_by: data.appliedBy ?? null,
        notes: data.notes ?? null,
        applied_at: new Date(),
      })
      .returning(['id', 'credit_note_id', 'invoice_id', 'amount', 'applied_at', 'applied_by', 'notes'])
      .executeTakeFirst();
    return this.mapApplication(r);
  }

  async listApplications(creditNoteId: string): Promise<CreditNoteApplicationRecord[]> {
    const rows = await this.db
      .selectFrom('finance.credit_note_applications')
      .selectAll()
      .where('credit_note_id', '=', creditNoteId)
      .orderBy('applied_at', 'asc')
      .execute();
    return rows.map((r: any) => this.mapApplication(r));
  }

  async updateStatus(
    id: string,
    status: CreditNoteStatus,
    amounts: { appliedAmount?: number; refundedAmount?: number },
    db: any = this.db
  ): Promise<CreditNoteRecord | null> {
    const updates: Record<string, any> = { status };
    if (amounts.appliedAmount !== undefined)
      updates.applied_amount = amounts.appliedAmount.toString();
    if (amounts.refundedAmount !== undefined)
      updates.refunded_amount = amounts.refundedAmount.toString();

    const r = await db
      .updateTable('finance.credit_notes')
      .set(updates)
      .where('id', '=', id)
      .returning(CN_COLS)
      .executeTakeFirst();
    return r ? this.map(r) : null;
  }

  async markVoid(id: string, db: any = this.db): Promise<CreditNoteRecord | null> {
    const r = await db
      .updateTable('finance.credit_notes')
      .set({ status: 'void' })
      .where('id', '=', id)
      .where('status', 'in', ['issued'])
      .returning(CN_COLS)
      .executeTakeFirst();
    return r ? this.map(r) : null;
  }

  private map(r: any): CreditNoteRecord {
    return {
      id: r.id,
      organizationId: r.organization_id ?? null,
      invoiceId: r.invoice_id ?? null,
      creditNumber: r.credit_number,
      amount: parseFloat(r.amount.toString()),
      reason: r.reason,
      cnType: r.cn_type,
      status: r.status,
      appliedAmount: parseFloat(r.applied_amount.toString()),
      refundedAmount: parseFloat(r.refunded_amount.toString()),
      issuedAt: r.issued_at instanceof Date ? r.issued_at : new Date(r.issued_at),
      createdBy: r.created_by ?? null,
      createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
    };
  }

  private mapApplication(r: any): CreditNoteApplicationRecord {
    return {
      id: r.id,
      creditNoteId: r.credit_note_id,
      invoiceId: r.invoice_id,
      amount: parseFloat(r.amount.toString()),
      appliedAt: r.applied_at instanceof Date ? r.applied_at : new Date(r.applied_at),
      appliedBy: r.applied_by ?? null,
      notes: r.notes ?? null,
    };
  }
}
