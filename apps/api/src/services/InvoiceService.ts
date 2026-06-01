import { RepositoryContainer } from '@loopnest/bizcore-db';
import { ApiErrorResponse } from '../middleware/errorHandler.js';
import { v4 as uuidv4 } from 'uuid';

export interface InvoiceCreationResult {
  invoiceId: string;
  invoiceNumber: string;
  quoteId: string;
  customerId: string;
  totalAmount: number;
  createdAt: Date;
}

export class InvoiceService {
  constructor(private repos: RepositoryContainer) {}

  /**
   * Generate invoice number (format: INV-YYYYMM-XXXXX)
   */
  private generateInvoiceNumber(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const random = Math.floor(Math.random() * 100000)
      .toString()
      .padStart(5, '0');
    return `INV-${year}${month}-${random}`;
  }

  /**
   * Create invoice from approved quote
   */
  async createFromQuote(quoteId: string, userId: string): Promise<InvoiceCreationResult> {
    const quote = await this.repos.quotes.findWithItems(quoteId);

    if (!quote) {
      throw new ApiErrorResponse(404, 'NOT_FOUND', 'Quote not found');
    }

    if (quote.status !== 'approved') {
      throw new ApiErrorResponse(
        409,
        'INVALID_STATUS',
        `Cannot create invoice from quote with status ${quote.status}. Must be approved.`
      );
    }

    const invoiceId = uuidv4();
    const invoiceNumber = this.generateInvoiceNumber();
    const subtotal = quote.subtotalAmount || 0;
    const taxAmount = this.calculateTax(subtotal);
    const totalAmount = subtotal + taxAmount;

    await this.repos.invoices.create({
      quoteId,
      invoiceNumber,
      customerId: quote.customerId,
      subtotal,
      taxAmount,
      totalAmount,
      status: 'issued',
      createdBy: userId,
    });

    await this.repos.outbox.publish('invoice_created', quoteId, {
      invoiceId,
      invoiceNumber,
      quoteId,
      customerId: quote.customerId,
      totalAmount,
    });

    return {
      invoiceId,
      invoiceNumber,
      quoteId,
      customerId: quote.customerId,
      totalAmount,
      createdAt: new Date(),
    };
  }

  /**
   * Calculate invoice subtotal from line items
   */
  calculateSubtotal(items: Array<{ quantity: number; unitPrice: number }>): number {
    return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  }

  /**
   * Calculate tax (assumes 10% for Japanese consumption tax)
   */
  calculateTax(subtotal: number, taxRate: number = 0.1): number {
    return Math.round(subtotal * taxRate * 100) / 100;
  }

  /**
   * Validate invoice amounts match quote
   */
  validateAmounts(
    quoteSubtotal: number,
    invoiceSubtotal: number,
    tolerance: number = 1
  ): boolean {
    return Math.abs(quoteSubtotal - invoiceSubtotal) <= tolerance;
  }

  /**
   * Get invoices by quote IDs
   */
  async findByQuoteIds(quoteIds: string[]): Promise<Array<{ quoteId: string; invoiceId: string }>> {
    const results = await Promise.all(
      quoteIds.map(async (quoteId) => {
        const invoice = await this.repos.invoices.findByQuoteId(quoteId);
        return invoice ? { quoteId, invoiceId: invoice.id } : null;
      })
    );
    return results.filter((r): r is { quoteId: string; invoiceId: string } => r !== null);
  }
}
