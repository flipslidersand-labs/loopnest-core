import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InvoiceService } from './InvoiceService.js';
import { ApiErrorResponse } from '../middleware/errorHandler.js';

function makeQuote(overrides: Record<string, any> = {}) {
  return {
    id: 'quote-1',
    status: 'approved',
    customerId: 'cust-1',
    subtotalAmount: 1000,
    discountAmount: 0,
    ...overrides,
  };
}

function makeRepos(overrides: Record<string, any> = {}) {
  return {
    quotes: {
      findWithItems: vi.fn().mockResolvedValue(makeQuote()),
    },
    taxRates: {
      findDefault: vi.fn().mockResolvedValue({ rate: 0.1 }),
    },
    customers: {
      getCreditStatus: vi.fn().mockResolvedValue(null),
      incrementCreditUsed: vi.fn().mockResolvedValue(undefined),
    },
    invoices: {
      nextSequenceValue: vi.fn().mockResolvedValue(1),
      create: vi.fn().mockResolvedValue({
        id: 'inv-1',
        createdAt: new Date('2026-01-01'),
      }),
      addItems: vi.fn().mockResolvedValue(undefined),
      findByQuoteId: vi.fn().mockResolvedValue(null),
      findById: vi.fn().mockResolvedValue(null),
    },
    quoteItems: {
      findByQuote: vi.fn().mockResolvedValue([]),
    },
    outbox: {
      publish: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };
}

function makeEmailNotifications() {
  return { sendInvoiceIssued: vi.fn().mockResolvedValue(undefined) };
}

describe('InvoiceService — pure calculations', () => {
  let svc: InvoiceService;

  beforeEach(() => {
    svc = new InvoiceService(makeRepos() as any, makeEmailNotifications() as any);
  });

  describe('calculateTax', () => {
    it('applies 10% default rate', () => {
      expect(svc.calculateTax(1000)).toBe(100);
    });

    it('rounds to 2 decimal places', () => {
      expect(svc.calculateTax(100, 0.15)).toBe(15);
      expect(svc.calculateTax(100, 0.333)).toBe(33.3);
    });

    it('returns 0 for zero subtotal', () => {
      expect(svc.calculateTax(0)).toBe(0);
    });
  });

  describe('calculateSubtotal', () => {
    it('sums quantity × unitPrice', () => {
      expect(
        svc.calculateSubtotal([
          { quantity: 2, unitPrice: 100 },
          { quantity: 3, unitPrice: 50 },
        ])
      ).toBe(350);
    });

    it('returns 0 for empty items', () => {
      expect(svc.calculateSubtotal([])).toBe(0);
    });

    it('handles fractional unit prices', () => {
      expect(svc.calculateSubtotal([{ quantity: 3, unitPrice: 33.33 }])).toBeCloseTo(99.99);
    });
  });

  describe('validateAmounts', () => {
    it('returns true when amounts match exactly', () => {
      expect(svc.validateAmounts(1000, 1000)).toBe(true);
    });

    it('returns true within default tolerance of 1', () => {
      expect(svc.validateAmounts(1000, 1000.5)).toBe(true);
      expect(svc.validateAmounts(1000, 999)).toBe(true);
    });

    it('returns false outside tolerance', () => {
      expect(svc.validateAmounts(1000, 1002)).toBe(false);
    });

    it('respects custom tolerance', () => {
      expect(svc.validateAmounts(1000, 1005, 5)).toBe(true);
      expect(svc.validateAmounts(1000, 1006, 5)).toBe(false);
    });
  });
});

describe('InvoiceService — createFromQuote', () => {
  it('rejects non-approved quote', async () => {
    const repos = makeRepos({
      quotes: { findWithItems: vi.fn().mockResolvedValue(makeQuote({ status: 'draft' })) },
    });
    const svc = new InvoiceService(repos as any, makeEmailNotifications() as any);
    await expect(svc.createFromQuote('quote-1', 'user-1')).rejects.toThrow(ApiErrorResponse);
  });

  it('accepts invoiced status (re-create guard)', async () => {
    const repos = makeRepos({
      quotes: { findWithItems: vi.fn().mockResolvedValue(makeQuote({ status: 'invoiced' })) },
    });
    const svc = new InvoiceService(repos as any, makeEmailNotifications() as any);
    await expect(svc.createFromQuote('quote-1', 'user-1')).resolves.toMatchObject({
      invoiceId: 'inv-1',
      quoteId: 'quote-1',
    });
  });

  it('throws 404 when quote not found', async () => {
    const repos = makeRepos({
      quotes: { findWithItems: vi.fn().mockResolvedValue(null) },
    });
    const svc = new InvoiceService(repos as any, makeEmailNotifications() as any);
    await expect(svc.createFromQuote('no-such', 'user-1')).rejects.toThrow(ApiErrorResponse);
  });

  it('rejects when total exceeds available credit', async () => {
    const repos = makeRepos({
      customers: {
        getCreditStatus: vi.fn().mockResolvedValue({
          isUnlimited: false,
          creditAvailable: 50,
          creditLimit: 1000,
          creditUsed: 950,
        }),
        incrementCreditUsed: vi.fn(),
      },
    });
    const svc = new InvoiceService(repos as any, makeEmailNotifications() as any);
    // quote subtotal=1000, tax 10% → total=1100 > available=50
    const err = await svc.createFromQuote('quote-1', 'user-1').catch((e) => e);
    expect(err).toBeInstanceOf(ApiErrorResponse);
    expect((err as ApiErrorResponse).code).toBe('CREDIT_LIMIT_EXCEEDED');
    expect((err as ApiErrorResponse).statusCode).toBe(422);
  });

  it('skips credit check for unlimited customers', async () => {
    const repos = makeRepos({
      customers: {
        getCreditStatus: vi.fn().mockResolvedValue({ isUnlimited: true }),
        incrementCreditUsed: vi.fn().mockResolvedValue(undefined),
      },
    });
    const svc = new InvoiceService(repos as any, makeEmailNotifications() as any);
    await expect(svc.createFromQuote('quote-1', 'user-1')).resolves.toMatchObject({ invoiceId: 'inv-1' });
  });

  it('publishes invoice_created outbox event', async () => {
    const repos = makeRepos();
    const svc = new InvoiceService(repos as any, makeEmailNotifications() as any);
    await svc.createFromQuote('quote-1', 'user-1');
    expect((repos.outbox.publish as any).mock.calls[0][0]).toBe('invoice_created');
  });

  it('increments customer credit usage on success', async () => {
    const repos = makeRepos();
    const svc = new InvoiceService(repos as any, makeEmailNotifications() as any);
    await svc.createFromQuote('quote-1', 'user-1');
    expect((repos.customers.incrementCreditUsed as any)).toHaveBeenCalledWith('cust-1', expect.any(Number));
  });

  it('applies discount to taxable amount', async () => {
    const repos = makeRepos({
      quotes: {
        findWithItems: vi.fn().mockResolvedValue(
          makeQuote({ subtotalAmount: 1000, discountAmount: 200 })
        ),
      },
    });
    const svc = new InvoiceService(repos as any, makeEmailNotifications() as any);
    const result = await svc.createFromQuote('quote-1', 'user-1');
    // taxable=800, tax=80, total=880
    expect((repos.invoices.create as any).mock.calls[0][0].totalAmount).toBe(880);
    expect(result.totalAmount).toBe(880);
  });

  it('falls back to 10% when no default tax rate exists', async () => {
    const repos = makeRepos({
      taxRates: { findDefault: vi.fn().mockResolvedValue(null) },
    });
    const svc = new InvoiceService(repos as any, makeEmailNotifications() as any);
    const result = await svc.createFromQuote('quote-1', 'user-1');
    // 1000 subtotal * 1.1 = 1100
    expect(result.totalAmount).toBe(1100);
  });
});

describe('InvoiceService — findByQuoteIds', () => {
  it('returns mapped quoteId→invoiceId pairs', async () => {
    const repos = makeRepos({
      invoices: {
        nextSequenceValue: vi.fn(),
        create: vi.fn(),
        findByQuoteId: vi.fn().mockImplementation((qid: string) =>
          qid === 'q-1' ? { id: 'inv-1' } : null
        ),
        findById: vi.fn(),
      },
    });
    const svc = new InvoiceService(repos as any, makeEmailNotifications() as any);
    const result = await svc.findByQuoteIds(['q-1', 'q-2']);
    expect(result).toEqual([{ quoteId: 'q-1', invoiceId: 'inv-1' }]);
  });

  it('returns empty array when no matches', async () => {
    const repos = makeRepos({
      invoices: {
        nextSequenceValue: vi.fn(),
        create: vi.fn(),
        findByQuoteId: vi.fn().mockResolvedValue(null),
        findById: vi.fn(),
      },
    });
    const svc = new InvoiceService(repos as any, makeEmailNotifications() as any);
    expect(await svc.findByQuoteIds(['x', 'y'])).toEqual([]);
  });
});
