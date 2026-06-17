import { Router, Request, Response } from "express";
import {
  RepositoryContainer,
  CreditNoteType,
  CreditNoteStatus,
} from "@loopnest/bizcore-db";
import { asyncHandler, ApiErrorResponse } from "../middleware/errorHandler.js";
import { requireRole } from "../middleware/auth.js";
import { CreditNoteService } from "../services/CreditNoteService.js";
import { WebhookService } from "../services/WebhookService.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(id: string, label: string): void {
  if (!UUID_RE.test(id))
    throw new ApiErrorResponse(404, "NOT_FOUND", `${label} not found`);
}

function assertOrgAccess(req: Request, ownerOrgId: string | null): void {
  if (req.user?.orgId && ownerOrgId && req.user.orgId !== ownerOrgId) {
    throw new ApiErrorResponse(
      403,
      "FORBIDDEN",
      "You may only access your own organization",
    );
  }
}

async function loadInvoiceOrg(
  repos: RepositoryContainer,
  invoiceId: string,
): Promise<string | null> {
  assertUuid(invoiceId, "Invoice");
  const invoice = await repos.invoices.findById(invoiceId);
  if (!invoice)
    throw new ApiErrorResponse(404, "NOT_FOUND", "Invoice not found");
  const quote = await repos.quotes.findById(invoice.quoteId);
  return quote?.organizationId ?? null;
}

/** Routes nested under /api/invoices/:invoiceId/credit-notes. */
export function invoiceCreditNoteRoutes(
  creditNotes: CreditNoteService,
  repos: RepositoryContainer,
  webhooks: WebhookService,
) {
  const router = Router({ mergeParams: true });

  // GET — list credit notes for an invoice (viewer+)
  router.get(
    "/",
    asyncHandler(async (req: Request, res: Response) => {
      const { invoiceId } = req.params as { invoiceId: string };
      assertOrgAccess(req, await loadInvoiceOrg(repos, invoiceId));

      const data = await creditNotes.listCreditNotes({ invoiceId });
      res.json({ data });
    }),
  );

  // POST — issue a credit note against an invoice (editor+)
  router.post(
    "/",
    requireRole("editor", "admin"),
    asyncHandler(async (req: Request, res: Response) => {
      const { invoiceId } = req.params as { invoiceId: string };
      assertOrgAccess(req, await loadInvoiceOrg(repos, invoiceId));

      const { amount, reason, cnType } = req.body as {
        amount?: number;
        reason?: string;
        cnType?: CreditNoteType;
      };
      if (amount === undefined || !reason) {
        throw new ApiErrorResponse(
          400,
          "VALIDATION_ERROR",
          "amount and reason are required",
        );
      }

      const result = await creditNotes.issueCreditNote(
        invoiceId,
        { amount, reason, cnType },
        req.user!.sub,
      );

      webhooks.deliver(req.user?.orgId, "credit_note.issued", {
        creditNoteId: result.creditNote.id,
        creditNumber: result.creditNote.creditNumber,
        invoiceId,
        amount,
      });

      res.status(201).json({ data: result.creditNote });
    }),
  );

  return router;
}

/** Routes mounted at /api/credit-notes. */
export function creditNoteRoutes(
  creditNotes: CreditNoteService,
  repos: RepositoryContainer,
  webhooks: WebhookService,
) {
  const router = Router();

  // GET / — list credit notes (viewer+), org-scoped
  router.get(
    "/",
    asyncHandler(async (req: Request, res: Response) => {
      const skip = Math.max(
        0,
        Number.parseInt((req.query.skip as string) || "0", 10),
      );
      const take = Math.min(
        100,
        Math.max(1, Number.parseInt((req.query.take as string) || "20", 10)),
      );
      const organizationId =
        req.user?.orgId ?? (req.query.organizationId as string | undefined);

      const data = await creditNotes.listCreditNotes({
        skip,
        take,
        organizationId,
        invoiceId: req.query.invoiceId as string | undefined,
        status: req.query.status as CreditNoteStatus | undefined,
        cnType: req.query.cnType as CreditNoteType | undefined,
      });
      res.json({ data, pagination: { skip, take } });
    }),
  );

  // GET /:id — get credit note with balance and applications (viewer+)
  router.get(
    "/:id",
    asyncHandler(async (req: Request, res: Response) => {
      assertUuid(req.params.id, "Credit note");
      const result = await creditNotes.getCreditNote(req.params.id);
      assertOrgAccess(req, result.creditNote.organizationId);
      res.json({
        data: result.creditNote,
        balance: result.balance,
        applications: result.applications,
      });
    }),
  );

  // POST /:id/apply — apply credit note to a target invoice (editor+)
  router.post(
    "/:id/apply",
    requireRole("editor", "admin"),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params as { id: string };
      assertUuid(id, "Credit note");
      const existing = await repos.creditNotes.findById(id);
      if (!existing)
        throw new ApiErrorResponse(404, "NOT_FOUND", "Credit note not found");
      assertOrgAccess(req, existing.organizationId);

      const { targetInvoiceId, amount, notes } = req.body as {
        targetInvoiceId?: string;
        amount?: number;
        notes?: string;
      };
      if (!targetInvoiceId || amount === undefined) {
        throw new ApiErrorResponse(
          400,
          "VALIDATION_ERROR",
          "targetInvoiceId and amount are required",
        );
      }

      assertUuid(targetInvoiceId, "Invoice");
      const targetInvoice = await repos.invoices.findById(targetInvoiceId);
      if (!targetInvoice)
        throw new ApiErrorResponse(
          404,
          "NOT_FOUND",
          "Target invoice not found",
        );
      const targetQuote = await repos.quotes.findById(targetInvoice.quoteId);
      assertOrgAccess(req, targetQuote?.organizationId ?? null);

      const result = await creditNotes.applyCreditNote(
        id,
        { targetInvoiceId, amount, notes },
        req.user!.sub,
      );

      webhooks.deliver(req.user?.orgId, "credit_note.applied", {
        creditNoteId: id,
        targetInvoiceId,
        amount,
        remaining: result.creditNoteBalance.remaining,
      });

      res
        .status(201)
        .json({ data: result.application, balance: result.creditNoteBalance });
    }),
  );

  // POST /:id/refund — issue cash refund for remaining balance (admin only)
  router.post(
    "/:id/refund",
    requireRole("admin"),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params as { id: string };
      assertUuid(id, "Credit note");
      const existing = await repos.creditNotes.findById(id);
      if (!existing)
        throw new ApiErrorResponse(404, "NOT_FOUND", "Credit note not found");
      assertOrgAccess(req, existing.organizationId);

      const result = await creditNotes.refundCreditNote(id, req.user!.sub);

      webhooks.deliver(req.user?.orgId, "credit_note.refunded", {
        creditNoteId: id,
        refundedAmount: result.refundedAmount,
      });

      res.json({
        data: result.creditNote,
        refundedAmount: result.refundedAmount,
      });
    }),
  );

  // POST /:id/void — void an unapplied credit note (admin only)
  router.post(
    "/:id/void",
    requireRole("admin"),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params as { id: string };
      assertUuid(id, "Credit note");
      const existing = await repos.creditNotes.findById(id);
      if (!existing)
        throw new ApiErrorResponse(404, "NOT_FOUND", "Credit note not found");
      assertOrgAccess(req, existing.organizationId);

      const voided = await creditNotes.voidCreditNote(id, req.user!.sub);

      webhooks.deliver(req.user?.orgId, "credit_note.voided", {
        creditNoteId: id,
      });

      res.json({ data: voided });
    }),
  );

  return router;
}
