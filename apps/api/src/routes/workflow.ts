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
      const invoiceResult = await services.invoices.createFromQuote(req.params.id, userId);
      const quote = await services.quotes.convertToInvoice(req.params.id, userId);
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

  return router;
}
