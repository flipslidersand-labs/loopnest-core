import { randomUUID } from 'crypto';

export type InvoiceStatus = 'issued' | 'sent' | 'paid' | 'cancelled';

export interface InvoiceRecord {
  id: string;
  quoteId: string | null;
  contractId: string | null;
  invoiceNumber: string;
  customerId: string;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  status: InvoiceStatus;
  paidAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  currency: string;         // ISO 4217, default 'JPY'
  exchangeRate: number;     // rate to JPY, default 1.0
}

export interface InvoiceLineItem {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  notes: string | null;
}

export interface InvoiceWithItems extends InvoiceRecord {
  items: InvoiceLineItem[];
}

export interface InvoiceInput {
  quoteId?: string | null;
  contractId?: string | null;
  invoiceNumber: string;
  customerId: string;
  subtotal: number;
  taxAmount: number;
  discountAmount?: number;
  totalAmount: number;
  status?: string;
  createdBy?: string;
  currency?: string;        // ISO 4217, defaults to 'JPY'
  exchangeRate?: number;    // rate to JPY, defaults to 1.0
}

export interface InvoiceFilter {
  status?: string;
  customerId?: string;
  skip?: number;
  take?: number;
}

const COLS = [
  'id', 'quote_id', 'contract_id', 'invoice_number', 'customer_id',
  'subtotal_amount', 'tax_amount', 'discount_amount', 'total_amount',
  'status', 'paid_at', 'created_by', 'created_at',
  'currency', 'exchange_rate',
] as const;

export class InvoiceRepository {
  constructor(private db: any) {}

  async nextSequenceValue(): Promise<number> {
    const { sql } = await import('kysely');
    const result = await sql<{ nextval: string }>`
      SELECT nextval('finance.invoice_number_seq') AS nextval
    `.execute(this.db);
    return Number(result.rows[0].nextval);
  }

  async create(data: InvoiceInput): Promise<InvoiceRecord> {
    const id = randomUUID();
    const result = await this.db
      .insertInto('finance.invoices')
      .values({
        id,
        quote_id: data.quoteId ?? null,
        contract_id: data.contractId ?? null,
        invoice_number: data.invoiceNumber,
        customer_id: data.customerId,
        subtotal_amount: data.subtotal.toString(),
        tax_amount: data.taxAmount.toString(),
        discount_amount: (data.discountAmount ?? 0).toString(),
        total_amount: data.totalAmount.toString(),
        status: data.status || 'issued',
        created_by: data.createdBy,
        created_at: new Date(),
      })
      .returning(COLS)
      .executeTakeFirst();
    return this.map(result);
  }

  async findAll(filter: InvoiceFilter = {}): Promise<InvoiceRecord[]> {
    let q = this.db
      .selectFrom('finance.invoices')
      .selectAll()
      .orderBy('created_at', 'desc')
      .limit(filter.take ?? 20)
      .offset(filter.skip ?? 0);
    if (filter.status)     q = q.where('status', '=', filter.status);
    if (filter.customerId) q = q.where('customer_id', '=', filter.customerId);
    const rows = await q.execute();
    return rows.map((r: any) => this.map(r));
  }

  async count(filter: Pick<InvoiceFilter, 'status' | 'customerId'> = {}): Promise<number> {
    let q = this.db
      .selectFrom('finance.invoices')
      .select((eb: any) => eb.fn.countAll().as('n'));
    if (filter.status)     q = q.where('status', '=', filter.status);
    if (filter.customerId) q = q.where('customer_id', '=', filter.customerId);
    const result = await q.executeTakeFirst();
    return Number(result?.n ?? 0);
  }

  async findById(id: string): Promise<InvoiceRecord | null> {
    const r = await this.db
      .selectFrom('finance.invoices')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return r ? this.map(r) : null;
  }

  async findByNumber(invoiceNumber: string): Promise<InvoiceRecord | null> {
    const r = await this.db
      .selectFrom('finance.invoices')
      .selectAll()
      .where('invoice_number', '=', invoiceNumber)
      .executeTakeFirst();
    return r ? this.map(r) : null;
  }

  async findByQuoteId(quoteId: string): Promise<InvoiceRecord | null> {
    const r = await this.db
      .selectFrom('finance.invoices')
      .selectAll()
      .where('quote_id', '=', quoteId)
      .executeTakeFirst();
    return r ? this.map(r) : null;
  }

  async findWithItems(id: string): Promise<InvoiceWithItems | null> {
    const invoice = await this.findById(id);
    if (!invoice) return null;
    const items = await this.db
      .selectFrom('finance.invoice_items as ii')
      .innerJoin('core.products as p', 'p.id', 'ii.product_id')
      .select([
        'ii.id',
        'ii.product_id',
        'p.name as product_name',
        'p.sku as product_sku',
        'ii.quantity',
        'ii.unit_price',
        'ii.line_total',
        'ii.notes',
      ])
      .where('ii.invoice_id', '=', id)
      .execute();
    return {
      ...invoice,
      items: items.map((r: any) => ({
        id: r.id,
        productId: r.product_id,
        productName: r.product_name,
        productSku: r.product_sku,
        quantity: Number(r.quantity),
        unitPrice: parseFloat(r.unit_price.toString()),
        lineTotal: parseFloat(r.line_total.toString()),
        notes: r.notes ?? null,
      })),
    };
  }

  // issued → sent
  async markSent(id: string): Promise<InvoiceRecord | null> {
    const r = await this.db
      .updateTable('finance.invoices')
      .set({ status: 'sent' })
      .where('id', '=', id)
      .where('status', '=', 'issued')
      .returning(COLS)
      .executeTakeFirst();
    return r ? this.map(r) : null;
  }

  // issued | sent → paid
  async markPaid(id: string, paidAt = new Date()): Promise<InvoiceRecord | null> {
    const r = await this.db
      .updateTable('finance.invoices')
      .set({ status: 'paid', paid_at: paidAt })
      .where('id', '=', id)
      .where('status', 'in', ['issued', 'sent'])
      .returning(COLS)
      .executeTakeFirst();
    return r ? this.map(r) : null;
  }

  // issued | sent → cancelled
  async cancelInvoice(id: string): Promise<InvoiceRecord | null> {
    const r = await this.db
      .updateTable('finance.invoices')
      .set({ status: 'cancelled' })
      .where('id', '=', id)
      .where('status', 'in', ['issued', 'sent'])
      .returning(COLS)
      .executeTakeFirst();
    return r ? this.map(r) : null;
  }

  // Legacy helper kept for compatibility.
  async updateStatus(id: string, status: string): Promise<void> {
    await this.db.updateTable('finance.invoices').set({ status }).where('id', '=', id).execute();
  }

  private map(r: any): InvoiceRecord {
    return {
      id: r.id,
      quoteId: r.quote_id ?? null,
      contractId: r.contract_id ?? null,
      invoiceNumber: r.invoice_number,
      customerId: r.customer_id,
      subtotal: parseFloat(r.subtotal_amount.toString()),
      taxAmount: parseFloat(r.tax_amount.toString()),
      discountAmount: r.discount_amount ? parseFloat(r.discount_amount.toString()) : 0,
      totalAmount: parseFloat(r.total_amount.toString()),
      status: r.status,
      paidAt: r.paid_at ?? null,
      createdBy: r.created_by,
      createdAt: r.created_at,
    };
  }
}
