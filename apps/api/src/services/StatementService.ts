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

    const invoices = await this.repos.invoices.findAll({
      customerId,
      take: 1000,
    });

    const customerInvoices = invoices.filter(inv => {
      const d = new Date(inv.createdAt);
      return d >= from && d <= to;
    });

    const allPayments = await Promise.all(
      customerInvoices.map(inv => this.repos.payments.listByInvoice(inv.id))
    );
    const allCreditNotes = await Promise.all(
      customerInvoices.map(inv => this.repos.creditNotes.list({ invoiceId: inv.id, take: 1000 }))
    );

    const transactions: StatementTransaction[] = [];

    for (const inv of customerInvoices) {
      transactions.push({
        date: new Date(inv.createdAt),
        type: 'invoice',
        ref: inv.invoiceNumber,
        description: `Invoice ${inv.invoiceNumber}`,
        debit: inv.totalAmount,
        credit: 0,
        balance: 0,
      });
    }

    for (const payList of allPayments) {
      for (const p of payList) {
        if (p.status === 'reversed') continue;
        const d = new Date(p.paidOn);
        if (d < from || d > to) continue;
        transactions.push({
          date: d,
          type: 'payment',
          ref: p.reference ?? p.id.slice(0, 8),
          description: `Payment (${p.method})`,
          debit: 0,
          credit: p.amount,
          balance: 0,
        });
      }
    }

    for (const cnList of allCreditNotes) {
      for (const cn of cnList) {
        const d = new Date(cn.createdAt);
        if (d < from || d > to) continue;
        transactions.push({
          date: d,
          type: 'credit_note',
          ref: cn.creditNumber,
          description: `Credit Note ${cn.creditNumber}`,
          debit: 0,
          credit: cn.amount,
          balance: 0,
        });
      }
    }

    transactions.sort((a, b) => a.date.getTime() - b.date.getTime());

    let balance = 0;
    for (const t of transactions) {
      balance += t.debit - t.credit;
      t.balance = balance;
    }

    const toISO = (d: Date) => d.toISOString().slice(0, 10);

    return {
      customer: { id: customer.id, name: customer.name },
      period: { from: toISO(from), to: toISO(to) },
      openingBalance: 0,
      transactions,
      closingBalance: balance,
    };
  }
}
