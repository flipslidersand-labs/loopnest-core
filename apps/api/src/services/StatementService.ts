import type { RepositoryContainer } from '@loopnest/bizcore-db';
import { ApiErrorResponse } from '../middleware/errorHandler.js';

export interface StatementTransaction {
  date: Date;
  type: 'invoice' | 'payment' | 'credit_note';
  ref: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface CustomerStatement {
  customer: { id: string; name: string };
  period: { from: string; to: string };
  openingBalance: number;
  transactions: StatementTransaction[];
  closingBalance: number;
}

export class StatementService {
  constructor(private repos: RepositoryContainer) {}

  async generate(customerId: string, from: Date, to: Date, orgId?: string): Promise<CustomerStatement> {
    const customer = await this.repos.customers.findById(customerId, orgId);
    if (!customer) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Customer not found');

    // Fetch every invoice for the customer (not just those within [from, to])
    // so pre-period activity can be folded into a real opening balance.
    const invoices = await this.repos.invoices.findAll({
      customerId,
      take: 1000,
    });

    const allPayments = await Promise.all(
      invoices.map(inv => this.repos.payments.listByInvoice(inv.id))
    );
    const allCreditNotes = await Promise.all(
      invoices.map(inv => this.repos.creditNotes.list({ invoiceId: inv.id, take: 1000 }))
    );

    type Entry = Omit<StatementTransaction, 'balance'>;
    const entries: Entry[] = [];

    for (const inv of invoices) {
      entries.push({
        date: new Date(inv.createdAt),
        type: 'invoice',
        ref: inv.invoiceNumber,
        description: `Invoice ${inv.invoiceNumber}`,
        debit: inv.totalAmount,
        credit: 0,
      });
    }

    for (const payList of allPayments) {
      for (const p of payList) {
        if (p.status === 'reversed') continue;
        entries.push({
          date: new Date(p.paidOn),
          type: 'payment',
          ref: p.reference ?? p.id.slice(0, 8),
          description: `Payment (${p.method})`,
          debit: 0,
          credit: p.amount,
        });
      }
    }

    for (const cnList of allCreditNotes) {
      for (const cn of cnList) {
        entries.push({
          date: new Date(cn.createdAt),
          type: 'credit_note',
          ref: cn.creditNumber,
          description: `Credit Note ${cn.creditNumber}`,
          debit: 0,
          credit: cn.amount,
        });
      }
    }

    entries.sort((a, b) => a.date.getTime() - b.date.getTime());

    // Single chronological pass: entries before `from` accumulate into
    // openingBalance (and are not listed); entries in [from, to] are listed
    // with a running balance that continues on from the opening balance;
    // entries after `to` are ignored entirely.
    let balance = 0;
    let openingBalance = 0;
    const transactions: StatementTransaction[] = [];
    for (const e of entries) {
      if (e.date > to) continue;
      balance += e.debit - e.credit;
      if (e.date < from) {
        openingBalance = balance;
        continue;
      }
      transactions.push({ ...e, balance });
    }

    const toISO = (d: Date) => d.toISOString().slice(0, 10);

    return {
      customer: { id: customer.id, name: customer.name },
      period: { from: toISO(from), to: toISO(to) },
      openingBalance,
      transactions,
      closingBalance: balance,
    };
  }
}
