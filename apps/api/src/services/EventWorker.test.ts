import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventWorker } from './EventWorker.js';

function makeRepos(overrides: Record<string, any> = {}) {
  return {
    outbox: {
      claimPending: vi.fn().mockResolvedValue([]),
      markProcessed: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
    },
    customers: {
      decrementCreditUsed: vi.fn().mockResolvedValue(undefined),
    },
    invoices: {
      findById: vi.fn().mockResolvedValue(null),
      markPaid: vi.fn().mockResolvedValue(null),
    },
    ...overrides,
  };
}

function makeDb() {
  return {} as any;
}

function makeEvent(eventType: string, overrides: Record<string, any> = {}) {
  return {
    id: 'evt-1',
    eventType,
    aggregateId: 'cust-1',
    payload: { amount: 500, customerId: 'cust-1', invoiceId: 'inv-1' },
    createdAt: new Date(),
    ...overrides,
  };
}

describe('EventWorker — dispatch()', () => {
  let repos: ReturnType<typeof makeRepos>;
  let worker: EventWorker;

  beforeEach(() => {
    repos = makeRepos();
    worker = new EventWorker(repos as any, makeDb());
    // Expose private dispatch for testing
    (worker as any)._dispatch = (worker as any).dispatch.bind(worker);
  });

  it('credit_released calls decrementCreditUsed with correct args', async () => {
    const event = makeEvent('credit_released', {
      aggregateId: 'cust-1',
      payload: { amount: 500, customerId: 'cust-1', invoiceId: 'inv-1' },
    });
    await (worker as any)._dispatch(event);
    expect(repos.customers.decrementCreditUsed).toHaveBeenCalledWith('cust-1', 500);
  });

  it('quote_submitted logs and does not throw', async () => {
    await expect((worker as any)._dispatch(makeEvent('quote_submitted'))).resolves.toBeUndefined();
  });

  it('quote_approved logs and does not throw', async () => {
    await expect((worker as any)._dispatch(makeEvent('quote_approved'))).resolves.toBeUndefined();
  });

  it('quote_rejected logs and does not throw', async () => {
    await expect((worker as any)._dispatch(makeEvent('quote_rejected'))).resolves.toBeUndefined();
  });

  it('payment_recorded logs and does not throw', async () => {
    await expect((worker as any)._dispatch(makeEvent('payment_recorded'))).resolves.toBeUndefined();
  });

  it('invoice_paid logs and does not throw', async () => {
    await expect((worker as any)._dispatch(makeEvent('invoice_paid'))).resolves.toBeUndefined();
  });

  it('payment_reversed logs and does not throw', async () => {
    await expect((worker as any)._dispatch(makeEvent('payment_reversed'))).resolves.toBeUndefined();
  });

  it('payment_overdue logs and does not throw', async () => {
    await expect((worker as any)._dispatch(makeEvent('payment_overdue'))).resolves.toBeUndefined();
  });

  it('credit_note_issued logs and does not throw', async () => {
    await expect((worker as any)._dispatch(makeEvent('credit_note_issued'))).resolves.toBeUndefined();
  });

  it('credit_note_applied logs and does not throw', async () => {
    await expect((worker as any)._dispatch(makeEvent('credit_note_applied', { payload: { targetInvoiceId: 'inv-2' } }))).resolves.toBeUndefined();
  });

  it('credit_note_refunded logs and does not throw', async () => {
    await expect((worker as any)._dispatch(makeEvent('credit_note_refunded'))).resolves.toBeUndefined();
  });

  it('credit_note_voided logs and does not throw', async () => {
    await expect((worker as any)._dispatch(makeEvent('credit_note_voided'))).resolves.toBeUndefined();
  });

  it('quote_expired logs and does not throw', async () => {
    await expect((worker as any)._dispatch(makeEvent('quote_expired'))).resolves.toBeUndefined();
  });

  it('recurring_invoice_created logs and does not throw', async () => {
    await expect((worker as any)._dispatch(makeEvent('recurring_invoice_created', { payload: { invoiceNumber: 'REC-001' } }))).resolves.toBeUndefined();
  });

  it('dunning_action logs and does not throw', async () => {
    await expect((worker as any)._dispatch(makeEvent('dunning_action', { payload: { action: 'email', daysOverdue: 5 } }))).resolves.toBeUndefined();
  });

  it('unknown event type logs warning and does not throw', async () => {
    await expect((worker as any)._dispatch(makeEvent('totally_unknown_event'))).resolves.toBeUndefined();
  });
});

