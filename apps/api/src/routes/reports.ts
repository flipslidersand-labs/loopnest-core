import { Router, Request, Response } from 'express';
import { ReportingService } from '../services/ReportingService.js';
import { asyncHandler, ApiErrorResponse } from '../middleware/errorHandler.js';

export function reportRoutes(reportingService: ReportingService) {
  const router = Router();

  // Dashboard quick numbers — viewer and above
  router.get(
    '/summary',
    asyncHandler(async (req: Request, res: Response) => {
      const summary = await reportingService.getSummary(req.user?.orgId);
      res.json({ data: summary });
    })
  );

  // Revenue by period from paid invoices — viewer and above
  router.get(
    '/revenue',
    asyncHandler(async (req: Request, res: Response) => {
      const period = (req.query.period as string) || 'month';
      const VALID = new Set(['day', 'week', 'month', 'quarter', 'year']);
      if (!VALID.has(period)) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'period must be day, week, month, quarter, or year');
      }
      const revenue = await reportingService.getRevenue(
        period as 'day' | 'week' | 'month' | 'quarter' | 'year',
        req.query.dateFrom as string | undefined,
        req.query.dateTo as string | undefined,
        req.user?.orgId
      );
      res.json({ data: revenue, period });
    })
  );

  // Quote pipeline stats — viewer and above
  router.get(
    '/quotes',
    asyncHandler(async (req: Request, res: Response) => {
      const pipeline = await reportingService.getQuotePipeline(req.user?.orgId);
      res.json({ data: pipeline });
    })
  );

  // Invoice aging/status breakdown — viewer and above
  router.get(
    '/invoices',
    asyncHandler(async (req: Request, res: Response) => {
      const aging = await reportingService.getInvoiceAging(req.user?.orgId);
      res.json({ data: aging });
    })
  );

  // Monthly P&L summary (M17) — viewer and above
  router.get(
    '/monthly-summary',
    asyncHandler(async (req: Request, res: Response) => {
      const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'month must be in YYYY-MM format');
      }
      const summary = await reportingService.getMonthlySummary(month, req.user?.orgId);
      res.json({ data: summary });
    })
  );

  // Cash flow time series (M17) — viewer and above
  router.get(
    '/cash-flow',
    asyncHandler(async (req: Request, res: Response) => {
      const { from, to } = req.query as { from?: string; to?: string };
      if (!from || !to) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'from and to query params are required (YYYY-MM-DD)');
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'from and to must be ISO dates (YYYY-MM-DD)');
      }
      if (from > to) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'from must be before or equal to to');
      }
      const cashFlow = await reportingService.getCashFlow(from, to, req.user?.orgId);
      res.json({ data: cashFlow, from, to });
    })
  );

  // Revenue by customer (M17) — viewer and above
  router.get(
    '/revenue-by-customer',
    asyncHandler(async (req: Request, res: Response) => {
      const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'month must be in YYYY-MM format');
      }
      const revenue = await reportingService.getRevenueByCustomer(month, req.user?.orgId);
      res.json({ data: revenue, month });
    })
  );

  // Tax report (M29) — consumption tax summary by month and rate
  router.get(
    '/tax',
    asyncHandler(async (req: Request, res: Response) => {
      const { from, to, format } = req.query as { from?: string; to?: string; format?: string };
      if (!from || !to) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'from and to query params are required (YYYY-MM-DD)');
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'from and to must be ISO dates (YYYY-MM-DD)');
      }
      if (from > to) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'from must be before or equal to to');
      }

      const report = await reportingService.getTaxReport(from, to, req.user?.orgId);

      if (format === 'csv') {
        const lines: string[] = ['month,taxRate,taxableAmount,taxAmount,invoiceCount'];
        for (const r of report.rows) {
          lines.push(`${r.month},${r.taxRate},${r.taxableAmount},${r.taxAmount},${r.invoiceCount}`);
        }
        lines.push(`totals,,${report.totals.taxableAmount},${report.totals.taxAmount},`);
        const fromMonth = from.slice(0, 7);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=tax_report_${fromMonth}.csv`);
        res.send(lines.join('\n'));
        return;
      }

      res.json({ data: report });
    })
  );

  // Accounts-receivable aging (M13) — viewer and above
  router.get(
    '/accounts-receivable',
    asyncHandler(async (req: Request, res: Response) => {
      const asOf = req.query.asOf as string | undefined;
      if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'asOf must be an ISO date (YYYY-MM-DD)');
      }
      const ar = await reportingService.getAccountsReceivable(req.user?.orgId, asOf);
      res.json({ data: ar });
    })
  );

  return router;
}
