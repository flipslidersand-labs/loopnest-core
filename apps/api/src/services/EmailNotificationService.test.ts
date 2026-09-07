import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmailNotificationService } from './EmailNotificationService.js';

vi.mock('../lib/mailer.js', () => ({ sendMail: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../observability/metrics.js', () => ({
  emailNotificationsTotal: { inc: vi.fn() },
}));

import { sendMail } from '../lib/mailer.js';
import { emailNotificationsTotal } from '../observability/metrics.js';

const mockSendMail = sendMail as ReturnType<typeof vi.fn>;
const mockInc = (emailNotificationsTotal.inc as ReturnType<typeof vi.fn>);

function makeInvoice(overrides: Record<string, any> = {}) {
  return {
    id: 'inv-1',
    invoiceNumber: 'INV-202601-000001',
    customerId: 'cust-1',
    totalAmount: 1000,
    status: 'issued',
    ...overrides,
  };
}

function makeCustomer(overrides: Record<string, any> = {}) {
  return {
    id: 'cust-1',
    name: 'Acme Corp',
    email: 'billing@acme.example',
    ...overrides,
  };
}

function makeRepos(invoiceOverride?: any, customerOverride?: any) {
  return {
    invoices: {
      findById: vi.fn().mockResolvedValue(invoiceOverride !== undefined ? invoiceOverride : makeInvoice()),
    },
    customers: {
      findById: vi.fn().mockResolvedValue(customerOverride !== undefined ? customerOverride : makeCustomer()),
    },
  };
}

beforeEach(() => {
  mockSendMail.mockClear();
  mockInc.mockClear();
});

describe('EmailNotificationService — sendInvoiceIssued', () => {
  it('sends email and increments counter', async () => {
    const svc = new EmailNotificationService(makeRepos() as any);
    await svc.sendInvoiceIssued('inv-1');
    expect(mockSendMail).toHaveBeenCalledOnce();
    expect(mockSendMail.mock.calls[0][0].to).toBe('billing@acme.example');
    expect(mockSendMail.mock.calls[0][0].subject).toContain('INV-202601-000001');
    expect(mockInc).toHaveBeenCalledWith({ type: 'invoice_issued' });
  });

  it('skips when invoice not found', async () => {
    const svc = new EmailNotificationService(makeRepos(null) as any);
    await svc.sendInvoiceIssued('no-such');
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(mockInc).not.toHaveBeenCalled();
  });

  it('skips when customer has no email', async () => {
    const svc = new EmailNotificationService(makeRepos(undefined, makeCustomer({ email: undefined })) as any);
    await svc.sendInvoiceIssued('inv-1');
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});

describe('EmailNotificationService — sendPaymentReminder', () => {
  it('sends reminder for outstanding invoice', async () => {
    const svc = new EmailNotificationService(makeRepos() as any);
    await svc.sendPaymentReminder('inv-1');
    expect(mockSendMail).toHaveBeenCalledOnce();
    expect(mockSendMail.mock.calls[0][0].subject).toContain('reminder');
    expect(mockInc).toHaveBeenCalledWith({ type: 'payment_reminder' });
  });

  it('skips when invoice is already paid', async () => {
    const svc = new EmailNotificationService(makeRepos(makeInvoice({ status: 'paid' })) as any);
    await svc.sendPaymentReminder('inv-1');
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('skips when invoice not found', async () => {
    const svc = new EmailNotificationService(makeRepos(null) as any);
    await svc.sendPaymentReminder('no-such');
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});

describe('EmailNotificationService — sendOverdueAlert', () => {
  const originalAdminEmail = process.env.ADMIN_EMAIL;

  afterEach(() => {
    if (originalAdminEmail === undefined) {
      delete process.env.ADMIN_EMAIL;
    } else {
      process.env.ADMIN_EMAIL = originalAdminEmail;
    }
  });

  it('sends alert to ADMIN_EMAIL with days overdue', async () => {
    process.env.ADMIN_EMAIL = 'admin@loopnest.example';
    const svc = new EmailNotificationService(makeRepos() as any);
    await svc.sendOverdueAlert('inv-1', 7);
    expect(mockSendMail).toHaveBeenCalledOnce();
    expect(mockSendMail.mock.calls[0][0].to).toBe('admin@loopnest.example');
    expect(mockSendMail.mock.calls[0][0].subject).toContain('7');
    expect(mockInc).toHaveBeenCalledWith({ type: 'overdue_alert' });
  });

  it('skips when ADMIN_EMAIL is not set', async () => {
    delete process.env.ADMIN_EMAIL;
    const svc = new EmailNotificationService(makeRepos() as any);
    await svc.sendOverdueAlert('inv-1', 3);
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(mockInc).not.toHaveBeenCalled();
  });

  it('skips when invoice not found', async () => {
    process.env.ADMIN_EMAIL = 'admin@loopnest.example';
    const svc = new EmailNotificationService(makeRepos(null) as any);
    await svc.sendOverdueAlert('no-such', 1);
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});