describe('EventWorker — processBatch()', () => {
  let repos: ReturnType<typeof makeRepos>;
  let worker: EventWorker;

  beforeEach(() => {
    repos = makeRepos();
    worker = new EventWorker(repos as any, makeDb());
  });

  it('claimPending returns empty → no markProcessed calls', async () => {
    repos.outbox.claimPending.mockResolvedValue([]);
    await (worker as any).processBatch();
    expect(repos.outbox.markProcessed).not.toHaveBeenCalled();
  });

  it('processes events and marks each processed on success', async () => {
    const event = makeEvent('quote_submitted');
    repos.outbox.claimPending.mockResolvedValue([event]);
    await (worker as any).processBatch();
    expect(repos.outbox.markProcessed).toHaveBeenCalledWith('evt-1');
    expect(repos.outbox.markFailed).not.toHaveBeenCalled();
  });

  it('marks failed when dispatch throws', async () => {
    const event = makeEvent('credit_released', { payload: { amount: 'not-a-number', customerId: 'cust-1' } });
    repos.outbox.claimPending.mockResolvedValue([event]);
    repos.customers.decrementCreditUsed.mockRejectedValue(new Error('db error'));
    await (worker as any).processBatch();
    expect(repos.outbox.markFailed).toHaveBeenCalledWith('evt-1', expect.any(Number));
    expect(repos.outbox.markProcessed).not.toHaveBeenCalled();
  });

  it('isProcessing guard prevents concurrent runs', async () => {
    (worker as any).isProcessing = true;
    await (worker as any).processBatch();
    expect(repos.outbox.claimPending).not.toHaveBeenCalled();
    (worker as any).isProcessing = false;
  });

  it('claimPending throws → does not crash the worker', async () => {
    repos.outbox.claimPending.mockRejectedValue(new Error('db down'));
    await expect((worker as any).processBatch()).resolves.toBeUndefined();
  });
});

describe('EventWorker — invoice_created / handleInvoiceCreated()', () => {
  let repos: ReturnType<typeof makeRepos>;
  let worker: EventWorker;

  beforeEach(() => {
    repos = makeRepos({
      outbox: {
        claimPending: vi.fn().mockResolvedValue([]),
        markProcessed: vi.fn().mockResolvedValue(undefined),
        markFailed: vi.fn().mockResolvedValue(undefined),
        publish: vi.fn().mockResolvedValue(undefined),
      },
    });
    const kyselyDb = {
      insertInto: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          execute: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    };
    worker = new EventWorker(repos as any, kyselyDb as any);
    (worker as any)._dispatch = (worker as any).dispatch.bind(worker);
  });

  it('invoice_created: accounting API success records export and resolves', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ id: 'export-1' }),
    });
    vi.stubGlobal('fetch', mockFetch);
    const event = makeEvent('invoice_created', {
      payload: { invoiceId: 'inv-1', invoiceNumber: 'INV-001', customerId: 'cust-1', totalAmount: 1000 },
    });
    await expect((worker as any)._dispatch(event)).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('invoice_created: accounting API non-ok response records failure and throws', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({ error: 'server error' }),
    });
    vi.stubGlobal('fetch', mockFetch);
    const event = makeEvent('invoice_created', {
      payload: { invoiceId: 'inv-1', invoiceNumber: 'INV-001', customerId: 'cust-1', totalAmount: 1000 },
    });
    await expect((worker as any)._dispatch(event)).rejects.toThrow('accounting API returned 500');
    vi.unstubAllGlobals();
  });

  it('invoice_created: fetch throws (network error) records failure and throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const event = makeEvent('invoice_created', {
      payload: { invoiceId: 'inv-1', invoiceNumber: 'INV-001', customerId: 'cust-1', totalAmount: 1000 },
    });
    await expect((worker as any)._dispatch(event)).rejects.toThrow('accounting API unreachable');
    vi.unstubAllGlobals();
  });
});
