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

export class ReportingService {
  constructor(private readonly pgPool: any) {}

  async getSummary(orgId?: string): Promise<DashboardSummary> {
    const orgQuoteFilter = orgId ? `AND organization_id = $1` : '';
    const orgQuoteParams = orgId ? [orgId] : [];

    const [custR, activeR, outstandingR, paidR] = await Promise.all([
      // customer count
      this.pgPool.query(
        `SELECT COUNT(*) FROM core.customers${orgId ? ' WHERE organization_id = $1' : ''}`,
        orgId ? [orgId] : []
      ),
      // active quote count (draft + pending_approval)
      this.pgPool.query(
        `SELECT COUNT(*) FROM core.quotes
         WHERE status IN ('draft', 'pending_approval')
         ${orgQuoteFilter}`,
        orgQuoteParams
      ),
      // outstanding invoice amount (issued + sent)
      this.pgPool.query(
        `SELECT COALESCE(SUM(i.total_amount), 0) AS total
         FROM finance.invoices i
         ${orgId ? 'JOIN core.quotes q ON q.id = i.quote_id' : ''}
         WHERE i.status IN ('issued', 'sent')
         ${orgId ? 'AND q.organization_id = $1' : ''}`,
        orgId ? [orgId] : []
      ),
      // paid this calendar month
      this.pgPool.query(
        `SELECT COALESCE(SUM(i.total_amount), 0) AS total
         FROM finance.invoices i
         ${orgId ? 'JOIN core.quotes q ON q.id = i.quote_id' : ''}
         WHERE i.status = 'paid'
           AND i.paid_at >= date_trunc('month', NOW())
           ${orgId ? 'AND q.organization_id = $1' : ''}`,
        orgId ? [orgId] : []
      ),
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

    const params: any[] = [];
    const conditions: string[] = ["i.status = 'paid'"];

    if (dateFrom) { params.push(dateFrom); conditions.push(`i.paid_at >= $${params.length}`); }
    if (dateTo)   { params.push(dateTo);   conditions.push(`i.paid_at <= $${params.length}`); }
    if (orgId)    { params.push(orgId);    conditions.push(`q.organization_id = $${params.length}`); }

    const joinClause = orgId ? 'JOIN core.quotes q ON q.id = i.quote_id' : '';
    const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const result = await this.pgPool.query(
      `SELECT
         date_trunc('${safePeriod}', i.paid_at) AS period,
         COUNT(*)                                AS invoice_count,
         COALESCE(SUM(i.total_amount), 0)       AS revenue
       FROM finance.invoices i
       ${joinClause}
       ${whereClause}
       GROUP BY 1
       ORDER BY 1 ASC`,
      params
    );

    return result.rows.map((r: any) => ({
      period:       r.period instanceof Date ? r.period.toISOString() : String(r.period),
      invoiceCount: Number.parseInt(r.invoice_count, 10),
      revenue:      Number.parseFloat(r.revenue),
    }));
  }

  async getQuotePipeline(orgId?: string): Promise<QuotePipelineStats> {
    const params = orgId ? [orgId] : [];
    const orgFilter = orgId ? 'WHERE organization_id = $1' : '';

    const result = await this.pgPool.query(
      `SELECT status, COUNT(*) AS count
       FROM core.quotes
       ${orgFilter}
       GROUP BY status`,
      params
    );

    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const row of result.rows) {
      byStatus[row.status] = Number.parseInt(row.count, 10);
      total += byStatus[row.status];
    }

    // Conversion: how many that entered the approval flow ended up approved/invoiced
    const submitted = (byStatus.pending_approval ?? 0) + (byStatus.approved ?? 0)
                    + (byStatus.rejected ?? 0) + (byStatus.invoiced ?? 0);
    const converted = (byStatus.approved ?? 0) + (byStatus.invoiced ?? 0);
    const conversionRate = submitted > 0 ? Math.round((converted / submitted) * 10000) / 100 : 0;

    return { byStatus, total, conversionRate };
  }

  async getInvoiceAging(orgId?: string): Promise<InvoiceAgingStats> {
    const joinClause = orgId ? 'JOIN core.quotes q ON q.id = i.quote_id' : '';
    const orgFilter  = orgId ? 'AND q.organization_id = $1' : '';
    const params = orgId ? [orgId] : [];

    const [statusR, overdueR] = await Promise.all([
      this.pgPool.query(
        `SELECT i.status, COUNT(*) AS count, COALESCE(SUM(i.total_amount), 0) AS total_amount
         FROM finance.invoices i
         ${joinClause}
         WHERE 1=1 ${orgFilter}
         GROUP BY i.status`,
        params
      ),
      this.pgPool.query(
        `SELECT COUNT(*) AS count, COALESCE(SUM(i.total_amount), 0) AS total_amount
         FROM finance.invoices i
         ${joinClause}
         WHERE i.status IN ('issued', 'sent')
           AND i.created_at < NOW() - INTERVAL '30 days'
           ${orgFilter}`,
        params
      ),
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
}
