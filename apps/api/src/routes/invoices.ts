import { Router, Request, Response } from 'express';
import { RepositoryContainer } from '@loopnest/bizcore-db';
import { asyncHandler, ApiErrorResponse } from '../middleware/errorHandler.js';
import { PdfService } from '../services/PdfService.js';
import { requireRole } from '../middleware/auth.js';
import type { InvoiceService } from '../services/InvoiceService.js';

const CSV_HEADER = 'id,number,customer_id,amount,currency,status,created_at,due_date,paid_at';

function invoiceToCsvRow(inv: any): string {
  return [
    inv.id,
    inv.invoiceNumber,
    inv.customerId,
    inv.totalAmount,
    inv.currency,
    inv.status,
    inv.createdAt instanceof Date ? inv.createdAt.toISOString() : inv.createdAt,
    inv.paymentDueDate ?? '',
    inv.paidAt instanceof Date ? inv.paidAt.toISOString() : (inv.paidAt ?? ''),
  ].join(',');
}

export function invoiceRoutes(repos: RepositoryContainer, invoiceSvc?: InvoiceService) {
  const router = Router();
  const pdfService = new PdfService(repos);

  // ── Bulk operations ────────────────────────────────────────────────────────

  router.post(
    '/bulk-create',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      if (!invoiceSvc) throw new ApiErrorResponse(501, 'NOT_IMPLEMENTED', 'InvoiceService not wired');
      const { items } = req.body;
      if (!Array.isArray(items) || items.length === 0) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'items must be a non-empty array');
      }
      const userId = (req as any).user?.userId ?? 'system';
      const result = await invoiceSvc.bulkCreate(items, userId);
      res.status(result.failed.length === 0 ? 201 : 207).json(result);
    })
  );

  router.post(
    '/bulk-status',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      if (!invoiceSvc) throw new ApiErrorResponse(501, 'NOT_IMPLEMENTED', 'InvoiceService not wired');
      const { ids, action } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'ids must be a non-empty array');
      }
      if (action !== 'void' && action !== 'send') {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'action must be "void" or "send"');
      }
      const result = action === 'void'
        ? await invoiceSvc.bulkVoid(ids)
        : await invoiceSvc.bulkSend(ids);
      res.status(207).json(result);
    })
  );

  // ── CSV export ─────────────────────────────────────────────────────────────

  router.get(
    '/export',
    asyncHandler(async (req: Request, res: Response) => {
      const filter = {
        status: req.query.status as string | undefined,
        customerId: req.query.customerId as string | undefined,
        createdAtFrom: req.query.from as string | undefined,
        createdAtTo: req.query.to as string | undefined,
      };
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="invoices.csv"');
      res.write(CSV_HEADER + '\n');
      await repos.invoices.streamForExport(filter, (invoice) => {
        res.write(invoiceToCsvRow(invoice) + '\n');
      });
      res.end();
    })
  );

  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const cursor = req.query.cursor as string | undefined;
      const take = Math.min(100, Math.max(1, Number.parseInt((req.query.limit ?? req.query.take) as string) || 20));
      const status = req.query.status as string | undefined;
      const customerId = req.query.customerId as string | undefined;

      if (cursor || req.query.limit) {
        // cursor-based pagination
        const page = await repos.invoices.findPage({ cursor, take, status, customerId });
        res.json(page);
      } else {
        // legacy offset pagination (deprecated)
        const skip = Number.parseInt(req.query.skip as string) || 0;
        const [invoices, total] = await Promise.all([
          repos.invoices.findAll({ skip, take, status, customerId }),
          repos.invoices.count({ status, customerId }),
        ]);
        res.json({ data: invoices, pagination: { skip, take, total }, filter: { status, customerId } });
      }
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

  // GET /api/invoices/:id/pdf — download invoice as PDF
  router.get(
    '/:id/pdf',
    asyncHandler(async (req: Request, res: Response) => {
      const pdf = await pdfService.generateInvoicePdf(req.params.id);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="invoice-${req.params.id}.pdf"`);
      res.setHeader('Content-Length', pdf.length);
      res.end(pdf);
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

  // ── Installment schedule ─────────────────────────────────────────────────

  router.get(
    '/:id/installments',
    asyncHandler(async (req: Request, res: Response) => {
      const invoice = await repos.invoices.findById(req.params.id);
      if (!invoice) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Invoice not found');
      const installments = await repos.installments.findByInvoice(req.params.id);
      res.json({ data: installments, meta: { count: installments.length, invoiceTotal: invoice.totalAmount } });
    })
  );

  /**
   * Create (or replace) an equal-split installment schedule.
   * Body: { count: number (2–24), firstDueDate: "YYYY-MM-DD", intervalDays?: number (default 30) }
   */
  router.post(
    '/:id/installments',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const invoice = await repos.invoices.findById(req.params.id);
      if (!invoice) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Invoice not found');
      if (invoice.status === 'cancelled') {
        throw new ApiErrorResponse(409, 'INVALID_STATUS', 'Cannot schedule installments for a cancelled invoice');
      }

      const { count, firstDueDate, intervalDays = 30 } = req.body;
      const n = Number(count);
      if (!Number.isInteger(n) || n < 2 || n > 24) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'count must be an integer between 2 and 24');
      }
      if (!firstDueDate || !/^\d{4}-\d{2}-\d{2}$/.test(firstDueDate)) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'firstDueDate must be YYYY-MM-DD');
      }
      const ivDays = Number(intervalDays);
      if (!Number.isFinite(ivDays) || ivDays < 1 || ivDays > 365) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'intervalDays must be between 1 and 365');
      }

      // Distribute totalAmount into n equal installments; remainder on last.
      const total = invoice.totalAmount;
      const base = Math.floor((total / n) * 100) / 100;
      const last = Math.round((total - base * (n - 1)) * 100) / 100;

      const inputs = Array.from({ length: n }, (_, i) => {
        const due = new Date(firstDueDate);
        due.setDate(due.getDate() + i * ivDays);
        return {
          invoiceId: req.params.id,
          seq: i + 1,
          dueDate: due.toISOString().slice(0, 10),
          amount: i === n - 1 ? last : base,
        };
      });

      const installments = await repos.installments.createSchedule(inputs);
      res.status(201).json({ data: installments, meta: { count: n, total } });
    })
  );

  router.patch(
    '/:id/installments/:instId/pay',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const inst = await repos.installments.markPaid(req.params.instId);
      if (!inst) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Installment not found or already paid/cancelled');
      if (inst.invoiceId !== req.params.id) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Installment not found');
      res.json({ data: inst });
    })
  );

  router.patch(
    '/:id/installments/:instId/cancel',
    requireRole('admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const inst = await repos.installments.cancelInstallment(req.params.instId);
      if (!inst) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Installment not found or not pending');
      if (inst.invoiceId !== req.params.id) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Installment not found');
      res.json({ data: inst });
    })
  );

  return router;
}
