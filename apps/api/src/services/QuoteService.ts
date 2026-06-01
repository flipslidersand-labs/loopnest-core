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
   * Atomic state transition with race-safe error handling.
   * Uses conditional UPDATE (WHERE id=? AND status=?) so that exactly one
   * concurrent caller wins; losers see the current status and get a precise error.
   */
  private async atomicTransition(
    quoteId: string,
    expectedStatus: QuoteEntity['status'],
    newStatus: QuoteEntity['status'],
    operation: string,
    extraData?: { notes?: string }
  ): Promise<QuoteEntity> {
    const updated = await this.repos.quotes.transitionStatus(
      quoteId,
      expectedStatus,
      newStatus,
      extraData
    );

    if (updated) {
      return updated;
    }

    const current = await this.repos.quotes.findById(quoteId);
    if (!current) {
      throw new ApiErrorResponse(404, 'NOT_FOUND', 'Quote not found');
    }
    throw new ApiErrorResponse(
      409,
      'INVALID_STATUS',
      `Cannot ${operation} quote with status ${current.status}. Must be ${expectedStatus}.`
    );
  }

  /**
   * Submit quote for approval (draft → pending_approval)
   */
  async submitForApproval(quoteId: string, userId: string): Promise<QuoteEntity> {
    const updated = await this.atomicTransition(
      quoteId,
      'draft',
      'pending_approval',
      'submit'
    );

    await this.repos.outbox.publish('quote_submitted', quoteId, { userId });

    return updated;
  }

  /**
   * Approve quote (pending_approval → approved)
   */
  async approve(quoteId: string, userId: string, notes?: string): Promise<QuoteEntity> {
    const updated = await this.atomicTransition(
      quoteId,
      'pending_approval',
      'approved',
      'approve',
      notes === undefined ? undefined : { notes }
    );

    await this.repos.outbox.publish('quote_approved', quoteId, { userId, notes });

    return updated;
  }

  /**
   * Reject quote (pending_approval → rejected)
   */
  async reject(quoteId: string, userId: string, reason: string): Promise<QuoteEntity> {
    const updated = await this.atomicTransition(
      quoteId,
      'pending_approval',
      'rejected',
      'reject',
      { notes: `Rejected: ${reason}` }
    );

    await this.repos.outbox.publish('quote_rejected', quoteId, { userId, reason });

    return updated;
  }

  /**
   * Convert approved quote to invoice (approved → invoiced)
   */
  async convertToInvoice(quoteId: string, userId: string): Promise<QuoteEntity> {
    return await this.atomicTransition(quoteId, 'approved', 'invoiced', 'invoice');
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
