export interface RevenuePeriod {
  period: string;
  invoiceCount: number;
  revenue: number;
}

export interface QuotePipelineStats {
  byStatus: Record<string, number>;
  total: number;
  conversionRate: number; // approved / (submitted + approved + rejected + invoiced)
}

export interface InvoiceAgingStats {
  byStatus: Record<string, { count: number; totalAmount: number }>;
  overdueCount: number;
  overdueAmount: number;
}

export interface DashboardSummary {
  totalCustomers: number;
  activeQuotes: number;       // draft + pending_approval
  outstandingAmount: number;  // issued + sent invoices
  paidThisMonth: number;
}

export interface TaxReportRow {
  month: string;        // YYYY-MM
  taxRate: number;      // percentage, e.g. 10
  taxableAmount: number;
  taxAmount: number;
  invoiceCount: number;
}

export interface TaxReport {
  period: { from: string; to: string };
  rows: TaxReportRow[];
  totals: { taxableAmount: number; taxAmount: number };
}

export interface AccountsReceivableReport {
  asOf: string;
  totalOutstanding: number;
  buckets: {
    current: number; // 0–30 days past due
    '31-60': number;
    '61-90': number;
    '90+': number;
  };
  byCustomer: Array<{ customerId: string; outstanding: number }>;
}

export interface MonthlySummary {
  month: string; // YYYY-MM
  grossRevenue: number;     // subtotal (excl. tax) from invoices issued this month
  taxAmount: number;        // tax from invoices issued this month
  totalBilled: number;      // grossRevenue + taxAmount
  paymentsReceived: number; // confirmed payments with paid_on in this month
  outstandingBalance: number; // open invoices as of month-end
  invoiceCount: number;
  paidCount: number;
}

export interface CashFlowPeriod {
  date: string;         // ISO date YYYY-MM-DD
  paymentsReceived: number;
  paymentCount: number;
}

export interface RevenueByCustomer {
  customerId: string;
  customerName: string;
  invoiceCount: number;
  totalRevenue: number; // sum of total_amount on paid invoices
}

import { sql, type Kysely } from 'kysely';
import type { KyselyDatabase } from '@loopnest/bizcore-db';

export class ReportingService {
  constructor(private readonly kyselyDb: Kysely<KyselyDatabase>) {}

  async getSummary(orgId?: string): Promise<DashboardSummary> {
    const orgQuoteFilter = orgId ? sql`AND organization_id = ${orgId}` : sql``;
    const orgJoin       = orgId ? sql`JOIN core.quotes q ON q.id = i.quote_id` : sql``;
    const orgInvFilter  = orgId ? sql`AND q.organization_id = ${orgId}` : sql``;

    const [custR, activeR, outstandingR, paidR] = await Promise.all([
      sql<{ count: string }>`
        SELECT COUNT(*) FROM core.customers
        ${orgId ? sql`WHERE organization_id = ${orgId}` : sql``}
      `.execute(this.kyselyDb),

      sql<{ count: string }>`
        SELECT COUNT(*) FROM core.quotes
        WHERE status IN ('draft', 'pending_approval')
        ${orgQuoteFilter}
      `.execute(this.kyselyDb),

      sql<{ total: string }>`
        SELECT COALESCE(SUM(i.total_amount), 0) AS total
        FROM finance.invoices i
        ${orgJoin}
        WHERE i.status IN ('issued', 'sent')
        ${orgInvFilter}
      `.execute(this.kyselyDb),

      sql<{ total: string }>`
        SELECT COALESCE(SUM(i.total_amount), 0) AS total
        FROM finance.invoices i
        ${orgJoin}
        WHERE i.status = 'paid'
          AND i.paid_at >= date_trunc('month', NOW())
          ${orgInvFilter}
      `.execute(this.kyselyDb),
    ]);

    return {
      totalCustomers:    Number.parseInt(custR.rows[0].count, 10),
      activeQuotes:      Number.parseInt(activeR.rows[0].count, 10),
      outstandingAmount: Number.parseFloat(outstandingR.rows[0].total),
      paidThisMonth:     Number.parseFloat(paidR.rows[0].total),
    };
  }

