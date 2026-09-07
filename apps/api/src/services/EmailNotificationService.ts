import { RepositoryContainer } from '@loopnest/bizcore-db';
import { sendMail } from '../lib/mailer.js';
import { emailNotificationsTotal } from '../observability/metrics.js';

export class EmailNotificationService {
  constructor(private repos: RepositoryContainer) {}

  async sendInvoiceIssued(invoiceId: string): Promise<void> {
    const invoice = await this.repos.invoices.findById(invoiceId);
    if (!invoice) return;

    const customer = await this.repos.customers.findById(invoice.customerId);
    if (!customer?.email) return;

    await sendMail({
      to: customer.email,
      subject: `[LoopNest] Invoice ${invoice.invoiceNumber} issued`,
      text: [
        `Dear ${customer.name},`,
        '',
        `Invoice ${invoice.invoiceNumber} has been issued.`,
        `Total: ${invoice.totalAmount.toLocaleString()} JPY`,
        '',
        'Thank you for your business.',
      ].join('\n'),
    });

    emailNotificationsTotal.inc({ type: 'invoice_issued' });
  }

  async sendPaymentReminder(invoiceId: string): Promise<void> {
    const invoice = await this.repos.invoices.findById(invoiceId);
    if (!invoice || invoice.status === 'paid') return;

    const customer = await this.repos.customers.findById(invoice.customerId);
    if (!customer?.email) return;

    await sendMail({
      to: customer.email,
      subject: `[LoopNest] Payment reminder: Invoice ${invoice.invoiceNumber}`,
      text: [
        `Dear ${customer.name},`,
        '',
        `This is a reminder that Invoice ${invoice.invoiceNumber} (${invoice.totalAmount.toLocaleString()} JPY) is outstanding.`,
        '',
        'Please arrange payment at your earliest convenience.',
      ].join('\n'),
    });

    emailNotificationsTotal.inc({ type: 'payment_reminder' });
  }

  async sendOverdueAlert(invoiceId: string, daysOverdue: number): Promise<void> {
    const invoice = await this.repos.invoices.findById(invoiceId);
    if (!invoice) return;

    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) return;

    await sendMail({
      to: adminEmail,
      subject: `[LoopNest] OVERDUE: Invoice ${invoice.invoiceNumber} (${daysOverdue}d)`,
      text: [
        `Invoice ${invoice.invoiceNumber} is ${daysOverdue} day(s) overdue.`,
        `Customer ID: ${invoice.customerId}`,
        `Amount: ${invoice.totalAmount.toLocaleString()} JPY`,
      ].join('\n'),
    });

    emailNotificationsTotal.inc({ type: 'overdue_alert' });
  }
}
