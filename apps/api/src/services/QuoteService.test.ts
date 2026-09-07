import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QuoteService } from './QuoteService.js';
import { ApiErrorResponse } from '../middleware/errorHandler.js';

function makeQuote(overrides: Record<string, any> = {}) {
  return {
    id: 'q-1',
    status: 'draft',
    customerId: 'cust-1',
    subtotalAmount: 1000,
    discountAmount: 0,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeRepos(overrides: Record<string, any> = {}) {
  return {
    quotes: {
      transitionStatus: vi.fn().mockResolvedValue(makeQuote({ status: 'pending_approval' })),
      findById: vi.fn().mockResolvedValue(makeQuote()),
      findByStatus: vi.fn().mockResolvedValue([]),
    },
    outbox: {
      publish: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };
}

describe('QuoteService — submitForApproval', () => {
  it('transitions draft → pending_approval and publishes event', async () => {
    const repos = makeRepos();
    const svc = new QuoteService(repos as any);
    const result = await svc.submitForApproval('q-1', 'user-1');
    expect(result.status).toBe('pending_approval');
    expect((repos.outbox.publish as any).mock.calls[0][0]).toBe('quote_submitted');
  });

  it('throws 409 when transition is rejected (wrong status)', async () => {
    const repos = makeRepos({
      quotes: {
        transitionStatus: vi.fn().mockResolvedValue(null),
        findById: vi.fn().mockResolvedValue(makeQuote({ status: 'approved' })),
        findByStatus: vi.fn(),
      },
    });
    const svc = new QuoteService(repos as any);
    await expect(svc.submitForApproval('q-1', 'user-1')).rejects.toThrow(ApiErrorResponse);
  });

  it('throws 404 when quote does not exist', async () => {
    const repos = makeRepos({
      quotes: {
        transitionStatus: vi.fn().mockResolvedValue(null),
        findById: vi.fn().mockResolvedValue(null),
        findByStatus: vi.fn(),
      },
    });
    const svc = new QuoteService(repos as any);
    await expect(svc.submitForApproval('no-such', 'user-1')).rejects.toThrow(ApiErrorResponse);
  });
});

describe('QuoteService — approve', () => {
  it('transitions pending_approval → approved', async () => {
    const repos = makeRepos({
      quotes: {
        transitionStatus: vi.fn().mockResolvedValue(makeQuote({ status: 'approved' })),
        findById: vi.fn(),
        findByStatus: vi.fn(),
      },
    });
    const svc = new QuoteService(repos as any);
    const result = await svc.approve('q-1', 'user-1');
    expect(result.status).toBe('approved');
    expect((repos.outbox.publish as any).mock.calls[0][0]).toBe('quote_approved');
  });

  it('passes notes to transition', async () => {
    const repos = makeRepos({
      quotes: {
        transitionStatus: vi.fn().mockResolvedValue(makeQuote({ status: 'approved' })),
        findById: vi.fn(),
        findByStatus: vi.fn(),
      },
    });
    const svc = new QuoteService(repos as any);
    await svc.approve('q-1', 'user-1', 'LGTM');
    expect((repos.quotes.transitionStatus as any).mock.calls[0][3]).toEqual({ notes: 'LGTM' });
  });
});

describe('QuoteService — reject', () => {
  it('transitions pending_approval → rejected with reason', async () => {
    const repos = makeRepos({
      quotes: {
        transitionStatus: vi.fn().mockResolvedValue(makeQuote({ status: 'rejected' })),
        findById: vi.fn(),
        findByStatus: vi.fn(),
      },
    });
    const svc = new QuoteService(repos as any);
    const result = await svc.reject('q-1', 'user-1', 'price too high');
    expect(result.status).toBe('rejected');
    expect((repos.outbox.publish as any).mock.calls[0][0]).toBe('quote_rejected');
  });
});

describe('QuoteService — convertToInvoice', () => {
  it('transitions approved → invoiced', async () => {
    const repos = makeRepos({
      quotes: {
        transitionStatus: vi.fn().mockResolvedValue(makeQuote({ status: 'invoiced' })),
        findById: vi.fn(),
        findByStatus: vi.fn(),
      },
    });
    const svc = new QuoteService(repos as any);
    const result = await svc.convertToInvoice('q-1', 'user-1');
    expect(result.status).toBe('invoiced');
  });
});

describe('QuoteService — getWorkflowStatus', () => {
  it('computes capability flags for draft quote', async () => {
    const repos = makeRepos({
      quotes: {
        transitionStatus: vi.fn(),
        findById: vi.fn().mockResolvedValue(makeQuote({ status: 'draft' })),
        findByStatus: vi.fn(),
      },
    });
    const svc = new QuoteService(repos as any);
    const result = await svc.getWorkflowStatus('q-1');
    expect(result.canSubmit).toBe(true);
    expect(result.canApprove).toBe(false);
    expect(result.canInvoice).toBe(false);
  });

  it('computes capability flags for approved quote', async () => {
    const repos = makeRepos({
      quotes: {
        transitionStatus: vi.fn(),
        findById: vi.fn().mockResolvedValue(makeQuote({ status: 'approved' })),
        findByStatus: vi.fn(),
      },
    });
    const svc = new QuoteService(repos as any);
    const result = await svc.getWorkflowStatus('q-1');
    expect(result.canInvoice).toBe(true);
    expect(result.canSubmit).toBe(false);
    expect(result.canApprove).toBe(false);
  });

  it('throws 404 for unknown quote', async () => {
    const repos = makeRepos({
      quotes: {
        transitionStatus: vi.fn(),
        findById: vi.fn().mockResolvedValue(null),
        findByStatus: vi.fn(),
      },
    });
    const svc = new QuoteService(repos as any);
    await expect(svc.getWorkflowStatus('no-such')).rejects.toThrow(ApiErrorResponse);
  });
});

describe('QuoteService — list helpers', () => {
  it('getDraftQuotes delegates to findByStatus with limit', async () => {
    const repos = makeRepos();
    const svc = new QuoteService(repos as any);
    await svc.getDraftQuotes(5);
    expect((repos.quotes.findByStatus as any)).toHaveBeenCalledWith('draft', { take: 5 });
  });

  it('getPendingApprovalQuotes uses correct status', async () => {
    const repos = makeRepos();
    const svc = new QuoteService(repos as any);
    await svc.getPendingApprovalQuotes();
    expect((repos.quotes.findByStatus as any)).toHaveBeenCalledWith('pending_approval', { take: 10 });
  });
});