  async getRevenue(
    period: 'day' | 'week' | 'month' | 'quarter' | 'year' = 'month',
    dateFrom?: string,
    dateTo?: string,
    orgId?: string
  ): Promise<RevenuePeriod[]> {
    const VALID_PERIODS = new Set(['day', 'week', 'month', 'quarter', 'year']);
    const safePeriod = VALID_PERIODS.has(period) ? period : 'month';

    const conditions: ReturnType<typeof sql>[] = [sql`i.status = 'paid'`];
    if (dateFrom) conditions.push(sql`i.paid_at >= ${dateFrom}::timestamptz`);
    if (dateTo)   conditions.push(sql`i.paid_at <= ${dateTo}::timestamptz`);
    if (orgId)    conditions.push(sql`q.organization_id = ${orgId}`);

    const joinClause = orgId ? sql`JOIN core.quotes q ON q.id = i.quote_id` : sql``;
    const whereClause = sql`WHERE ${sql.join(conditions, sql` AND `)}`;

    interface RevenueRow { period: Date | string; invoice_count: string; revenue: string; }
    const result = await sql<RevenueRow>`
      SELECT
        date_trunc(${safePeriod}, i.paid_at) AS period,
        COUNT(*)                              AS invoice_count,
        COALESCE(SUM(i.total_amount), 0)     AS revenue
      FROM finance.invoices i
      ${joinClause}
      ${whereClause}
      GROUP BY 1
      ORDER BY 1 ASC
    `.execute(this.kyselyDb);

    return result.rows.map((r) => ({
      period:       r.period instanceof Date ? r.period.toISOString() : String(r.period),
      invoiceCount: Number.parseInt(r.invoice_count, 10),
      revenue:      Number.parseFloat(r.revenue),
    }));
  }

  async getQuotePipeline(orgId?: string): Promise<QuotePipelineStats> {
    const orgFilter = orgId ? sql`WHERE organization_id = ${orgId}` : sql``;

    interface PipelineRow { status: string; count: string; }
    const result = await sql<PipelineRow>`
      SELECT status, COUNT(*) AS count
      FROM core.quotes
      ${orgFilter}
      GROUP BY status
    `.execute(this.kyselyDb);

    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const row of result.rows) {
      byStatus[row.status] = Number.parseInt(row.count, 10);
      total += byStatus[row.status];
    }

    const submitted = (byStatus.pending_approval ?? 0) + (byStatus.approved ?? 0)
                    + (byStatus.rejected ?? 0) + (byStatus.invoiced ?? 0);
    const converted = (byStatus.approved ?? 0) + (byStatus.invoiced ?? 0);
    const conversionRate = submitted > 0 ? Math.round((converted / submitted) * 10000) / 100 : 0;

