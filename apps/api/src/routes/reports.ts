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
        period as any,
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
