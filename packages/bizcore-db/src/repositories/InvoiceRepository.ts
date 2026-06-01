import { randomUUID } from 'crypto';

export interface InvoiceRecord {
  id: string;
  quoteId: string;
  invoiceNumber: string;
  customerId: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  status: 'issued' | 'paid' | 'overdue';
  createdBy: string | null;
  createdAt: Date;
}

export interface InvoiceInput {
  quoteId: string;
  invoiceNumber: string;
  customerId: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  status?: string;
  createdBy?: string;
}

export class InvoiceRepository {
  constructor(private db: any) {}

  async create(data: InvoiceInput): Promise<InvoiceRecord> {
    const id = randomUUID();
    const result = await this.db
      .insertInto('finance.invoices')
      .values({
        id,
        quote_id: data.quoteId,
        invoice_number: data.invoiceNumber,
        customer_id: data.customerId,
        subtotal_amount: data.subtotal.toString(),
        tax_amount: data.taxAmount.toString(),
        total_amount: data.totalAmount.toString(),
        status: data.status || 'issued',
        created_by: data.createdBy,
        created_at: new Date(),
      })
      .returning([
        'id',
        'quote_id',
        'invoice_number',
        'customer_id',
        'subtotal_amount',
        'tax_amount',
        'total_amount',
        'status',
        'created_by',
        'created_at',
      ])
      .executeTakeFirst();

    return this.mapToInvoice(result);
  }

  async findByQuoteId(quoteId: string): Promise<InvoiceRecord | null> {
    const result = await this.db
      .selectFrom('finance.invoices')
      .selectAll()
      .where((eb: any) => eb('quote_id', '=', quoteId))
      .executeTakeFirst();

    return result ? this.mapToInvoice(result) : null;
  }

  async findById(id: string): Promise<InvoiceRecord | null> {
    const result = await this.db
      .selectFrom('finance.invoices')
      .selectAll()
      .where((eb: any) => eb('id', '=', id))
      .executeTakeFirst();

    return result ? this.mapToInvoice(result) : null;
  }

  async updateStatus(id: string, status: string): Promise<void> {
    await this.db
      .updateTable('finance.invoices')
      .set({ status })
      .where((eb: any) => eb('id', '=', id))
      .execute();
  }

  private mapToInvoice(record: any): InvoiceRecord {
    return {
      id: record.id,
      quoteId: record.quote_id,
      invoiceNumber: record.invoice_number,
      customerId: record.customer_id,
      subtotal: parseFloat(record.subtotal_amount.toString()),
      taxAmount: parseFloat(record.tax_amount.toString()),
      totalAmount: parseFloat(record.total_amount.toString()),
      status: record.status,
      createdBy: record.created_by,
      createdAt: record.created_at,
    };
  }
}