    return { byStatus, total, conversionRate };
  }

  async getInvoiceAging(orgId?: string): Promise<InvoiceAgingStats> {
    const joinClause = orgId ? sql`JOIN core.quotes q ON q.id = i.quote_id` : sql``;
    const orgFilter  = orgId ? sql`AND q.organization_id = ${orgId}` : sql``;

    interface AgingRow { status: string; count: string; total_amount: string; }
    interface OverdueRow { count: string; total_amount: string; }

    const [statusR, overdueR] = await Promise.all([
      sql<AgingRow>`
        SELECT i.status, COUNT(*) AS count, COALESCE(SUM(i.total_amount), 0) AS total_amount
        FROM finance.invoices i
        ${joinClause}
        WHERE 1=1 ${orgFilter}
        GROUP BY i.status
      `.execute(this.kyselyDb),

      sql<OverdueRow>`
        SELECT COUNT(*) AS count, COALESCE(SUM(i.total_amount), 0) AS total_amount
        FROM finance.invoices i
        ${joinClause}
        WHERE i.status IN ('issued', 'sent')
          AND i.created_at < NOW() - INTERVAL '30 days'
          ${orgFilter}
      `.execute(this.kyselyDb),
    ]);

    const byStatus: Record<string, { count: number; totalAmount: number }> = {};
    for (const row of statusR.rows) {
      byStatus[row.status] = {
        count:       Number.parseInt(row.count, 10),
        totalAmount: Number.parseFloat(row.total_amount),
      };
    }

    return {
      byStatus,
      overdueCount:  Number.parseInt(overdueR.rows[0].count, 10),
      overdueAmount: Number.parseFloat(overdueR.rows[0].total_amount),
    };
  }

  async getMonthlySummary(month: string, orgId?: string): Promise<MonthlySummary> {
    const monthStart = `${month}-01`;
    const joinClause = orgId ? sql`JOIN core.quotes q ON q.id = i.quote_id` : sql``;
    const orgFilter  = orgId ? sql`AND q.organization_id = ${orgId}` : sql``;

    interface InvoiceMonthRow {
      gross_revenue: string;
      tax_amount: string;
      invoice_count: string;
      paid_count: string;
    }

    const [invoiceR, paymentR, outstandingR] = await Promise.all([
      sql<InvoiceMonthRow>`
        SELECT
          COALESCE(SUM(i.subtotal_amount), 0) AS gross_revenue,
          COALESCE(SUM(i.tax_amount), 0)      AS tax_amount,
          COUNT(*)                             AS invoice_count,
          COUNT(*) FILTER (WHERE i.status = 'paid') AS paid_count
        FROM finance.invoices i
        ${joinClause}
        WHERE date_trunc('month', i.created_at) = ${monthStart}::date
          ${orgFilter}
      `.execute(this.kyselyDb),

      sql<{ total: string }>`
        SELECT COALESCE(SUM(p.amount), 0) AS total
        FROM finance.payments p
        WHERE p.status = 'confirmed'
          AND date_trunc('month', p.paid_on) = ${monthStart}::date
          ${orgId ? sql`AND EXISTS (
            SELECT 1 FROM finance.invoices i
            JOIN core.quotes q ON q.id = i.quote_id
            WHERE i.id = p.invoice_id AND q.organization_id = ${orgId}
          )` : sql``}
      `.execute(this.kyselyDb),

      sql<{ total: string }>`
        SELECT COALESCE(SUM(i.total_amount), 0) AS total
        FROM finance.invoices i
        ${joinClause}
        WHERE i.status IN ('issued', 'sent', 'partially_paid')
          AND i.created_at <= (${monthStart}::date + INTERVAL '1 month - 1 day')
          ${orgFilter}
      `.execute(this.kyselyDb),
    ]);

    const round = (n: number): number => Math.round(n * 100) / 100;
    const r = invoiceR.rows[0];
    const grossRevenue = round(Number.parseFloat(r.gross_revenue));
    const taxAmount    = round(Number.parseFloat(r.tax_amount));
    return {
      month,
      grossRevenue,
      taxAmount,
      totalBilled:        round(grossRevenue + taxAmount),
      paymentsReceived:   round(Number.parseFloat(paymentR.rows[0].total)),
      outstandingBalance: round(Number.parseFloat(outstandingR.rows[0].total)),
      invoiceCount: Number.parseInt(r.invoice_count, 10),
      paidCount:    Number.parseInt(r.paid_count, 10),
    };
  }

  async getCashFlow(from: string, to: string, orgId?: string): Promise<CashFlowPeriod[]> {
    interface CashFlowRow { date: Date | string; total: string; count: string; }
    const result = await sql<CashFlowRow>`
      SELECT
        p.paid_on::date AS date,
        COALESCE(SUM(p.amount), 0) AS total,
        COUNT(*) AS count
      FROM finance.payments p
      WHERE p.status = 'confirmed'
        AND p.paid_on >= ${from}::date
        AND p.paid_on <= ${to}::date
        ${orgId ? sql`AND EXISTS (
          SELECT 1 FROM finance.invoices i
          JOIN core.quotes q ON q.id = i.quote_id
          WHERE i.id = p.invoice_id AND q.organization_id = ${orgId}
        )` : sql``}
      GROUP BY 1
      ORDER BY 1 ASC
    `.execute(this.kyselyDb);

    return result.rows.map((r) => ({
      date:             r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date),
      paymentsReceived: Math.round(Number.parseFloat(r.total) * 100) / 100,
      paymentCount:     Number.parseInt(r.count, 10),
    }));
  }

  async getRevenueByCustomer(month: string, orgId?: string): Promise<RevenueByCustomer[]> {
    const monthStart = `${month}-01`;
    const joinClause = orgId ? sql`JOIN core.quotes q ON q.id = i.quote_id` : sql``;
    const orgFilter  = orgId ? sql`AND q.organization_id = ${orgId}` : sql``;

    interface RevByCustomerRow {
      customer_id: string;
      customer_name: string;
      invoice_count: string;
      total_revenue: string;
    }
    const result = await sql<RevByCustomerRow>`
      SELECT
        i.customer_id,
        c.name AS customer_name,
        COUNT(*) AS invoice_count,
        COALESCE(SUM(i.total_amount), 0) AS total_revenue
      FROM finance.invoices i
      ${joinClause}
      JOIN core.customers c ON c.id = i.customer_id
      WHERE i.status = 'paid'
        AND date_trunc('month', i.paid_at) = ${monthStart}::date
        ${orgFilter}
      GROUP BY i.customer_id, c.name
      ORDER BY total_revenue DESC
      LIMIT 50
    `.execute(this.kyselyDb);

    return result.rows.map((r) => ({
      customerId:   r.customer_id,
      customerName: r.customer_name,
      invoiceCount: Number.parseInt(r.invoice_count, 10),
      totalRevenue: Math.round(Number.parseFloat(r.total_revenue) * 100) / 100,
    }));
  }

  async getTaxReport(from: string, to: string, orgId?: string): Promise<TaxReport> {
    interface TaxRow {
      month: Date | string;
      tax_rate_pct: string;
      taxable_amount: string;
      tax_amount: string;
      invoice_count: string;
    }

    const joinClause = orgId ? sql`JOIN core.quotes q ON q.id = i.quote_id` : sql``;
    const orgFilter  = orgId ? sql`AND q.organization_id = ${orgId}` : sql``;

    const result = await sql<TaxRow>`
      SELECT
        to_char(date_trunc('month', i.issue_date), 'YYYY-MM') AS month,
        ROUND(COALESCE(tr.rate, i.tax_amount / NULLIF(i.subtotal_amount, 0)) * 100)
          AS tax_rate_pct,
        COALESCE(SUM(i.subtotal_amount), 0) AS taxable_amount,
        COALESCE(SUM(i.tax_amount), 0)      AS tax_amount,
        COUNT(*)                            AS invoice_count
      FROM finance.invoices i
      ${joinClause}
      LEFT JOIN core.tax_rates tr ON tr.id = i.tax_rate_id
      WHERE i.issue_date >= ${from}::date
        AND i.issue_date <= ${to}::date
        AND i.status NOT IN ('draft', 'cancelled')
        ${orgFilter}
      GROUP BY 1, 2
      ORDER BY 1 ASC, 2 ASC
    `.execute(this.kyselyDb);

    const round = (n: number) => Math.round(n * 100) / 100;
    const rows: TaxReportRow[] = result.rows.map((r) => ({
      month:         String(r.month),
      taxRate:       Number.parseFloat(r.tax_rate_pct) || 0,
      taxableAmount: round(Number.parseFloat(r.taxable_amount)),
      taxAmount:     round(Number.parseFloat(r.tax_amount)),
      invoiceCount:  Number.parseInt(r.invoice_count, 10),
    }));

    const totals = rows.reduce(
      (acc, r) => ({ taxableAmount: acc.taxableAmount + r.taxableAmount, taxAmount: acc.taxAmount + r.taxAmount }),
      { taxableAmount: 0, taxAmount: 0 }
    );

    return { period: { from, to }, rows, totals: { taxableAmount: round(totals.taxableAmount), taxAmount: round(totals.taxAmount) } };
  }

  async getAccountsReceivable(orgId?: string, asOf?: string): Promise<AccountsReceivableReport> {
    const asOfExpr   = asOf ? sql`${asOf}::date` : sql`CURRENT_DATE`;
    const joinClause = orgId ? sql`JOIN core.quotes q ON q.id = i.quote_id` : sql``;
    const orgFilter  = orgId ? sql`AND q.organization_id = ${orgId}` : sql``;

    interface ARRow { customer_id: string; outstanding: string; days_overdue: string; }
    const result = await sql<ARRow>`
      SELECT i.customer_id,
             (i.total_amount - COALESCE(p.paid, 0) - COALESCE(cn.applied, 0)) AS outstanding,
             GREATEST(
               ${asOfExpr} - COALESCE(i.payment_due_date, i.issue_date, i.created_at::date),
               0
             ) AS days_overdue
        FROM finance.invoices i
        ${joinClause}
        LEFT JOIN (
          SELECT invoice_id, SUM(amount) AS paid
            FROM finance.payments
           WHERE status = 'confirmed'
           GROUP BY invoice_id
        ) p ON p.invoice_id = i.id
        LEFT JOIN (
          SELECT invoice_id, SUM(amount) AS applied
            FROM finance.credit_note_applications
           GROUP BY invoice_id
        ) cn ON cn.invoice_id = i.id
       WHERE i.status IN ('issued', 'sent', 'partially_paid')
         ${orgFilter}
    `.execute(this.kyselyDb);

    const round = (n: number): number => Math.round(n * 100) / 100;
    const buckets = { current: 0, c31: 0, c61: 0, c90: 0 };
    const byCustomer = new Map<string, number>();
    let totalOutstanding = 0;

    for (const row of result.rows) {
      const outstanding = Number.parseFloat(row.outstanding);
      if (!(outstanding > 0)) continue;
      const days = Number.parseInt(row.days_overdue, 10);

      if (days <= 30) buckets.current += outstanding;
      else if (days <= 60) buckets.c31 += outstanding;
      else if (days <= 90) buckets.c61 += outstanding;
      else buckets.c90 += outstanding;

      totalOutstanding += outstanding;
      byCustomer.set(row.customer_id, (byCustomer.get(row.customer_id) ?? 0) + outstanding);
    }

    return {
      asOf: asOf ?? new Date().toISOString().slice(0, 10),
      totalOutstanding: round(totalOutstanding),
      buckets: {
        current: round(buckets.current),
        '31-60': round(buckets.c31),
        '61-90': round(buckets.c61),
        '90+': round(buckets.c90),
      },
      byCustomer: [...byCustomer.entries()]
        .map(([customerId, outstanding]) => ({ customerId, outstanding: round(outstanding) }))
        .sort((a, b) => b.outstanding - a.outstanding),
    };
  }
}
