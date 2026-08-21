import { Router, Request, Response } from 'express';
import { RepositoryContainer } from '@loopnest/bizcore-db';
import { asyncHandler, ApiErrorResponse } from '../middleware/errorHandler.js';
import { requireRole } from '../middleware/auth.js';

export function taxRateRoutes(repos: RepositoryContainer) {
  const router = Router();

  // GET /api/tax-rates — list all tax rates
  router.get(
    '/',
    asyncHandler(async (_req: Request, res: Response) => {
      const rates = await repos.taxRates.findAll();
      res.json({ data: rates });
    })
  );

  // GET /api/tax-rates/default — get current default rate
  router.get(
    '/default',
    asyncHandler(async (_req: Request, res: Response) => {
      const rate = await repos.taxRates.findDefault();
      if (!rate) throw new ApiErrorResponse(404, 'NOT_FOUND', 'No default tax rate configured');
      res.json({ data: rate });
    })
  );

  // GET /api/tax-rates/:id
  router.get(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const rate = await repos.taxRates.findById(req.params.id);
      if (!rate) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Tax rate not found');
      res.json({ data: rate });
    })
  );

  // POST /api/tax-rates — create new rate (admin only)
  router.post(
    '/',
    requireRole('admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const { name, rate, isDefault, validFrom, validTo } = req.body;
      if (!name || rate === undefined) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'name and rate are required');
      }
      if (typeof rate !== 'number' || rate < 0 || rate > 1) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'rate must be a number between 0 and 1');
      }
      const created = await repos.taxRates.create({
        name,
        rate,
        isDefault: isDefault ?? false,
        validFrom: validFrom ? new Date(validFrom) : undefined,
        validTo: validTo ? new Date(validTo) : null,
      });
      res.status(201).json({ data: created });
    })
  );

  // PATCH /api/tax-rates/:id/set-default — promote to default (admin only)
  router.patch(
    '/:id/set-default',
    requireRole('admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const updated = await repos.taxRates.setDefault(req.params.id);
      if (!updated) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Tax rate not found');
      res.json({ data: updated });
    })
  );

  // DELETE /api/tax-rates/:id — non-default only (admin only)
  router.delete(
    '/:id',
    requireRole('admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const deleted = await repos.taxRates.delete(req.params.id);
      if (!deleted) {
        throw new ApiErrorResponse(409, 'CONFLICT', 'Cannot delete: rate not found or is currently the default');
      }
      res.status(204).end();
    })
  );

  return router;
}
