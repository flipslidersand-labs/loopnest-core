import { Router, Request, Response } from 'express';
import { RepositoryContainer } from '@loopnest/bizcore-db';
import { asyncHandler, ApiErrorResponse } from '../middleware/errorHandler.js';

export function quoteRoutes(repos: RepositoryContainer) {
  const router = Router();

  // GET /api/quotes - List all quotes
  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const skip = parseInt(req.query.skip as string) || 0;
      const take = parseInt(req.query.take as string) || 10;
      const status = req.query.status as string;
      const customerId = req.query.customerId as string;

      let quotes;
      let count;

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

      res.json({
        data: quotes,
        pagination: { skip, take, total: count },
        filter: { status, customerId },
      });
    })
  );

  // GET /api/quotes/:id - Get quote by ID with items
  router.get(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const quote = await repos.quotes.findWithItems(req.params.id);

      if (!quote) {
        throw new ApiErrorResponse(404, 'NOT_FOUND', 'Quote not found');
      }

      res.json({ data: quote });
    })
  );

  // GET /api/quotes/number/:quoteNumber - Get quote by quote number
  router.get(
    '/number/:quoteNumber',
    asyncHandler(async (req: Request, res: Response) => {
      const quote = await repos.quotes.findByNumber(req.params.quoteNumber);

      if (!quote) {
        throw new ApiErrorResponse(404, 'NOT_FOUND', 'Quote not found');
      }

      res.json({ data: quote });
    })
  );

  // POST /api/quotes - Create new quote
  router.post(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const { quoteNumber, quoteRequestId, customerId, subtotalAmount, taxAmount, totalAmount, createdBy } = req.body;

      if (!quoteNumber || !customerId || createdBy === undefined) {
        throw new ApiErrorResponse(
          400,
          'VALIDATION_ERROR',
          'quoteNumber, customerId, and createdBy are required'
        );
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

  // PATCH /api/quotes/:id - Update quote status/amounts
  router.patch(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const { status, subtotalAmount, taxAmount, totalAmount, notes } = req.body;

      const quote = await repos.quotes.update(req.params.id, {
        status,
        subtotalAmount,
        taxAmount,
        totalAmount,
        notes,
      });

      res.json({ data: quote });
    })
  );

  // DELETE /api/quotes/:id - Delete quote
  router.delete(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const success = await repos.quotes.delete(req.params.id);

      if (!success) {
        throw new ApiErrorResponse(404, 'NOT_FOUND', 'Quote not found');
      }

      res.json({ data: { success: true } });
    })
  );

  return router;
}
