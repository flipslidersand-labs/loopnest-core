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
  pauseReason: string | null;
  pauseUntil: string | null; // YYYY-MM-DD
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

  /**
   * Contracts due for billing: active and next_billing_at <= today.
   * This is a plain, unlocked read used only to enumerate candidates for a
   * scan — concurrent workers may see the same candidate ids. Actually
   * claiming a contract for billing must go through `lockDue()` inside the
   * same transaction as the invoice creation + `advanceNextBilling()`.
   */
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

  /**
   * Re-checks and locks a single candidate contract for billing.
   * `FOR UPDATE SKIP LOCKED` means a concurrent worker already billing this
   * contract in another transaction causes this call to return null instead
   * of blocking, so callers can just skip it. Re-checking `status`/
   * `next_billing_at` also means a contract already advanced past `asOf` by
   * a worker that committed since `findDue()` ran returns null here too.
   * Must be called with the transaction's `db` (not the pool), and the lock
   * is held until that transaction commits/rolls back — so callers must
   * also call `advanceNextBilling` in the same transaction before committing.
   */
  async lockDue(id: string, asOf: string, db: any = this.db): Promise<RecurringContract | null> {
    const row = await db
      .selectFrom('core.recurring_contracts')
      .selectAll()
      .where('id', '=', id)
      .where('status', '=', 'active')
      .where('next_billing_at', '<=', asOf)
      .forUpdate()
      .skipLocked()
      .executeTakeFirst();
    return row ? this.map(row) : null;
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

  async pause(id: string, reason?: string | null, pauseUntil?: string | null): Promise<RecurringContract | null> {
    const row = await this.db
      .updateTable('core.recurring_contracts')
      .set({
        status: 'paused',
        pause_reason: reason ?? null,
        pause_until: pauseUntil ?? null,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .where('status', '=', 'active')
      .returningAll()
      .executeTakeFirst();
    return row ? this.map(row) : null;
  }

  async resume(id: string): Promise<RecurringContract | null> {
    const row = await this.db
      .updateTable('core.recurring_contracts')
      .set({
        status: 'active',
        pause_reason: null,
        pause_until: null,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .where('status', '=', 'paused')
      .returningAll()
      .executeTakeFirst();
    return row ? this.map(row) : null;
  }

  /** Auto-resume paused contracts whose pause_until date has passed. */
  async autoResumePaused(asOf: string): Promise<number> {
    const result = await this.db
      .updateTable('core.recurring_contracts')
      .set({ status: 'active', pause_reason: null, pause_until: null, updated_at: new Date() })
      .where('status', '=', 'paused')
      .where((eb: any) => eb.and([
        eb('pause_until', 'is not', null),
        eb('pause_until', '<=', asOf),
      ]))
      .execute();
    return Number(result.numUpdatedRows ?? 0);
  }

  /** Advance next_billing_at by one interval after a successful billing run. */
  async advanceNextBilling(id: string, nextBillingAt: string, db: any = this.db): Promise<void> {
    await db
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
    const toDateStr = (v: any): string => {
      if (v instanceof Date) {
        // Use local date parts: pg parses DATE columns as local-midnight Date objects,
        // and toISOString() would shift to the previous day in UTC+ timezones.
        const y = v.getFullYear();
        const m = String(v.getMonth() + 1).padStart(2, '0');
        const d = String(v.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
      return String(v);
    };

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
      pauseReason: r.pause_reason ?? null,
      pauseUntil: r.pause_until ? toDateStr(r.pause_until) : null,
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}
