import { RepositoryContainer, InvoiceRecord } from '@loopnest/bizcore-db';
import { ApiErrorResponse } from '../middleware/errorHandler.js';
import { EmailNotificationService } from './EmailNotificationService.js';

export interface BulkLineItem {
  quantity: number;
  unitPrice: number;
  description?: string;
}

export interface BulkCreateItem {
  customerId: string;
  lineItems: BulkLineItem[];
  dueDate?: string;   // ISO YYYY-MM-DD
  currency?: string;
}

export interface BulkCreateResult {
  created: InvoiceRecord[];
  failed: Array<{ index: number; error: string }>;
}

export interface BulkStatusResult {
  succeeded: string[];
  failed: Array<{ id: string; error: string }>;
}

export interface InvoiceCreationResult {
  invoiceId: string;
  invoiceNumber: string;
  quoteId: string;
  customerId: string;
  totalAmount: number;
  createdAt: Date;
}

export class InvoiceService {
  constructor(
    private repos: RepositoryContainer,
    private emailNotifications: EmailNotificationService
  ) {}

  /**
   * Generate invoice number (format: INV-YYYYMM-NNNNNN).
   * The numeric suffix comes from a Postgres sequence, so it is unique and
   * monotonic even under heavy concurrency.
   */
  private async generateInvoiceNumber(): Promise<string> {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const seq = await this.repos.invoices.nextSequenceValue();
    const suffix = String(seq).padStart(6, '0');
    return `INV-${year}${month}-${suffix}`;
  }

  /**
   * Create invoice from approved quote
   */
  async createFromQuote(quoteId: string, userId: string): Promise<InvoiceCreationResult> {
    const quote = await this.repos.quotes.findWithItems(quoteId);

    if (!quote) {
      throw new ApiErrorResponse(404, 'NOT_FOUND', 'Quote not found');
    }

    if (quote.status !== 'approved' && quote.status !== 'invoiced') {
      throw new ApiErrorResponse(
        409,
        'INVALID_STATUS',
        `Cannot create invoice from quote with status ${quote.status}. Must be approved.`
      );
    }

    const taxRate = await this.repos.taxRates.findDefault();
    const rate = taxRate?.rate ?? 0.1;
    const subtotal = quote.subtotalAmount || 0;
    const discountAmount = quote.discountAmount ?? 0;
    const taxableAmount = Math.max(0, subtotal - discountAmount);
    const taxAmount = this.calculateTax(taxableAmount, rate);
    const totalAmount = taxableAmount + taxAmount;

    // Credit limit check: reject if issuing this invoice would exceed the customer's limit.
    const creditStatus = await this.repos.customers.getCreditStatus(quote.customerId);
    if (creditStatus && !creditStatus.isUnlimited) {
      const available = creditStatus.creditAvailable ?? 0;
      if (totalAmount > available) {
        throw new ApiErrorResponse(
          422,
          'CREDIT_LIMIT_EXCEEDED',
          `Invoice total ${totalAmount} exceeds available credit ${available} (limit: ${creditStatus.creditLimit}, used: ${creditStatus.creditUsed})`
        );
      }
    }

    const invoiceNumber = await this.generateInvoiceNumber();

    const invoice = await this.repos.invoices.create({
      quoteId,
      invoiceNumber,
      customerId: quote.customerId,
      subtotal,
      taxAmount,
      discountAmount,
      totalAmount,
      status: 'issued',
      createdBy: userId,
    });

    // Increment customer's outstanding credit usage.
    await this.repos.customers.incrementCreditUsed(quote.customerId, totalAmount);

    const invoiceId = invoice.id;

    await this.repos.outbox.publish('invoice_created', quoteId, {
      invoiceId,
      invoiceNumber,
      quoteId,
      customerId: quote.customerId,
      totalAmount,
    });

    // Fire-and-forget: failure should not block the invoice creation response.
    this.emailNotifications.sendInvoiceIssued(invoiceId).catch(() => undefined);

    return {
      invoiceId,
      invoiceNumber,
      quoteId,
      customerId: quote.customerId,
      totalAmount,
      createdAt: invoice.createdAt,
    };
  }

