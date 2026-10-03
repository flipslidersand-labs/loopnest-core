import { describe, it, expect, vi } from 'vitest';
import { StatementService } from './StatementService.js';
import { ApiErrorResponse } from '../middleware/errorHandler.js';

function invoice(overrides: Record<string, any> = {}) {
  return {
    id: 'inv-1',
    invoiceNumber: 'INV-1',
    customerId: 'cust-1',
    totalAmount: 1000,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function payment(overrides: Record<string, any> = {}) {
  return {
    id: 'pay-1',
    method: 'bank_transfer',
    amount: 500,
    status: 'confirmed',
    paidOn: new Date('2026-01-02'),
    reference: null,
    ...overrides,
  };
}

function creditNote(overrides: Record<string, any> = {}) {
  return {
    id: 'cn-1',
    creditNumber: 'CN-1',
    amount: 100,
    createdAt: new Date('2026-01-03'),
    ...overrides,
  };
}

function makeRepos({
  invoices = [],
  paymentsByInvoice = {},
  creditNotesByInvoice = {},
  customer = { id: 'cust-1', name: 'Test Corp' },
}: {
  invoices?: any[];
  paymentsByInvoice?: Record<string, any[]>;
  creditNotesByInvoice?: Record<string, any[]>;
  customer?: any;
} = {}) {
  return {
    customers: { findById: vi.fn().mockResolvedValue(customer) },
    invoices: { findAll: vi.fn().mockResolvedValue(invoices) },
    payments: {
      listByInvoice: vi.fn((invoiceId: string) => Promise.resolve(paymentsByInvoice[invoiceId] ?? [])),
    },
    creditNotes: {
      list: vi.fn(({ invoiceId }: { invoiceId: string }) => Promise.resolve(creditNotesByInvoice[invoiceId] ?? [])),
    },
  } as any;
}

describe('StatementService.generate', () => {
  it('throws 404 when the customer does not exist', async () => {
    const repos = makeRepos({ customer: null });
    const svc = new StatementService(repos);
    await expect(
      svc.generate('missing', new Date('2026-01-01'), new Date('2026-01-31')),
    ).rejects.toThrow(ApiErrorResponse);
  });

  it('folds pre-period activity into openingBalance instead of hardcoding 0', async () => {
    // Invoice + payment both dated in December, entirely before the January window.
    const decInvoice = invoice({ id: 'inv-dec', createdAt: new Date('2025-12-01'), totalAmount: 1000 });
    const repos = makeRepos({
      invoices: [decInvoice],
      paymentsByInvoice: { 'inv-dec': [payment({ id: 'pay-dec', paidOn: new Date('2025-12-15'), amount: 300 })] },
    });
    const svc = new StatementService(repos);

    const stmt = await svc.generate('cust-1', new Date('2026-01-01'), new Date('2026-01-31'));

    // opening = 1000 (invoice debit) - 300 (payment credit) = 700
    expect(stmt.openingBalance).toBe(700);
    expect(stmt.closingBalance).toBe(700);
    expect(stmt.transactions).toHaveLength(0);
  });

  it('includes entries exactly on the from/to boundary and excludes entries just outside it', async () => {
    const onFrom = invoice({ id: 'inv-from', createdAt: new Date('2026-01-01T00:00:00.000Z'), totalAmount: 100 });
    const onTo = invoice({ id: 'inv-to', createdAt: new Date('2026-01-31T23:59:59.999Z'), totalAmount: 200 });
    const beforeFrom = invoice({ id: 'inv-before', createdAt: new Date('2025-12-31T23:59:59.999Z'), totalAmount: 50 });
    const afterTo = invoice({ id: 'inv-after', createdAt: new Date('2026-02-01T00:00:00.000Z'), totalAmount: 75 });
    const repos = makeRepos({ invoices: [onFrom, onTo, beforeFrom, afterTo] });
    const svc = new StatementService(repos);

    const stmt = await svc.generate('cust-1', new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-31T23:59:59.999Z'));

    expect(stmt.transactions.map(t => t.ref)).toEqual(['INV-1', 'INV-1']); // onFrom, onTo (same invoiceNumber fixture)
    expect(stmt.transactions).toHaveLength(2);
    expect(stmt.openingBalance).toBe(50); // only beforeFrom
  });

  it('excludes reversed payments', async () => {
    const inv = invoice({ createdAt: new Date('2026-01-05') });
    const repos = makeRepos({
      invoices: [inv],
      paymentsByInvoice: {
        'inv-1': [
          payment({ id: 'pay-ok', status: 'confirmed', amount: 200, paidOn: new Date('2026-01-06') }),
          payment({ id: 'pay-reversed', status: 'reversed', amount: 999, paidOn: new Date('2026-01-07') }),
        ],
      },
    });
    const svc = new StatementService(repos);

    const stmt = await svc.generate('cust-1', new Date('2026-01-01'), new Date('2026-01-31'));

    expect(stmt.transactions.filter(t => t.type === 'payment')).toHaveLength(1);
    expect(stmt.closingBalance).toBe(inv.totalAmount - 200);
  });

  it('sorts mixed transaction types chronologically with a correct cumulative balance', async () => {
    const inv = invoice({ createdAt: new Date('2026-01-01'), totalAmount: 1000 });
    const repos = makeRepos({
      invoices: [inv],
      paymentsByInvoice: {
        'inv-1': [payment({ paidOn: new Date('2026-01-10'), amount: 400 })],
      },
      creditNotesByInvoice: {
        'inv-1': [creditNote({ createdAt: new Date('2026-01-05'), amount: 100 })],
      },
    });
    const svc = new StatementService(repos);

    const stmt = await svc.generate('cust-1', new Date('2026-01-01'), new Date('2026-01-31'));

    expect(stmt.transactions.map(t => t.type)).toEqual(['invoice', 'credit_note', 'payment']);
    // running balance: 1000 -> 900 (credit note) -> 500 (payment)
    expect(stmt.transactions.map(t => t.balance)).toEqual([1000, 900, 500]);
    expect(stmt.closingBalance).toBe(500);
  });
});
