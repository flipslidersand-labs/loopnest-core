import { Router, Request, Response } from 'express';
import { RepositoryContainer } from '@loopnest/bizcore-db';
import { asyncHandler, ApiErrorResponse } from '../middleware/errorHandler.js';
import { requireRole } from '../middleware/auth.js';

export function quoteRoutes(repos: RepositoryContainer) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const skip = Number.parseInt(req.query.skip as string) || 0;
      const take = Number.parseInt(req.query.take as string) || 10;
      const status = req.query.status as string;
      const customerId = req.query.customerId as string;
      let quotes, count;
      if (customerId) {
        quotes = await repos.quotes.findByCustomer(customerId, { skip, take });
        count = await repos.quotes.count({ customerId } as any);
      } else if (status) {
        quotes = await repos.quotes.findByStatus(status as any, { skip, take });
        count = await repos.quotes.count({ status } as any);
      } else {
        quotes = await repos.quotes.findAll({ skip, take });
        count = await repos.quotes.count();
      }
      res.json({ data: quotes, pagination: { skip, take, total: count }, filter: { status, customerId } });
    })
  );

  router.get(
    '/number/:quoteNumber',
    asyncHandler(async (req: Request, res: Response) => {
      const quote = await repos.quotes.findByNumber(req.params.quoteNumber);
      if (!quote) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Quote not found');
      res.json({ data: quote });
    })
  );

  router.get(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const quote = await repos.quotes.findWithItems(req.params.id);
      if (!quote) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Quote not found');
      res.json({ data: quote });
    })
  );

  router.post(
    '/',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const { quoteNumber, quoteRequestId, customerId, subtotalAmount, taxAmount, totalAmount, createdBy } = req.body;
      if (!quoteNumber || !customerId || createdBy === undefined) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'quoteNumber, customerId, and createdBy are required');
      }
      const quote = await repos.quotes.create({
        quoteNumber,
        quoteRequestId: quoteRequestId || null,
        customerId,
        subtotalAmount: subtotalAmount || 0,
        taxAmount: taxAmount || 0,
        totalAmount: totalAmount || 0,
        status: 'draft',
        createdBy,
      });
      res.status(201).json({ data: quote });
    })
  );

  router.patch(
    '/:id',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const { status, subtotalAmount, taxAmount, totalAmount, notes } = req.body;
      const quote = await repos.quotes.update(req.params.id, { status, subtotalAmount, taxAmount, totalAmount, notes });
      res.json({ data: quote });
    })
  );

  router.delete(
    '/:id',
    requireRole('admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const success = await repos.quotes.delete(req.params.id);
      if (!success) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Quote not found');
      res.json({ data: { success: true } });
    })
  );

  return router;
}
