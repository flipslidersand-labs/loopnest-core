import { Router, Request, Response } from 'express';
import { ServiceContainer } from '../services/index.js';
import { asyncHandler, ApiErrorResponse } from '../middleware/errorHandler.js';
import { requireRole } from '../middleware/auth.js';
import { RepositoryContainer } from '@loopnest/bizcore-db';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const validateQuoteId = (id: string): void => {
  if (!UUID_RE.test(id)) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Quote not found');
};

export function workflowRoutes(services: ServiceContainer, repos: RepositoryContainer) {
  // Webhook delivery is fire-and-forget; errors are swallowed inside the service.
  const wh = services.webhooks;
  const router = Router();

  // Guard: if the caller has an orgId, the quote must belong to that org.
  const assertOrgOwnsQuote = async (quoteId: string, orgId?: string): Promise<void> => {
    if (!orgId) return;
    const q = await repos.quotes.findById(quoteId, orgId);
    if (!q) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Quote not found');
  };

  // ── Quote state machine ──────────────────────────────────────────────────

  router.post(
    '/quotes/:id/submit',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      validateQuoteId(req.params.id);
      const { userId } = req.body;
      if (!userId) throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'userId is required');
      await assertOrgOwnsQuote(req.params.id, req.user?.orgId);
      const quote = await services.quotes.submitForApproval(req.params.id, userId);
      await services.audit.logQuoteSubmitted(req.params.id, userId);
      wh.deliver(req.user?.orgId, 'quote.submitted', { quoteId: req.params.id, userId, status: 'pending_approval' });
      res.json({ data: quote, message: 'Quote submitted for approval' });
    })
  );

  router.post(
    '/quotes/:id/approve',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      validateQuoteId(req.params.id);
      const { userId, notes } = req.body;
      if (!userId) throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'userId is required');
      await assertOrgOwnsQuote(req.params.id, req.user?.orgId);
      const quote = await services.quotes.approve(req.params.id, userId, notes);
      await services.audit.logQuoteApproved(req.params.id, userId);
      wh.deliver(req.user?.orgId, 'quote.approved', { quoteId: req.params.id, userId, status: 'approved' });
      res.json({ data: quote, message: 'Quote approved' });
    })
  );

  router.post(
    '/quotes/:id/reject',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      validateQuoteId(req.params.id);
      const { userId, reason } = req.body;
      if (!userId || !reason) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'userId and reason are required');
      }
      await assertOrgOwnsQuote(req.params.id, req.user?.orgId);
      const quote = await services.quotes.reject(req.params.id, userId, reason);
      await services.audit.logQuoteRejected(req.params.id, userId, reason);
      res.json({ data: quote, message: 'Quote rejected' });
    })
  );

  router.post(
    '/quotes/:id/invoice',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      validateQuoteId(req.params.id);
      const { userId } = req.body;
      if (!userId) throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'userId is required');
      await assertOrgOwnsQuote(req.params.id, req.user?.orgId);
      // Pre-check credit limit before the atomic status transition so a rejection
      // does not strand the quote in 'invoiced' status with no actual invoice.
      await services.invoices.assertCreditAllows(req.params.id);
      const quote = await services.quotes.convertToInvoice(req.params.id, userId);
      const invoiceResult = await services.invoices.createFromQuote(req.params.id, userId);
      await services.audit.logInvoiceCreated(invoiceResult.invoiceId, req.params.id, userId);
      wh.deliver(req.user?.orgId, 'invoice.created', { invoiceId: invoiceResult.invoiceId, quoteId: req.params.id, totalAmount: invoiceResult.totalAmount });
      res.json({ data: { quote, invoice: invoiceResult }, message: 'Invoice created from approved quote' });
    })
  );

  router.get(
    '/quotes/:id/status',
    asyncHandler(async (req: Request, res: Response) => {
      validateQuoteId(req.params.id);
      const status = await services.quotes.getWorkflowStatus(req.params.id);
      res.json({ data: status });
    })
  );

  router.get(
    '/quotes/stage/draft',
    asyncHandler(async (req: Request, res: Response) => {
      const limit = Number.parseInt(req.query.limit as string) || 10;
      const quotes = await services.quotes.getDraftQuotes(limit);
      res.json({ data: quotes, stage: 'draft' });
    })
  );

  router.get(
    '/quotes/stage/pending-approval',
    asyncHandler(async (req: Request, res: Response) => {
      const limit = Number.parseInt(req.query.limit as string) || 10;
      const quotes = await services.quotes.getPendingApprovalQuotes(limit);
      res.json({ data: quotes, stage: 'pending_approval' });
    })
  );

  router.get(
    '/quotes/stage/approved',
    asyncHandler(async (req: Request, res: Response) => {
      const limit = Number.parseInt(req.query.limit as string) || 10;
      const quotes = await services.quotes.getApprovedQuotes(limit);
      res.json({ data: quotes, stage: 'approved' });
    })
  );

  router.get(
    '/quotes/stage/invoiced',
    asyncHandler(async (req: Request, res: Response) => {
      const limit = Number.parseInt(req.query.limit as string) || 10;
      const quotes = await services.quotes.getInvoicedQuotes(limit);
      res.json({ data: quotes, stage: 'invoiced' });
    })
  );

  // ── Approval workflow ────────────────────────────────────────────────────

  router.post(
    '/approvals',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const { quoteId, approverUserIds } = req.body;
      if (!quoteId || !approverUserIds || !Array.isArray(approverUserIds)) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'quoteId and approverUserIds (array) are required');
      }
      const approval = await services.approvals.createApprovalRequest(quoteId, approverUserIds);
      res.status(201).json({ data: approval, message: 'Approval request created' });
    })
  );

  router.post(
    '/approvals/:requestId/steps/:stepId/approve',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, notes } = req.body;
      if (!userId) throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'userId is required');
      const step = await services.approvals.approveStep(req.params.requestId, req.params.stepId, userId, notes);
      res.json({ data: step, message: 'Approval step approved' });
    })
  );

  router.post(
    '/approvals/:requestId/steps/:stepId/reject',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, reason } = req.body;
      if (!userId || !reason) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'userId and reason are required');
      }
      const step = await services.approvals.rejectStep(req.params.requestId, req.params.stepId, userId, reason);
      res.json({ data: step, message: 'Approval step rejected' });
    })
  );

  router.post(
    '/approvals/:requestId/cancel',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId } = req.body;
      if (!userId) throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'userId is required');
      await services.approvals.cancelApprovalRequest(req.params.requestId, userId);
      res.json({ message: 'Approval request cancelled' });
    })
  );

  router.get(
    '/approvals/quote/:quoteId/status',
    asyncHandler(async (req: Request, res: Response) => {
      const status = await services.approvals.getApprovalStatus(req.params.quoteId);
      res.json({ data: status });
    })
  );

  router.get(
    '/approvals/user/:userId',
    asyncHandler(async (req: Request, res: Response) => {
      const approvals = await services.approvals.getPendingApprovalsForUser(req.params.userId);
      res.json({ data: approvals, count: approvals.length });
    })
  );

  // ── Invoice lifecycle ────────────────────────────────────────────────────

  const requireInvoice = asyncHandler(async (req: Request, _res: Response, next: any) => {
    const inv = await repos.invoices.findById(req.params.id);
    if (!inv) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Invoice not found');
    next();
  });

  // issued → sent
  router.post(
    '/invoices/:id/send',
    requireRole('editor', 'admin'),
    requireInvoice,
    asyncHandler(async (req: Request, res: Response) => {
      const invoice = await repos.invoices.markSent(req.params.id);
      if (!invoice) {
        throw new ApiErrorResponse(409, 'INVALID_STATUS', 'Invoice must be in issued status to mark as sent');
      }
      res.json({ data: invoice, message: 'Invoice marked as sent' });
    })
  );

  // issued | sent → paid
  router.post(
    '/invoices/:id/mark-paid',
    requireRole('editor', 'admin'),
    requireInvoice,
    asyncHandler(async (req: Request, res: Response) => {
      const paidAt = req.body.paidAt ? new Date(req.body.paidAt) : new Date();
      const invoice = await repos.invoices.markPaid(req.params.id, paidAt);
      if (!invoice) {
        throw new ApiErrorResponse(409, 'INVALID_STATUS', 'Invoice must be issued or sent to mark as paid');
      }
      res.json({ data: invoice, message: 'Invoice marked as paid' });
    })
  );

  // ── Discount management ─────────────────────────────────────────────────

  // Apply (or update) a discount on a quote (draft/pending_approval only).
  router.post(
    '/quotes/:id/discount',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      validateQuoteId(req.params.id);
      const { discountType, discountValue } = req.body;
      if (!discountType || !['percentage', 'fixed'].includes(discountType)) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'discountType must be "percentage" or "fixed"');
      }
      const value = Number(discountValue);
      if (!Number.isFinite(value) || value < 0) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'discountValue must be a non-negative number');
      }
      if (discountType === 'percentage' && value > 100) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'Percentage discount cannot exceed 100');
      }
      await assertOrgOwnsQuote(req.params.id, req.user?.orgId);
      const quote = await repos.quotes.applyDiscount(req.params.id, discountType, value);
      if (!quote) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Quote not found');
      res.json({ data: quote, message: 'Discount applied' });
    })
  );

  // Remove discount from a quote.
  router.delete(
    '/quotes/:id/discount',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      validateQuoteId(req.params.id);
      await assertOrgOwnsQuote(req.params.id, req.user?.orgId);
      const quote = await repos.quotes.clearDiscount(req.params.id);
      if (!quote) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Quote not found');
      res.json({ data: quote, message: 'Discount removed' });
    })
  );

  // ── Quote expiry ─────────────────────────────────────────────────────────

  // List quotes expiring within N days (default 7). Useful for dashboard warnings.
  router.get(
    '/quotes/expiring-soon',
    asyncHandler(async (req: Request, res: Response) => {
      const days = Math.min(Number(req.query.days) || 7, 90);
      const quotes = await repos.quotes.findExpiringSoon(days, req.user?.orgId);
      res.json({ data: quotes, meta: { days, count: quotes.length } });
    })
  );

  // Set (or clear) the expiry date on a quote. Only editor/admin; any status allowed.
  router.patch(
    '/quotes/:id/expiry',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      validateQuoteId(req.params.id);
      const { expiresAt } = req.body;
      let date: Date | null = null;
      if (expiresAt !== null && expiresAt !== undefined) {
        date = new Date(expiresAt);
        if (isNaN(date.getTime())) {
          throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'expiresAt must be a valid ISO 8601 date string or null');
        }
        if (date <= new Date()) {
          throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'expiresAt must be a future date');
        }
      }
      await assertOrgOwnsQuote(req.params.id, req.user?.orgId);
      const quote = await repos.quotes.setExpiry(req.params.id, date);
      if (!quote) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Quote not found');
      res.json({ data: quote, message: date ? `Expiry set to ${date.toISOString()}` : 'Expiry cleared' });
    })
  );

  // issued | sent → cancelled (admin only)
  router.post(
    '/invoices/:id/cancel',
    requireRole('admin'),
    requireInvoice,
    asyncHandler(async (req: Request, res: Response) => {
      const invoice = await repos.invoices.cancelInvoice(req.params.id);
      if (!invoice) {
        throw new ApiErrorResponse(409, 'INVALID_STATUS', 'Only issued or sent invoices can be cancelled');
      }
      res.json({ data: invoice, message: 'Invoice cancelled' });
    })
  );

  // ── Quote template apply ─────────────────────────────────────────────────

  /**
   * Create a new draft quote from a template.
   * Body: { customerId, notes? }
   * Returns the new quote with all items populated.
   */
  router.post(
    '/quote-templates/:id/apply',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const { customerId, notes } = req.body;
      if (!customerId || !UUID_RE.test(customerId)) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'customerId (UUID) is required');
      }

      const template = await repos.quoteTemplates.findById(req.params.id, req.user?.orgId);
      if (!template) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Template not found');
      if (template.items.length === 0) {
        throw new ApiErrorResponse(422, 'EMPTY_TEMPLATE', 'Template has no items');
      }

      const quoteNumber = await repos.quoteTemplates.nextQuoteNumber();
      const userId = req.user?.sub ?? 'system';

      // Compute subtotal from template items.
      const subtotal = template.items.reduce(
        (sum, item) => sum + Math.round(item.quantity * item.unitPrice * 100) / 100,
        0
      );
      const taxAmount = Math.round(subtotal * 0.1 * 100) / 100;
      const totalAmount = subtotal + taxAmount;

      // Create quote.
      const quote = await repos.quotes.create({
        quoteNumber,
        quoteRequestId: null,
        customerId,
        subtotalAmount: subtotal,
        taxAmount,
        totalAmount,
        status: 'draft',
        notes: notes ?? `Generated from template: ${template.name}`,
        organizationId: req.user?.orgId,
        createdBy: userId,
      });

      // Add items sequentially (QuoteItemRepository uses Prisma, not Kysely tx).
      const createdItems = [];
      for (const item of template.items) {
        const qi = await repos.quoteItems.addItem(quote.id, {
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        });
        createdItems.push(qi);
      }

      res.status(201).json({
        data: { ...quote, items: createdItems },
        message: `Quote ${quoteNumber} created from template "${template.name}"`,
      });
    })
  );

  return router;
}
