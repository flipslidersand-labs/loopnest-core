import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaymentService } from './PaymentService.js';
import { ApiErrorResponse } from '../middleware/errorHandler.js';

function makeRepos(overrides: Record<string, any> = {}) {
  return {
    payments: {
      insert: vi.fn().mockResolvedValue({ id: 'pay-1', amount: 100 }),
      confirmedTotal: vi.fn().mockResolvedValue(0),
      lastConfirmedPaidOn: vi.fn().mockResolvedValue('2026-01-01'),
    },
    creditNotes: {
      creditAppliedToInvoice: vi.fn().mockResolvedValue(0),
    },
    customers: {
      decrementCreditUsed: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };
}

function makeInvoice(overrides: Record<string, any> = {}) {
  return {
    id: 'inv-1',
    status: 'sent',
    total_amount: '1000.00',
    customer_id: 'cust-1',
    quote_id: null,
    organization_id: 'org-1',
    ...overrides,
  };
}

function makeTrx(invoice: any, repos: any) {
  const trx: any = {
    selectFrom: vi.fn().mockReturnThis(),
    selectAll: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    forUpdate: vi.fn().mockReturnThis(),
    executeTakeFirst: vi.fn().mockResolvedValue(invoice),
    updateTable: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue(undefined),
    insertInto: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
  };
  // Wire repos methods to use trx
  repos.payments.insert.mockResolvedValue({ id: 'pay-1', amount: 100 });
  repos.payments.confirmedTotal.mockResolvedValue(0);
  repos.payments.lastConfirmedPaidOn.mockResolvedValue('2026-01-01');
  repos.creditNotes.creditAppliedToInvoice.mockResolvedValue(0);
  return trx;
}

function makeDb(invoice: any, repos: any) {
  const trx = makeTrx(invoice, repos);
  return {
    transaction: () => ({
      execute: (fn: (trx: any) => Promise<any>) => fn(trx),
    }),
  };
}

describe('PaymentService', () => {
  let repos: ReturnType<typeof makeRepos>;

  beforeEach(() => {
    repos = makeRepos();
    vi.clearAllMocks();
  });

  it('applyPayment — normal allocation sets status to partially_paid', async () => {
    const invoice = makeInvoice({ total_amount: '1000.00', status: 'sent' });
    const db = makeDb(invoice, repos);
    const svc = new PaymentService(repos as any, db as any);

    const result = await svc.recordPayment('inv-1', { amount: 400, method: 'bank_transfer' }, 'user-1');

    expect(result.balance.paidTotal).toBe(400);
    expect(result.balance.outstanding).toBe(600);
    expect(result.balance.status).toBe('partially_paid');
  });

  it('applyPayment — full payment sets status to paid', async () => {
    const invoice = makeInvoice({ total_amount: '1000.00', status: 'sent' });
    const db = makeDb(invoice, repos);
    const svc = new PaymentService(repos as any, db as any);

    const result = await svc.recordPayment('inv-1', { amount: 1000, method: 'bank_transfer' }, 'user-1');

    expect(result.balance.status).toBe('paid');
    expect(result.balance.outstanding).toBe(0);
  });

  it('applyPayment — overpayment throws OVERPAYMENT', async () => {
    const invoice = makeInvoice({ total_amount: '1000.00', status: 'sent' });
    const db = makeDb(invoice, repos);
    const svc = new PaymentService(repos as any, db as any);

    await expect(
      svc.recordPayment('inv-1', { amount: 1001, method: 'bank_transfer' }, 'user-1')
    ).rejects.toMatchObject({ code: 'OVERPAYMENT' });
  });

  it('applyPayment — cancelled invoice throws INVALID_STATUS', async () => {
    const invoice = makeInvoice({ status: 'cancelled' });
    const db = makeDb(invoice, repos);
    const svc = new PaymentService(repos as any, db as any);

    await expect(
      svc.recordPayment('inv-1', { amount: 100, method: 'bank_transfer' }, 'user-1')
    ).rejects.toMatchObject({ code: 'INVALID_STATUS' });
  });

  it('fire-and-forget credit decrement — does not throw on failure', async () => {
    repos.customers.decrementCreditUsed = vi.fn().mockRejectedValue(new Error('DB error'));
    const invoice = makeInvoice({ total_amount: '1000.00', status: 'sent' });
    const db = makeDb(invoice, repos);
    const svc = new PaymentService(repos as any, db as any);

    // Should resolve without throwing even if credit decrement fails
    await expect(
      svc.recordPayment('inv-1', { amount: 1000, method: 'bank_transfer' }, 'user-1')
    ).resolves.toBeDefined();
  });
});
