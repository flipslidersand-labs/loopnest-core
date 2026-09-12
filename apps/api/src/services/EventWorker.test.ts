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
});
