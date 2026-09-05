import { Router, Request, Response } from 'express';
import { RepositoryContainer } from '@loopnest/bizcore-db';
import { asyncHandler, ApiErrorResponse } from '../middleware/errorHandler.js';
import { requireRole } from '../middleware/auth.js';

export function exchangeRateRoutes(repos: RepositoryContainer) {
  const router = Router();

  // GET /api/exchange-rates — list all rates (public)
  router.get(
    '/',
    asyncHandler(async (_req: Request, res: Response) => {
      const rates = await repos.exchangeRates.findAll();
      res.json({ data: rates });
    })
  );

  // GET /api/exchange-rates/:code — single currency rate (public)
  router.get(
    '/:code',
    asyncHandler(async (req: Request, res: Response) => {
      const rate = await repos.exchangeRates.findByCode(req.params.code);
      if (!rate) throw new ApiErrorResponse(404, 'NOT_FOUND', `Exchange rate not found for: ${req.params.code}`);
      res.json({ data: rate });
    })
  );

  // POST /api/exchange-rates — create or update rate (admin only)
  router.post(
    '/',
    requireRole('admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const { currencyCode, rateToJpy, effectiveDate } = req.body;
      if (!currencyCode || rateToJpy === undefined || !effectiveDate) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'currencyCode, rateToJpy, and effectiveDate are required');
      }
      if (typeof rateToJpy !== 'number' || rateToJpy <= 0) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'rateToJpy must be a positive number');
      }
      if (typeof currencyCode !== 'string' || currencyCode.length !== 3) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'currencyCode must be a 3-character string');
      }
      const rate = await repos.exchangeRates.upsert({
        currencyCode,
        rateToJpy,
        effectiveDate: new Date(effectiveDate),
      });
      res.status(201).json({ data: rate });
    })
  );

  return router;
}
