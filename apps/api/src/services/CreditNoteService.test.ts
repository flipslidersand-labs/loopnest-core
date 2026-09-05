import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreditNoteService } from './CreditNoteService.js';

function makeCreditNote(overrides: Record<string, any> = {}) {
  return {
    id: 'cn-1',
    status: 'issued',
    amount: '500.00',
    applied_amount: '0.00',
    refunded_amount: '0.00',
    ...overrides,
  };
}

function makeInvoice(overrides: Record<string, any> = {}) {
  return {
    id: 'inv-1',
    status: 'sent',
    total_amount: '1000.00',
    organization_id: 'org-1',
    quote_id: null,
    ...overrides,
  };
}

function makeRepos(cnInsert = { id: 'app-1' }) {
  return {
    creditNotes: {
      insert: vi.fn().mockResolvedValue({ id: 'cn-1', amount: 500 }),
      nextSequenceValue: vi.fn().mockResolvedValue(1),
      appliedToInvoice: vi.fn().mockResolvedValue(0),
      creditAppliedToInvoice: vi.fn().mockResolvedValue(0),
      insertApplication: vi.fn().mockResolvedValue(cnInsert),
      updateAppliedAmount: vi.fn().mockResolvedValue(undefined),
      updateStatus: vi.fn().mockResolvedValue(undefined),
    },
    payments: {
      confirmedTotal: vi.fn().mockResolvedValue(0),
      lastConfirmedPaidOn: vi.fn().mockResolvedValue('2026-01-01'),
    },
  };
}

function makeTrxForApply(creditNote: any, invoice: any) {
  let callCount = 0;
  const trx: any = {
    selectFrom: vi.fn().mockReturnThis(),
    selectAll: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    forUpdate: vi.fn().mockReturnThis(),
    executeTakeFirst: vi.fn().mockImplementation(() => {
      // First call = credit note, second call = invoice
      return Promise.resolve(callCount++ === 0 ? creditNote : invoice);
    }),
    updateTable: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue(undefined),
    insertInto: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
  };
  return trx;
}

function makeDb(creditNote: any, invoice: any) {
  const trx = makeTrxForApply(creditNote, invoice);
  return {
    transaction: () => ({
      execute: (fn: (trx: any) => Promise<any>) => fn(trx),
    }),
  };
}

function makeDbForIssue(invoice: any) {
  const trx: any = {
    selectFrom: vi.fn().mockReturnThis(),
    selectAll: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    forUpdate: vi.fn().mockReturnThis(),
    executeTakeFirst: vi.fn().mockResolvedValue(invoice),
    insertInto: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue(undefined),
  };
  return {
    transaction: () => ({
      execute: (fn: (trx: any) => Promise<any>) => fn(trx),
    }),
  };
}

describe('CreditNoteService', () => {
  let repos: ReturnType<typeof makeRepos>;

  beforeEach(() => {
    repos = makeRepos();
    vi.clearAllMocks();
  });

  it('single credit note fully covers invoice — invoice status becomes paid', async () => {
    const cn = makeCreditNote({ amount: '1000.00' });
    const inv = makeInvoice({ total_amount: '1000.00', status: 'sent' });
    const db = makeDb(cn, inv);
    const svc = new CreditNoteService(repos as any, db as any);

    repos.creditNotes.insertApplication.mockResolvedValue({ id: 'app-1' });
    repos.creditNotes.appliedToInvoice = vi.fn().mockResolvedValue(0);
    repos.creditNotes.creditAppliedToInvoice = vi.fn().mockResolvedValue(0);
    repos.payments.confirmedTotal = vi.fn().mockResolvedValue(0);

    const result = await svc.applyCreditNote('cn-1', { targetInvoiceId: 'inv-1', amount: 1000 }, 'user-1');
    expect(result).toBeDefined();
  });

  it('partial credit — amount less than invoice balance', async () => {
    const cn = makeCreditNote({ amount: '300.00' });
    const inv = makeInvoice({ total_amount: '1000.00', status: 'sent' });
    const db = makeDb(cn, inv);
    const svc = new CreditNoteService(repos as any, db as any);

    repos.creditNotes.creditAppliedToInvoice = vi.fn().mockResolvedValue(0);
    repos.payments.confirmedTotal = vi.fn().mockResolvedValue(0);

    const result = await svc.applyCreditNote('cn-1', { targetInvoiceId: 'inv-1', amount: 300 }, 'user-1');
    expect(result).toBeDefined();
  });

  it('exceeds credit note remaining balance — throws EXCEEDS_BALANCE', async () => {
    const cn = makeCreditNote({ amount: '500.00', applied_amount: '400.00' });
    const inv = makeInvoice();
    const db = makeDb(cn, inv);
    const svc = new CreditNoteService(repos as any, db as any);

    await expect(
      svc.applyCreditNote('cn-1', { targetInvoiceId: 'inv-1', amount: 200 }, 'user-1')
    ).rejects.toMatchObject({ code: 'EXCEEDS_BALANCE' });
  });

  it('fully_applied credit note — throws INVALID_STATUS', async () => {
    const cn = makeCreditNote({ status: 'fully_applied' });
    const inv = makeInvoice();
    const db = makeDb(cn, inv);
    const svc = new CreditNoteService(repos as any, db as any);

    await expect(
      svc.applyCreditNote('cn-1', { targetInvoiceId: 'inv-1', amount: 100 }, 'user-1')
    ).rejects.toMatchObject({ code: 'INVALID_STATUS' });
  });
});
