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

import { sql, type Kysely, type RawBuilder } from 'kysely';
import type { KyselyDatabase } from '@loopnest/bizcore-db';

export class ReportingService {
  constructor(private readonly db: Kysely<KyselyDatabase>) {}

  async getSummary(orgId?: string): Promise<DashboardSummary> {
    const orgCustCond: RawBuilder<unknown> = orgId ? sql`WHERE organization_id = ${orgId}` : sql``;
    const orgQuoteCond: RawBuilder<unknown> = orgId ? sql`AND organization_id = ${orgId}` : sql``;
    const orgJoin: RawBuilder<unknown> = orgId ? sql`JOIN core.quotes q ON q.id = i.quote_id` : sql``;
    const orgInvCond: RawBuilder<unknown> = orgId ? sql`AND q.organization_id = ${orgId}` : sql``;

    const [custR, activeR, outstandingR, paidR] = await Promise.all([
      // customer count
      sql<{ count: string }>`SELECT COUNT(*) AS count FROM core.customers ${orgCustCond}`.execute(this.db),
      // active quote count (draft + pending_approval)
      sql<{ count: string }>`SELECT COUNT(*) AS count FROM core.quotes WHERE status IN ('draft', 'pending_approval') ${orgQuoteCond}`.execute(this.db),
      // outstanding invoice amount (issued + sent)
      sql<{ total: string }>`SELECT COALESCE(SUM(i.total_amount), 0) AS total FROM finance.invoices i ${orgJoin} WHERE i.status IN ('issued', 'sent') ${orgInvCond}`.execute(this.db),
      // paid this calendar month
      sql<{ total: string }>`SELECT COALESCE(SUM(i.total_amount), 0) AS total FROM finance.invoices i ${orgJoin} WHERE i.status = 'paid' AND i.paid_at >= date_trunc('month', NOW()) ${orgInvCond}`.execute(this.db),
    ]);

    return {
      totalCustomers:    Number.parseInt(custR.rows[0].count as string, 10),
      activeQuotes:      Number.parseInt(activeR.rows[0].count as string, 10),
      outstandingAmount: Number.parseFloat(outstandingR.rows[0].total as string),
      paidThisMonth:     Number.parseFloat(paidR.rows[0].total as string),
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

    const conditions: RawBuilder<unknown>[] = [sql`i.status = 'paid'`];
    if (dateFrom) conditions.push(sql`i.paid_at >= ${dateFrom}`);
    if (dateTo)   conditions.push(sql`i.paid_at <= ${dateTo}`);
    if (orgId)    conditions.push(sql`q.organization_id = ${orgId}`);

    const joinClause: RawBuilder<unknown> = orgId ? sql`JOIN core.quotes q ON q.id = i.quote_id` : sql``;
    const whereClause = sql`WHERE ${sql.join(conditions, sql` AND `)}`;

    // safePeriod is validated against VALID_PERIODS so sql.raw is safe here.
    const result = await sql<{ period: Date; invoice_count: string; revenue: string }>`
      SELECT
        date_trunc(${sql.raw(`'${safePeriod}'`)}, i.paid_at) AS period,
        COUNT(*)                                AS invoice_count,
        COALESCE(SUM(i.total_amount), 0)       AS revenue
      FROM finance.invoices i
      ${joinClause}
      ${whereClause}
      GROUP BY 1
      ORDER BY 1 ASC
    `.execute(this.db);

    return result.rows.map((r) => ({
      period:       r.period instanceof Date ? r.period.toISOString() : String(r.period),
      invoiceCount: Number.parseInt(r.invoice_count as string, 10),
      revenue:      Number.parseFloat(r.revenue as string),
    }));
  }

  async getQuotePipeline(orgId?: string): Promise<QuotePipelineStats> {
    const orgFilter: RawBuilder<unknown> = orgId ? sql`WHERE organization_id = ${orgId}` : sql``;

    const result = await sql<{ status: string; count: string }>`
      SELECT status, COUNT(*) AS count
      FROM core.quotes
      ${orgFilter}
      GROUP BY status
    `.execute(this.db);

    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const row of result.rows) {
      byStatus[row.status as string] = Number.parseInt(row.count as string, 10);
      total += byStatus[row.status as string];
    }

    // Conversion: how many that entered the approval flow ended up approved/invoiced
    const submitted = (byStatus.pending_approval ?? 0) + (byStatus.approved ?? 0)
                    + (byStatus.rejected ?? 0) + (byStatus.invoiced ?? 0);
    const converted = (byStatus.approved ?? 0) + (byStatus.invoiced ?? 0);
    const conversionRate = submitted > 0 ? Math.round((converted / submitted) * 10000) / 100 : 0;

    return { byStatus, total, conversionRate };
  }

