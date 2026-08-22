import { randomUUID } from 'crypto';

export type InstallmentStatus = 'pending' | 'paid' | 'cancelled';

export interface Installment {
  id: string;
  invoiceId: string;
  seq: number;
  dueDate: string;   // ISO date string YYYY-MM-DD
  amount: number;
  status: InstallmentStatus;
  paidAt: Date | null;
  createdAt: Date;
}

export interface CreateInstallmentInput {
  invoiceId: string;
  seq: number;
  dueDate: string;
  amount: number;
}

export class InstallmentRepository {
  constructor(private db: any) {}

  async findByInvoice(invoiceId: string): Promise<Installment[]> {
    const rows = await this.db
      .selectFrom('finance.invoice_installments')
      .selectAll()
      .where('invoice_id', '=', invoiceId)
      .orderBy('seq', 'asc')
      .execute();
    return rows.map((r: any) => this.map(r));
  }

  async findById(id: string): Promise<Installment | null> {
    const row = await this.db
      .selectFrom('finance.invoice_installments')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? this.map(row) : null;
  }

  /**
   * Atomically replace all existing installments for an invoice with a new schedule.
   * Throws if the invoice already has paid installments (no overwrite of paid).
   */
  async createSchedule(inputs: CreateInstallmentInput[]): Promise<Installment[]> {
    if (inputs.length === 0) throw new Error('Schedule must have at least one installment');

    const invoiceId = inputs[0].invoiceId;

    // Delete any existing pending/cancelled installments; block if paid ones exist.
    const existing = await this.db
      .selectFrom('finance.invoice_installments')
      .select(['id', 'status'])
      .where('invoice_id', '=', invoiceId)
      .execute();

    const hasPaid = existing.some((r: any) => r.status === 'paid');
    if (hasPaid) {
      throw new Error('Cannot replace schedule: invoice already has paid installments');
    }

    if (existing.length > 0) {
      await this.db
        .deleteFrom('finance.invoice_installments')
        .where('invoice_id', '=', invoiceId)
        .execute();
    }

    const now = new Date();
    const rows = await this.db
      .insertInto('finance.invoice_installments')
      .values(
        inputs.map(input => ({
          id: randomUUID(),
          invoice_id: input.invoiceId,
          seq: input.seq,
          due_date: input.dueDate,
          amount: input.amount.toString(),
          status: 'pending',
          paid_at: null,
          created_at: now,
        }))
      )
      .returningAll()
      .execute();

    return rows.map((r: any) => this.map(r));
  }

  /** Mark a single installment as paid. */
  async markPaid(id: string): Promise<Installment | null> {
    const row = await this.db
      .updateTable('finance.invoice_installments')
      .set({ status: 'paid', paid_at: new Date() })
      .where('id', '=', id)
      .where('status', '=', 'pending')
      .returningAll()
      .executeTakeFirst();
    return row ? this.map(row) : null;
  }

  /** Cancel a pending installment. */
  async cancelInstallment(id: string): Promise<Installment | null> {
    const row = await this.db
      .updateTable('finance.invoice_installments')
      .set({ status: 'cancelled' })
      .where('id', '=', id)
      .where('status', '=', 'pending')
      .returningAll()
      .executeTakeFirst();
    return row ? this.map(row) : null;
  }

  /** Count pending installments for an invoice. */
  async pendingCount(invoiceId: string): Promise<number> {
    const result = await this.db
      .selectFrom('finance.invoice_installments')
      .select((eb: any) => [eb.fn.countAll().as('count')])
      .where('invoice_id', '=', invoiceId)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    return Number(result?.count ?? 0);
  }

  private map(r: any): Installment {
    return {
      id: r.id,
      invoiceId: r.invoice_id,
      seq: r.seq,
      dueDate: r.due_date instanceof Date
        ? r.due_date.toISOString().slice(0, 10)
        : String(r.due_date),
      amount: parseFloat(r.amount.toString()),
      status: r.status as InstallmentStatus,
      paidAt: r.paid_at ?? null,
      createdAt: r.created_at,
    };
  }
}
