import { Router, Request, Response } from 'express';
import { RepositoryContainer, PaymentMethod, PaymentStatus } from '@loopnest/bizcore-db';
import { asyncHandler, ApiErrorResponse } from '../middleware/errorHandler.js';
import { requireRole } from '../middleware/auth.js';
import { PaymentService } from '../services/PaymentService.js';
import { WebhookService } from '../services/WebhookService.js';

/**
 * Block a tenant-scoped caller from touching another org's invoice. A token
 * without orgId (global admin) may act on any invoice; an invoice whose org is
 * unknown (legacy / unscoped) is left accessible for backward compatibility.
 */
function assertOrgAccess(req: Request, ownerOrgId: string | null): void {
  if (req.user?.orgId && ownerOrgId && req.user.orgId !== ownerOrgId) {
    throw new ApiErrorResponse(403, 'FORBIDDEN', 'You may only access your own organization');
  }
}

/**
 * Load an invoice and resolve its owning org via the originating quote
 * (finance.invoices is not org-tagged), 404ing if the invoice is missing.
 */
async function loadInvoiceOrg(
  repos: RepositoryContainer,
  invoiceId: string
): Promise<string | null> {
  const invoice = await repos.invoices.findById(invoiceId);
  if (!invoice) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Invoice not found');
  const quote = invoice.quoteId ? await repos.quotes.findById(invoice.quoteId) : null;
  return quote?.organizationId ?? null;
}

/** Routes nested under /api/invoices/:invoiceId/payments. */
export function invoicePaymentRoutes(
  payments: PaymentService,
  repos: RepositoryContainer,
  webhooks: WebhookService
) {
  const router = Router({ mergeParams: true });

  // GET — payment history + balance summary for an invoice (viewer+)
  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const { invoiceId } = req.params as { invoiceId: string };
      assertOrgAccess(req, await loadInvoiceOrg(repos, invoiceId));

      const result = await payments.getPaymentHistory(invoiceId);
      res.json({ data: result.payments, balance: result.balance });
    })
  );

  // POST — record a (possibly partial) payment (editor+)
  router.post(
    '/',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const { invoiceId } = req.params as { invoiceId: string };
      assertOrgAccess(req, await loadInvoiceOrg(repos, invoiceId));

      const { amount, method, paidOn, reference } = req.body as {
        amount?: number;
        method?: PaymentMethod;
        paidOn?: string;
        reference?: string;
      };
      if (amount === undefined || method === undefined) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'amount and method are required');
      }

      const result = await payments.recordPayment(
        invoiceId,
        { amount, method, paidOn, reference },
        req.user!.sub
      );

      // Fire-and-forget webhook fan-out, mirroring the workflow routes.
      webhooks.deliver(req.user?.orgId, 'payment.recorded', {
        invoiceId,
        paymentId: result.payment.id,
        amount: result.payment.amount,
        outstanding: result.balance.outstanding,
        status: result.balance.status,
      });
      if (result.balance.status === 'paid') {
        webhooks.deliver(req.user?.orgId, 'invoice.paid', {
          invoiceId,
          paidTotal: result.balance.paidTotal,
        });
      }

      res.status(201).json({ data: result.payment, balance: result.balance });
    })
  );

  return router;
}

/** Routes mounted at /api/payments. */
export function paymentRoutes(
  payments: PaymentService,
  repos: RepositoryContainer,
  webhooks: WebhookService
) {
  const router = Router();

  // GET — list payments (viewer+), org-scoped
  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const skip = Math.max(0, Number.parseInt((req.query.skip as string) || '0', 10));
      const take = Math.min(100, Math.max(1, Number.parseInt((req.query.take as string) || '20', 10)));
      // A scoped token is pinned to its own org; a global admin may filter freely.
      const organizationId = req.user?.orgId ?? (req.query.organizationId as string | undefined);

      const data = await payments.listPayments({
        skip,
        take,
        organizationId,
        invoiceId: req.query.invoiceId as string | undefined,
        status: req.query.status as PaymentStatus | undefined,
        method: req.query.method as PaymentMethod | undefined,
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
      });
      res.json({ data, pagination: { skip, take } });
    })
  );

  // POST /:id/reverse — reverse a confirmed payment (admin only)
  router.post(
    '/:id/reverse',
    requireRole('admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params as { id: string };
      const existing = await repos.payments.findById(id);
      if (!existing) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Payment not found');
      assertOrgAccess(req, existing.organizationId);

      const { reason } = req.body as { reason?: string };
      const result = await payments.reversePayment(id, reason ?? '', req.user!.sub);

      webhooks.deliver(req.user?.orgId, 'payment.reversed', {
        invoiceId: result.balance.invoiceId,
        paymentId: id,
        outstanding: result.balance.outstanding,
        status: result.balance.status,
      });

      res.json({ data: result.payment, balance: result.balance });
    })
  );

  return router;
}
