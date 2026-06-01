import { Router, Request, Response } from 'express';
import { ServiceContainer } from '../services/index.js';
import { asyncHandler, ApiErrorResponse } from '../middleware/errorHandler.js';

export function workflowRoutes(services: ServiceContainer) {
  const router = Router();

  // ============================================
  // Quote Workflow
  // ============================================

  // POST /api/workflow/quotes/:id/submit - Submit quote for approval
  router.post(
    '/quotes/:id/submit',
    asyncHandler(async (req: Request, res: Response) => {
      const { userId } = req.body;

      if (!userId) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'userId is required');
      }

      const quote = await services.quotes.submitForApproval(req.params.id, userId);
      await services.audit.logQuoteSubmitted(req.params.id, userId);

      res.json({
        data: quote,
        message: 'Quote submitted for approval',
      });
    })
  );

  // POST /api/workflow/quotes/:id/approve - Approve quote
  router.post(
    '/quotes/:id/approve',
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, notes } = req.body;

      if (!userId) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'userId is required');
      }

      const quote = await services.quotes.approve(req.params.id, userId, notes);
      await services.audit.logQuoteApproved(req.params.id, userId);

      res.json({
        data: quote,
        message: 'Quote approved',
      });
    })
  );

  // POST /api/workflow/quotes/:id/reject - Reject quote
  router.post(
    '/quotes/:id/reject',
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, reason } = req.body;

      if (!userId || !reason) {
        throw new ApiErrorResponse(
          400,
          'VALIDATION_ERROR',
          'userId and reason are required'
        );
      }

      const quote = await services.quotes.reject(req.params.id, userId, reason);
      await services.audit.logQuoteRejected(req.params.id, userId, reason);

      res.json({
        data: quote,
        message: 'Quote rejected',
      });
    })
  );

  // POST /api/workflow/quotes/:id/invoice - Convert quote to invoice
  router.post(
    '/quotes/:id/invoice',
    asyncHandler(async (req: Request, res: Response) => {
      const { userId } = req.body;

      if (!userId) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'userId is required');
      }

      const invoiceResult = await services.invoices.createFromQuote(req.params.id, userId);
      const quote = await services.quotes.convertToInvoice(req.params.id, userId);
      await services.audit.logInvoiceCreated(invoiceResult.invoiceId, req.params.id, userId);

      res.json({
        data: {
          quote,
          invoice: invoiceResult,
        },
        message: 'Invoice created from approved quote',
      });
    })
  );

  // GET /api/workflow/quotes/:id/status - Get quote workflow status
  router.get(
    '/quotes/:id/status',
    asyncHandler(async (req: Request, res: Response) => {
      const status = await services.quotes.getWorkflowStatus(req.params.id);

      res.json({
        data: status,
      });
    })
  );

  // GET /api/workflow/quotes/stage/draft - Get all draft quotes
  router.get(
    '/quotes/stage/draft',
    asyncHandler(async (req: Request, res: Response) => {
      const limit = parseInt(req.query.limit as string) || 10;
      const quotes = await services.quotes.getDraftQuotes(limit);

      res.json({
        data: quotes,
        stage: 'draft',
      });
    })
  );

  // GET /api/workflow/quotes/stage/pending-approval - Get pending approval quotes
  router.get(
    '/quotes/stage/pending-approval',
    asyncHandler(async (req: Request, res: Response) => {
      const limit = parseInt(req.query.limit as string) || 10;
      const quotes = await services.quotes.getPendingApprovalQuotes(limit);

      res.json({
        data: quotes,
        stage: 'pending_approval',
      });
    })
  );

  // GET /api/workflow/quotes/stage/approved - Get approved quotes
  router.get(
    '/quotes/stage/approved',
    asyncHandler(async (req: Request, res: Response) => {
      const limit = parseInt(req.query.limit as string) || 10;
      const quotes = await services.quotes.getApprovedQuotes(limit);

      res.json({
        data: quotes,
        stage: 'approved',
      });
    })
  );

  // GET /api/workflow/quotes/stage/invoiced - Get invoiced quotes
  router.get(
    '/quotes/stage/invoiced',
    asyncHandler(async (req: Request, res: Response) => {
      const limit = parseInt(req.query.limit as string) || 10;
      const quotes = await services.quotes.getInvoicedQuotes(limit);

      res.json({
        data: quotes,
        stage: 'invoiced',
      });
    })
  );

  // ============================================
  // Approval Workflow
  // ============================================

  // POST /api/workflow/approvals - Create approval request
  router.post(
    '/approvals',
    asyncHandler(async (req: Request, res: Response) => {
      const { quoteId, approverUserIds } = req.body;

      if (!quoteId || !approverUserIds || !Array.isArray(approverUserIds)) {
        throw new ApiErrorResponse(
          400,
          'VALIDATION_ERROR',
          'quoteId and approverUserIds (array) are required'
        );
      }

      const approval = await services.approvals.createApprovalRequest(quoteId, approverUserIds);

      res.status(201).json({
        data: approval,
        message: 'Approval request created',
      });
    })
  );

  // GET /api/workflow/approvals/:id/status - Get approval status
  router.get(
    '/approvals/:id/status',
    asyncHandler(async (req: Request, res: Response) => {
      const status = await services.approvals.getApprovalStatus(req.params.id);

      res.json({
        data: status,
      });
    })
  );

  // GET /api/workflow/approvals/user/:userId - Get pending approvals for user
  router.get(
    '/approvals/user/:userId',
    asyncHandler(async (req: Request, res: Response) => {
      const approvals = await services.approvals.getPendingApprovalsForUser(req.params.userId);

      res.json({
        data: approvals,
        count: approvals.length,
      });
    })
  );

  return router;
}