  /**
   * Pre-check credit limit before the atomic quote→invoice status transition.
   * Called in the route handler to avoid stranding the quote in 'invoiced' status
   * when the credit limit would block the invoice (TOCTOU fix side-effect).
   * createFromQuote repeats this check as belt-and-suspenders.
   */
  async assertCreditAllows(quoteId: string): Promise<void> {
    const quote = await this.repos.quotes.findWithItems(quoteId);
    if (!quote) return; // let downstream handle not-found
    const taxRate = await this.repos.taxRates.findDefault();
    const rate = taxRate?.rate ?? 0.1;
    const subtotal = quote.subtotalAmount || 0;
    const discountAmount = quote.discountAmount ?? 0;
    const taxableAmount = Math.max(0, subtotal - discountAmount);
    const totalAmount = taxableAmount + this.calculateTax(taxableAmount, rate);
    const creditStatus = await this.repos.customers.getCreditStatus(quote.customerId);
    if (creditStatus && !creditStatus.isUnlimited) {
      const available = creditStatus.creditAvailable ?? 0;
      if (totalAmount > available) {
        throw new ApiErrorResponse(
          422,
          'CREDIT_LIMIT_EXCEEDED',
          `Invoice total ${totalAmount} exceeds available credit ${available} (limit: ${creditStatus.creditLimit}, used: ${creditStatus.creditUsed})`
        );
      }
    }
  }

  /**
   * Calculate invoice subtotal from line items
   */
  calculateSubtotal(items: Array<{ quantity: number; unitPrice: number }>): number {
    return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  }

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

  /**
   * Create up to 50 invoices in one call (direct creation, not from quotes).
   * Each item is created independently; partial success is allowed.
   */
  async bulkCreate(items: BulkCreateItem[], userId: string): Promise<BulkCreateResult> {
    if (items.length > 50) {
      throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'bulk-create accepts at most 50 items');
    }

    const taxRate = await this.repos.taxRates.findDefault();
    const rate = taxRate?.rate ?? 0.1;

    const created: InvoiceRecord[] = [];
    const failed: Array<{ index: number; error: string }> = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      try {
        if (!item.customerId) throw new Error('customerId is required');
        if (!Array.isArray(item.lineItems) || item.lineItems.length === 0) {
          throw new Error('lineItems must be a non-empty array');
        }

        const subtotal = item.lineItems.reduce((sum, li) => {
          if (!Number.isFinite(li.quantity) || li.quantity <= 0) throw new Error('quantity must be positive');
          if (!Number.isFinite(li.unitPrice) || li.unitPrice < 0) throw new Error('unitPrice must be non-negative');
          return sum + li.quantity * li.unitPrice;
        }, 0);

        const taxAmount = this.calculateTax(subtotal, rate);
        const totalAmount = subtotal + taxAmount;
        const invoiceNumber = await this.generateInvoiceNumber();

        const invoice = await this.repos.invoices.create({
          invoiceNumber,
          customerId: item.customerId,
          subtotal,
          taxAmount,
          totalAmount,
          status: 'issued',
          createdBy: userId,
          paymentDueDate: item.dueDate ?? null,
          currency: item.currency ?? 'JPY',
        });

        await this.repos.outbox.publish('invoice_created', invoice.id, {
          invoiceId: invoice.id,
          invoiceNumber,
          customerId: item.customerId,
          totalAmount,
        });

        created.push(invoice);
      } catch (err: any) {
        failed.push({ index: i, error: err instanceof ApiErrorResponse ? err.message : String(err.message ?? err) });
      }
    }

    return { created, failed };
  }

  /**
   * Void (cancel) up to 100 invoices by ID.
   */
  async bulkVoid(ids: string[]): Promise<BulkStatusResult> {
    if (ids.length > 100) {
      throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'bulk-status accepts at most 100 IDs');
    }
    const succeeded: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    await Promise.all(ids.map(async (id) => {
      try {
        const result = await this.repos.invoices.cancelInvoice(id);
        if (!result) {
          const inv = await this.repos.invoices.findById(id);
          if (!inv) throw new Error('Invoice not found');
          throw new Error(`Cannot void invoice with status '${inv.status}'`);
        }
        succeeded.push(id);
      } catch (err: any) {
        failed.push({ id, error: String(err.message ?? err) });
      }
    }));

    return { succeeded, failed };
  }

  /**
   * Mark up to 100 invoices as sent.
   */
  async bulkSend(ids: string[]): Promise<BulkStatusResult> {
    if (ids.length > 100) {
      throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'bulk-status accepts at most 100 IDs');
    }
    const succeeded: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    await Promise.all(ids.map(async (id) => {
      try {
        const result = await this.repos.invoices.markSent(id);
        if (!result) {
          const inv = await this.repos.invoices.findById(id);
          if (!inv) throw new Error('Invoice not found');
          throw new Error(`Cannot send invoice with status '${inv.status}'`);
        }
        succeeded.push(id);
      } catch (err: any) {
        failed.push({ id, error: String(err.message ?? err) });
      }
    }));

    return { succeeded, failed };
  }
}
