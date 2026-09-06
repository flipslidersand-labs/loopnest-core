import type { Kysely } from 'kysely';
import type { KyselyDatabase } from '../types/kysely-database.js';
import { BaseRepository, FindOptions, CreateInput, UpdateInput } from './BaseRepository.js';
import { randomUUID } from 'node:crypto';

export type DiscountType = 'percentage' | 'fixed';

export interface QuoteEntity {
  id: string;
  quoteNumber: string;
  quoteRequestId: string | null;
  customerId: string;
  subtotalAmount: number;
  taxAmount: number;
  totalAmount: number;
  discountType: DiscountType | null;
  discountValue: number | null;
  discountAmount: number | null;
  expiresAt: Date | null;
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'invoiced';
  notes?: string;
  organizationId?: string;
  currency: string;        // ISO 4217, default 'JPY'
  exchangeRate: number;    // rate to JPY, default 1.0
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuoteWithItems extends QuoteEntity {
  items?: Array<{
    id: string;
    productId: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
}

export interface QuoteFilter extends FindOptions {
  organizationId?: string;
  status?: string;
  customerId?: string;
}

export class QuoteRepository extends BaseRepository<QuoteEntity> {
  constructor(private db: Kysely<KyselyDatabase>) {
    super();
  }

  async findById(id: string, organizationId?: string): Promise<QuoteEntity | null> {
    let q = this.db
      .selectFrom('core.quotes')
      .selectAll()
      .where('id', '=', id);
    if (organizationId) q = q.where('organization_id', '=', organizationId);
    const row = await q.executeTakeFirst();
    return row ? this.map(row) : null;
  }

  async findByNumber(quoteNumber: string): Promise<QuoteEntity | null> {
    const row = await this.db
      .selectFrom('core.quotes')
      .selectAll()
      .where('quote_number', '=', quoteNumber)
      .executeTakeFirst();
    return row ? this.map(row) : null;
  }

  async findAll(options?: QuoteFilter): Promise<QuoteEntity[]> {
    let q = this.db
      .selectFrom('core.quotes')
      .selectAll()
      .orderBy('created_at', 'desc');
    if (options?.organizationId) q = q.where('organization_id', '=', options.organizationId);
    if (options?.skip) q = q.offset(options.skip);
    if (options?.take) q = q.limit(options.take);
    const rows = await q.execute();
    return rows.map(r => this.map(r));
  }

  async findOne(where: Partial<QuoteEntity>, options?: FindOptions): Promise<QuoteEntity | null> {
    let q = this.db.selectFrom('core.quotes').selectAll();
    if (where.status) q = q.where('status', '=', where.status);
    if (where.customerId) q = q.where('customer_id', '=', where.customerId);
    const row = await q.executeTakeFirst();
    return row ? this.map(row) : null;
  }

  async findByCustomer(customerId: string, options?: QuoteFilter): Promise<QuoteEntity[]> {
    let q = this.db
      .selectFrom('core.quotes')
      .selectAll()
      .where('customer_id', '=', customerId)
      .orderBy('created_at', 'desc');
    if (options?.organizationId) q = q.where('organization_id', '=', options.organizationId);
    if (options?.skip) q = q.offset(options.skip);
    if (options?.take) q = q.limit(options.take);
    const rows = await q.execute();
    return rows.map(r => this.map(r));
  }

  async findByStatus(status: QuoteEntity['status'], options?: QuoteFilter): Promise<QuoteEntity[]> {
    let q = this.db
      .selectFrom('core.quotes')
      .selectAll()
      .where('status', '=', status)
      .orderBy('created_at', 'desc');
    if (options?.organizationId) q = q.where('organization_id', '=', options.organizationId);
    if (options?.skip) q = q.offset(options.skip);
    if (options?.take) q = q.limit(options.take);
    const rows = await q.execute();
    return rows.map(r => this.map(r));
  }

  async findWithItems(id: string, organizationId?: string): Promise<QuoteWithItems | null> {
    let q = this.db
      .selectFrom('core.quotes')
      .selectAll()
      .where('id', '=', id);
    if (organizationId) q = q.where('organization_id', '=', organizationId);
    const quote = await q.executeTakeFirst();
    if (!quote) return null;

    const items = await this.db
      .selectFrom('core.quote_items')
      .select(['id', 'product_id', 'quantity', 'unit_price', 'line_total'])
      .where('quote_id', '=', id)
      .execute();

    return {
      ...this.map(quote),
      items: items.map(item => ({
        id: item.id,
        productId: item.product_id,
        quantity: item.quantity,
        unitPrice: Number(item.unit_price),
        lineTotal: Number(item.line_total),
      })),
    };
  }

  async create(data: CreateInput<QuoteEntity>): Promise<QuoteEntity> {
    const row = await this.db
      .insertInto('core.quotes')
      .values({
        id: randomUUID(),
        quote_number: data.quoteNumber,
        quote_request_id: data.quoteRequestId ?? null,
        customer_id: data.customerId,
        subtotal_amount: data.subtotalAmount ?? 0,
        tax_amount: data.taxAmount ?? 0,
        total_amount: data.totalAmount ?? 0,
        status: data.status ?? 'draft',
        notes: data.notes ?? null,
        expires_at: data.expiresAt ?? null,
        organization_id: data.organizationId ?? null,
        currency: data.currency ?? 'JPY',
        exchange_rate: data.exchangeRate ?? 1.0,
        created_by: data.createdBy,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return this.map(row);
  }

  async update(id: string, data: UpdateInput<QuoteEntity>): Promise<QuoteEntity> {
    const row = await this.db
      .updateTable('core.quotes')
      .set({
        ...(data.status !== undefined && { status: data.status }),
        ...(data.subtotalAmount !== undefined && { subtotal_amount: data.subtotalAmount }),
        ...(data.taxAmount !== undefined && { tax_amount: data.taxAmount }),
        ...(data.totalAmount !== undefined && { total_amount: data.totalAmount }),
        ...(data.notes !== undefined && { notes: data.notes }),
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return this.map(row);
  }

  async setExpiry(id: string, expiresAt: Date | null): Promise<QuoteEntity | null> {
    const row = await this.db
      .updateTable('core.quotes')
      .set({ expires_at: expiresAt, updated_at: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst()
      .catch(() => undefined);
    return row ? this.map(row) : null;
  }

  async findExpired(): Promise<QuoteEntity[]> {
    const rows = await this.db
      .selectFrom('core.quotes')
      .selectAll()
      .where('expires_at', '<', new Date())
      .where('status', 'in', ['draft', 'pending_approval'])
      .orderBy('expires_at', 'asc')
      .execute();
    return rows.map(r => this.map(r));
  }

  async findExpiringSoon(days = 7, organizationId?: string): Promise<QuoteEntity[]> {
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + days);
    let q = this.db
      .selectFrom('core.quotes')
      .selectAll()
      .where('expires_at', '>', new Date())
      .where('expires_at', '<=', horizon)
      .where('status', 'in', ['draft', 'pending_approval'])
      .orderBy('expires_at', 'asc');
    if (organizationId) q = q.where('organization_id', '=', organizationId);
    const rows = await q.execute();
    return rows.map(r => this.map(r));
  }

  async transitionStatus(
    id: string,
    expectedStatus: QuoteEntity['status'],
    newStatus: QuoteEntity['status'],
    extraData?: { notes?: string },
    organizationId?: string
  ): Promise<QuoteEntity | null> {
    let q = this.db
      .updateTable('core.quotes')
      .set({
        status: newStatus,
        updated_at: new Date(),
        ...(extraData?.notes !== undefined && { notes: extraData.notes }),
      })
      .where('id', '=', id)
      .where('status', '=', expectedStatus);
    if (organizationId) q = q.where('organization_id', '=', organizationId);
    const [result] = await q.execute();

    if (!result || result.numUpdatedRows === 0n) return null;

    const updated = await this.db
      .selectFrom('core.quotes')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return updated ? this.map(updated) : null;
  }

  async delete(id: string): Promise<boolean> {
    await this.db
      .deleteFrom('core.quotes')
      .where('id', '=', id)
      .execute();
    return true;
  }

  async count(where?: { organizationId?: string; status?: string; customerId?: string }): Promise<number> {
    let q = this.db
      .selectFrom('core.quotes')
      .select(({ fn }) => fn.countAll<string>().as('count'));
    if (where?.status) q = q.where('status', '=', where.status);
    if (where?.customerId) q = q.where('customer_id', '=', where.customerId);
    if (where?.organizationId) q = q.where('organization_id', '=', where.organizationId);
    const result = await q.executeTakeFirst();
    return Number(result?.count ?? 0);
  }

  async applyDiscount(
    id: string,
    discountType: DiscountType,
    discountValue: number
  ): Promise<QuoteEntity | null> {
    const quote = await this.findById(id);
    if (!quote) return null;

    const subtotal = quote.subtotalAmount;
    const discountAmount =
      discountType === 'fixed'
        ? Math.min(discountValue, subtotal)
        : Math.round((subtotal * discountValue) / 100 * 100) / 100;

    const row = await this.db
      .updateTable('core.quotes')
      .set({
        discount_type: discountType,
        discount_value: discountValue,
        discount_amount: discountAmount,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    return row ? this.map(row) : null;
  }

  async clearDiscount(id: string): Promise<QuoteEntity | null> {
    const row = await this.db
      .updateTable('core.quotes')
      .set({ discount_type: null, discount_value: null, discount_amount: null, updated_at: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst()
      .catch(() => undefined);
    return row ? this.map(row) : null;
  }

  private map(row: any): QuoteEntity {
    return {
      id: row.id,
      quoteNumber: row.quote_number,
      quoteRequestId: row.quote_request_id ?? null,
      customerId: row.customer_id,
      subtotalAmount: row.subtotal_amount ? Number(row.subtotal_amount) : 0,
      taxAmount: row.tax_amount ? Number(row.tax_amount) : 0,
      totalAmount: row.total_amount ? Number(row.total_amount) : 0,
      discountType: (row.discount_type as DiscountType | null) ?? null,
      discountValue: row.discount_value ? Number(row.discount_value) : null,
      discountAmount: row.discount_amount ? Number(row.discount_amount) : null,
      expiresAt: row.expires_at ?? null,
      status: row.status,
      notes: row.notes ?? undefined,
      organizationId: row.organization_id ?? undefined,
      currency: row.currency ?? 'JPY',
      exchangeRate: row.exchange_rate ? Number(row.exchange_rate) : 1.0,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
