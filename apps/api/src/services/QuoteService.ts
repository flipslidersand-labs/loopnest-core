import { RepositoryContainer, QuoteEntity } from '@loopnest/bizcore-db';
import { ApiErrorResponse } from '../middleware/errorHandler.js';

export interface QuoteWorkflowAction {
  action: 'submit' | 'approve' | 'reject' | 'invoice' | 'cancel';
  quoteId: string;
  userId: string;
  notes?: string;
}

export class QuoteService {
  constructor(private repos: RepositoryContainer) {}

  /**
   * Submit quote for approval (draft → pending_approval)
   */
  async submitForApproval(quoteId: string, userId: string): Promise<QuoteEntity> {
    const quote = await this.repos.quotes.findById(quoteId);

    if (!quote) {
      throw new ApiErrorResponse(404, 'NOT_FOUND', 'Quote not found');
    }

    if (quote.status !== 'draft') {
      throw new ApiErrorResponse(
        400,
        'INVALID_STATUS',
        `Cannot submit quote with status ${quote.status}. Must be draft.`
      );
    }

    const updated = await this.repos.quotes.update(quoteId, {
      status: 'pending_approval',
    });

    await this.repos.outbox.publish('quote_submitted', quoteId, { userId });

    return updated;
  }

  /**
   * Approve quote (pending_approval → approved)
   */
  async approve(quoteId: string, userId: string, notes?: string): Promise<QuoteEntity> {
    const quote = await this.repos.quotes.findById(quoteId);

    if (!quote) {
      throw new ApiErrorResponse(404, 'NOT_FOUND', 'Quote not found');
    }

    if (quote.status !== 'pending_approval') {
      throw new ApiErrorResponse(
        400,
        'INVALID_STATUS',
        `Cannot approve quote with status ${quote.status}. Must be pending_approval.`
      );
    }

    const updated = await this.repos.quotes.update(quoteId, {
      status: 'approved',
      notes: notes || quote.notes,
    });

    await this.repos.outbox.publish('quote_approved', quoteId, { userId, notes });

    return updated;
  }

  /**
   * Reject quote (pending_approval → rejected)
   */
  async reject(quoteId: string, userId: string, reason: string): Promise<QuoteEntity> {
    const quote = await this.repos.quotes.findById(quoteId);

    if (!quote) {
      throw new ApiErrorResponse(404, 'NOT_FOUND', 'Quote not found');
    }

    if (quote.status !== 'pending_approval') {
      throw new ApiErrorResponse(
        400,
        'INVALID_STATUS',
        `Cannot reject quote with status ${quote.status}. Must be pending_approval.`
      );
    }

    const updated = await this.repos.quotes.update(quoteId, {
      status: 'rejected',
      notes: `Rejected: ${reason}`,
    });

    await this.repos.outbox.publish('quote_rejected', quoteId, { userId, reason });

    return updated;
  }

  /**
   * Convert approved quote to invoice
   */
  async convertToInvoice(quoteId: string, userId: string): Promise<QuoteEntity> {
    const quote = await this.repos.quotes.findById(quoteId);

    if (!quote) {
      throw new ApiErrorResponse(404, 'NOT_FOUND', 'Quote not found');
    }

    if (quote.status !== 'approved') {
      throw new ApiErrorResponse(
        400,
        'INVALID_STATUS',
        `Cannot invoice quote with status ${quote.status}. Must be approved.`
      );
    }

    // Update quote status
    const updated = await this.repos.quotes.update(quoteId, {
      status: 'invoiced',
    });

    // TODO: Create corresponding invoice in finance schema
    // This would use InvoiceRepository when available

    return updated;
  }

  /**
   * Get quote workflow summary
   */
  async getWorkflowStatus(quoteId: string): Promise<{
    quote: QuoteEntity;
    canSubmit: boolean;
    canApprove: boolean;
    canReject: boolean;
    canInvoice: boolean;
  }> {
    const quote = await this.repos.quotes.findById(quoteId);

    if (!quote) {
      throw new ApiErrorResponse(404, 'NOT_FOUND', 'Quote not found');
    }

    return {
      quote,
      canSubmit: quote.status === 'draft',
      canApprove: quote.status === 'pending_approval',
      canReject: quote.status === 'pending_approval',
      canInvoice: quote.status === 'approved',
    };
  }

  /**
   * Get quotes by workflow stage
   */
  async getDraftQuotes(limit: number = 10): Promise<QuoteEntity[]> {
    return this.repos.quotes.findByStatus('draft', { take: limit });
  }

  async getPendingApprovalQuotes(limit: number = 10): Promise<QuoteEntity[]> {
    return this.repos.quotes.findByStatus('pending_approval', { take: limit });
  }

  async getApprovedQuotes(limit: number = 10): Promise<QuoteEntity[]> {
    return this.repos.quotes.findByStatus('approved', { take: limit });
  }

  async getInvoicedQuotes(limit: number = 10): Promise<QuoteEntity[]> {
    return this.repos.quotes.findByStatus('invoiced', { take: limit });
  }
}