  async getInvoiceAging(orgId?: string): Promise<InvoiceAgingStats> {
    const joinClause: RawBuilder<unknown> = orgId ? sql`JOIN core.quotes q ON q.id = i.quote_id` : sql``;
    const orgFilter: RawBuilder<unknown> = orgId ? sql`AND q.organization_id = ${orgId}` : sql``;

    const [statusR, overdueR] = await Promise.all([
      sql<{ status: string; count: string; total_amount: string }>`
        SELECT i.status, COUNT(*) AS count, COALESCE(SUM(i.total_amount), 0) AS total_amount
        FROM finance.invoices i
        ${joinClause}
        WHERE 1=1 ${orgFilter}
        GROUP BY i.status
      `.execute(this.db),
      sql<{ count: string; total_amount: string }>`
        SELECT COUNT(*) AS count, COALESCE(SUM(i.total_amount), 0) AS total_amount
        FROM finance.invoices i
        ${joinClause}
        WHERE i.status IN ('issued', 'sent')
          AND i.created_at < NOW() - INTERVAL '30 days'
          ${orgFilter}
      `.execute(this.db),
    ]);

    const byStatus: Record<string, { count: number; totalAmount: number }> = {};
    for (const row of statusR.rows) {
      byStatus[row.status as string] = {
        count:       Number.parseInt(row.count as string, 10),
        totalAmount: Number.parseFloat(row.total_amount as string),
      };
    }

    return {
      byStatus,
      overdueCount:  Number.parseInt(overdueR.rows[0].count as string, 10),
      overdueAmount: Number.parseFloat(overdueR.rows[0].total_amount as string),
    };
  }

  /**
   * M13: accounts-receivable aging. Outstanding per open invoice is
   * total_amount minus its confirmed payments; each invoice is bucketed by how
   * many days past its due date it is, as of `asOf` (default today). Returns
   * both the aging buckets and per-customer outstanding totals.
   */
  async getAccountsReceivable(orgId?: string, asOf?: string): Promise<AccountsReceivableReport> {
    const asOfExpr: RawBuilder<unknown> = asOf ? sql`${asOf}::date` : sql`CURRENT_DATE`;

    const joinClause: RawBuilder<unknown> = orgId ? sql`JOIN core.quotes q ON q.id = i.quote_id` : sql``;
    const orgFilter: RawBuilder<unknown> = orgId ? sql`AND q.organization_id = ${orgId}` : sql``;

    const result = await sql<{ customer_id: string; outstanding: string; days_overdue: string }>`
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
    `.execute(this.db);

    const round = (n: number): number => Math.round(n * 100) / 100;
    const buckets = { current: 0, c31: 0, c61: 0, c90: 0 };
    const byCustomer = new Map<string, number>();
    let totalOutstanding = 0;

    for (const row of result.rows) {
      const outstanding = Number.parseFloat(row.outstanding as string);
      if (!(outstanding > 0)) continue;
      const days = Number.parseInt(row.days_overdue as string, 10);

      if (days <= 30) buckets.current += outstanding;
      else if (days <= 60) buckets.c31 += outstanding;
      else if (days <= 90) buckets.c61 += outstanding;
      else buckets.c90 += outstanding;

      totalOutstanding += outstanding;
      byCustomer.set(row.customer_id as string, (byCustomer.get(row.customer_id as string) ?? 0) + outstanding);
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
