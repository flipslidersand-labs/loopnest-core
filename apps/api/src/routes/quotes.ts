import { Router, Request, Response } from 'express';
import { RepositoryContainer } from '@loopnest/bizcore-db';
import { asyncHandler, ApiErrorResponse } from '../middleware/errorHandler.js';
import { requireRole } from '../middleware/auth.js';
import { PdfService } from '../services/PdfService.js';

export function quoteRoutes(repos: RepositoryContainer) {
  const router = Router();
  const pdfService = new PdfService(repos);

  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const skip = Number.parseInt(req.query.skip as string) || 0;
      const take = Number.parseInt(req.query.take as string) || 10;
      const status = req.query.status as string;
      const customerId = req.query.customerId as string;
      const orgId = req.user?.orgId;
      let quotes, count;
      if (customerId) {
        quotes = await repos.quotes.findByCustomer(customerId, { skip, take, organizationId: orgId });
        count = await repos.quotes.count({ customerId, organizationId: orgId });
      } else if (status) {
        quotes = await repos.quotes.findByStatus(status as any, { skip, take, organizationId: orgId });
        count = await repos.quotes.count({ status, organizationId: orgId });
      } else {
        quotes = await repos.quotes.findAll({ skip, take, organizationId: orgId });
        count = await repos.quotes.count({ organizationId: orgId });
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

  // GET /api/quotes/:id/pdf — download quote as PDF
  router.get(
    '/:id/pdf',
    asyncHandler(async (req: Request, res: Response) => {
      const pdf = await pdfService.generateQuotePdf(req.params.id, req.user?.orgId);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="quote-${req.params.id}.pdf"`);
      res.setHeader('Content-Length', pdf.length);
      res.end(pdf);
    })
  );

  router.get(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const quote = await repos.quotes.findWithItems(req.params.id, req.user?.orgId);
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
        organizationId: req.user?.orgId,
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

  // ── Line items sub-resource (/api/quotes/:id/items) ───────────────────────

  const requireDraftQuote = asyncHandler(async (req: Request, _res: Response, next: any) => {
    const quote = await repos.quotes.findById(req.params.id, req.user?.orgId);
    if (!quote) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Quote not found');
    if (quote.status !== 'draft') {
      throw new ApiErrorResponse(409, 'INVALID_STATUS', 'Quote must be in draft status to modify items');
    }
    next();
  });

  router.get(
    '/:id/items',
    asyncHandler(async (req: Request, res: Response) => {
      const quote = await repos.quotes.findById(req.params.id, req.user?.orgId);
      if (!quote) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Quote not found');
      const items = await repos.quoteItems.findByQuote(req.params.id);
      res.json({ data: items, quoteId: req.params.id, count: items.length });
    })
  );

  router.post(
    '/:id/items',
    requireRole('editor', 'admin'),
    requireDraftQuote,
    asyncHandler(async (req: Request, res: Response) => {
      const { productId, quantity, unitPrice } = req.body;
      if (!productId || quantity == null || unitPrice == null) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'productId, quantity, and unitPrice are required');
      }
      if (quantity <= 0) throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'quantity must be positive');
      if (unitPrice < 0) throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'unitPrice must be non-negative');

      const item = await repos.quoteItems.addItem(req.params.id, { productId, quantity, unitPrice });
      const quote = await repos.quotes.findById(req.params.id);
      res.status(201).json({ data: item, quoteTotals: { subtotalAmount: quote?.subtotalAmount, taxAmount: quote?.taxAmount, totalAmount: quote?.totalAmount } });
    })
  );

  router.patch(
    '/:id/items/:itemId',
    requireRole('editor', 'admin'),
    requireDraftQuote,
    asyncHandler(async (req: Request, res: Response) => {
      const { quantity, unitPrice } = req.body;
      if (quantity !== undefined && quantity <= 0) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'quantity must be positive');
      }
      const item = await repos.quoteItems.updateItem(req.params.itemId, req.params.id, { quantity, unitPrice });
      if (!item) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Item not found');
      const quote = await repos.quotes.findById(req.params.id);
      res.json({ data: item, quoteTotals: { subtotalAmount: quote?.subtotalAmount, taxAmount: quote?.taxAmount, totalAmount: quote?.totalAmount } });
    })
  );

  router.delete(
    '/:id/items/:itemId',
    requireRole('editor', 'admin'),
    requireDraftQuote,
    asyncHandler(async (req: Request, res: Response) => {
      const removed = await repos.quoteItems.removeItem(req.params.itemId, req.params.id);
      if (!removed) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Item not found');
      const quote = await repos.quotes.findById(req.params.id);
      res.json({ data: { success: true }, quoteTotals: { subtotalAmount: quote?.subtotalAmount, taxAmount: quote?.taxAmount, totalAmount: quote?.totalAmount } });
    })
  );

  return router;
}
