import { randomUUID } from 'crypto';

export type RecurringStatus = 'active' | 'paused' | 'cancelled' | 'completed';
export type IntervalUnit = 'day' | 'week' | 'month' | 'year';

export interface LineItem {
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface RecurringContract {
  id: string;
  customerId: string;
  name: string;
  description: string | null;
  intervalUnit: IntervalUnit;
  intervalValue: number;
  amount: number;
  taxRate: number;
  status: RecurringStatus;
  startsAt: string;     // YYYY-MM-DD
  endsAt: string | null;
  nextBillingAt: string; // YYYY-MM-DD
  lineItems: LineItem[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRecurringInput {
  customerId: string;
  name: string;
  description?: string;
  intervalUnit: IntervalUnit;
  intervalValue: number;
  amount: number;
  taxRate?: number;
  startsAt: string;
  endsAt?: string;
  lineItems?: LineItem[];
  createdBy: string;
}

export interface RecurringFilter {
  customerId?: string;
  status?: RecurringStatus;
  skip?: number;
  take?: number;
}

export class RecurringContractRepository {
  constructor(private db: any) {}

  async findAll(filter: RecurringFilter = {}): Promise<RecurringContract[]> {
    let q = this.db
      .selectFrom('core.recurring_contracts')
      .selectAll();
    if (filter.customerId) q = q.where('customer_id', '=', filter.customerId);
    if (filter.status) q = q.where('status', '=', filter.status);
    q = q.orderBy('next_billing_at', 'asc');
    if (filter.skip != null) q = q.offset(filter.skip);
    if (filter.take != null) q = q.limit(filter.take);
    const rows = await q.execute();
    return rows.map((r: any) => this.map(r));
  }

  async findById(id: string): Promise<RecurringContract | null> {
    const row = await this.db
      .selectFrom('core.recurring_contracts')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? this.map(row) : null;
  }

  /** Contracts due for billing: active and next_billing_at <= today */
  async findDue(asOf: string): Promise<RecurringContract[]> {
    const rows = await this.db
      .selectFrom('core.recurring_contracts')
      .selectAll()
      .where('status', '=', 'active')
      .where('next_billing_at', '<=', asOf)
      .orderBy('next_billing_at', 'asc')
      .execute();
    return rows.map((r: any) => this.map(r));
  }

  async create(input: CreateRecurringInput): Promise<RecurringContract> {
    const now = new Date();
    const row = await this.db
      .insertInto('core.recurring_contracts')
      .values({
        id: randomUUID(),
        customer_id: input.customerId,
        name: input.name,
        description: input.description ?? null,
        interval_unit: input.intervalUnit,
        interval_value: input.intervalValue,
        amount: input.amount.toString(),
        tax_rate: (input.taxRate ?? 0.10).toString(),
        status: 'active',
        starts_at: input.startsAt,
        ends_at: input.endsAt ?? null,
        next_billing_at: input.startsAt,
        line_items: JSON.stringify(input.lineItems ?? []),
        created_by: input.createdBy,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return this.map(row);
  }

  async updateStatus(id: string, status: RecurringStatus): Promise<RecurringContract | null> {
    const row = await this.db
      .updateTable('core.recurring_contracts')
      .set({ status, updated_at: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    return row ? this.map(row) : null;
  }

  /** Advance next_billing_at by one interval after a successful billing run. */
  async advanceNextBilling(id: string, nextBillingAt: string): Promise<void> {
    await this.db
      .updateTable('core.recurring_contracts')
      .set({ next_billing_at: nextBillingAt, updated_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  /** Auto-complete contracts whose ends_at has passed. */
  async expireCompleted(asOf: string): Promise<number> {
    const result = await this.db
      .updateTable('core.recurring_contracts')
      .set({ status: 'completed', updated_at: new Date() })
      .where('status', '=', 'active')
      .where('ends_at', '<=', asOf)
      .execute();
    return Number(result.numUpdatedRows ?? 0);
  }

  private map(r: any): RecurringContract {
    const toDateStr = (v: any): string =>
      v instanceof Date ? v.toISOString().slice(0, 10) : String(v);

    return {
      id: r.id,
      customerId: r.customer_id,
      name: r.name,
      description: r.description ?? null,
      intervalUnit: r.interval_unit as IntervalUnit,
      intervalValue: r.interval_value,
      amount: parseFloat(r.amount.toString()),
      taxRate: parseFloat(r.tax_rate.toString()),
      status: r.status as RecurringStatus,
      startsAt: toDateStr(r.starts_at),
      endsAt: r.ends_at ? toDateStr(r.ends_at) : null,
      nextBillingAt: toDateStr(r.next_billing_at),
      lineItems: typeof r.line_items === 'string'
        ? JSON.parse(r.line_items)
        : r.line_items ?? [],
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}
