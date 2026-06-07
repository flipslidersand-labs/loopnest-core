import { Router, Request, Response } from 'express';
import { RepositoryContainer } from '@loopnest/bizcore-db';
import { asyncHandler, ApiErrorResponse } from '../middleware/errorHandler.js';

export function invoiceRoutes(repos: RepositoryContainer) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const skip = Number.parseInt(req.query.skip as string) || 0;
      const take = Number.parseInt(req.query.take as string) || 20;
      const status = req.query.status as string | undefined;
      const customerId = req.query.customerId as string | undefined;

      const [invoices, total] = await Promise.all([
        repos.invoices.findAll({ skip, take, status, customerId }),
        repos.invoices.count({ status, customerId }),
      ]);
      res.json({ data: invoices, pagination: { skip, take, total }, filter: { status, customerId } });
    })
  );

  router.get(
    '/number/:invoiceNumber',
    asyncHandler(async (req: Request, res: Response) => {
      const invoice = await repos.invoices.findByNumber(req.params.invoiceNumber);
      if (!invoice) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Invoice not found');
      res.json({ data: invoice });
    })
  );

  router.get(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const invoice = await repos.invoices.findById(req.params.id);
      if (!invoice) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Invoice not found');
      res.json({ data: invoice });
    })
  );

  return router;
}
