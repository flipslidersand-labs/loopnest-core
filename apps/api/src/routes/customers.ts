import { Router, Request, Response } from 'express';
import { RepositoryContainer } from '@loopnest/bizcore-db';
import { asyncHandler, ApiErrorResponse } from '../middleware/errorHandler.js';
import { requireRole } from '../middleware/auth.js';
import { parseTake, parseSkip } from '../middleware/pagination.js';
import { AuditService } from '../services/AuditService.js';
import { StatementService } from '../services/StatementService.js';
import { PdfService } from '../services/PdfService.js';

export function customerRoutes(repos: RepositoryContainer, audit: AuditService) {
  const router = Router();
  const statementService = new StatementService(repos);
  const pdfService = new PdfService(repos);

  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const cursor = req.query.cursor as string | undefined;
      const take = parseTake(req.query.limit ?? req.query.take);
      const orgId = req.user?.orgId;

      if (cursor || req.query.limit) {
        // cursor-based pagination
        const page = await repos.customers.findPage({ cursor, take, organizationId: orgId });
        res.json(page);
      } else {
        // legacy offset pagination (deprecated)
        const skip = Math.max(0, Number.parseInt(req.query.skip as string) || 0);
        const customers = await repos.customers.findAll({ skip, take, organizationId: orgId });
        const count = await repos.customers.count({ organizationId: orgId });
        res.json({ data: customers, pagination: { skip, take, total: count } });
      }
    })
  );

  router.get(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const customer = await repos.customers.findById(req.params.id, req.user?.orgId);

      if (!customer) {
        throw new ApiErrorResponse(404, 'NOT_FOUND', 'Customer not found');
      }

      res.json({ data: customer });
    })
  );

  router.post(
    '/',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const { name, address, phone, email, contactEmail } = req.body;

      if (!name) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'Name is required');
      }

      const customer = await repos.customers.create({
        name,
        email: email ?? contactEmail,
        address,
        phone,
        organizationId: req.user?.orgId,
      } as any);

      await audit.logResourceCreated('customer', customer.id, req.user?.sub ?? 'system', { name });
      res.status(201).json({ data: customer });
    })
  );

  router.patch(
    '/:id',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const { name, address, phone } = req.body;

      if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'Name must be a non-empty string');
      }

      const customer = await repos.customers.update(req.params.id, {
        name,
        address,
        phone,
      });

      await audit.logResourceUpdated('customer', req.params.id, req.user?.sub ?? 'system', { name, address, phone });
      res.json({ data: customer });
    })
  );

  router.delete(
    '/:id',
    requireRole('admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const success = await repos.customers.delete(req.params.id);

      if (!success) {
        throw new ApiErrorResponse(404, 'NOT_FOUND', 'Customer not found');
      }

      await audit.logResourceDeleted('customer', req.params.id, req.user?.sub ?? 'system');
      res.json({ data: { success: true } });
    })
  );

  // ── Statement of Account ─────────────────────────────────────────────────
  // Must be before /:id to avoid Express routing /:id matching "statement"

  router.get(
    '/:id/statement',
    asyncHandler(async (req: Request, res: Response) => {
      const { from, to } = req.query as { from?: string; to?: string };
      const now = new Date();
      const fromDate = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), 1);
      const toDate = to ? new Date(to) : now;
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'from/to must be valid ISO date strings');
      }
      toDate.setHours(23, 59, 59, 999);
      const statement = await statementService.generate(req.params.id, fromDate, toDate, req.user?.orgId);
      res.json({ data: statement });
    })
  );

  router.get(
    '/:id/statement/pdf',
    asyncHandler(async (req: Request, res: Response) => {
      const { from, to } = req.query as { from?: string; to?: string };
      const now = new Date();
      const fromDate = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), 1);
      const toDate = to ? new Date(to) : now;
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'from/to must be valid ISO date strings');
      }
      toDate.setHours(23, 59, 59, 999);
      const statement = await statementService.generate(req.params.id, fromDate, toDate, req.user?.orgId);
      const pdf = await pdfService.generateStatementPdf(statement);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="statement-${req.params.id}.pdf"`);
      res.setHeader('Content-Length', pdf.length);
      res.end(pdf);
    })
  );

  // ── Credit limit ────────────────────────────────────────────────────────

  router.get(
    '/:id/credit-status',
    asyncHandler(async (req: Request, res: Response) => {
      const status = await repos.customers.getCreditStatus(req.params.id);
      if (!status) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Customer not found');
      res.json({ data: status });
    })
  );

  router.patch(
    '/:id/credit-limit',
    requireRole('admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const { creditLimit } = req.body;
      if (creditLimit !== null && creditLimit !== undefined) {
        const val = Number(creditLimit);
        if (!Number.isFinite(val) || val < 0) {
          throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'creditLimit must be a non-negative number or null');
        }
      }
      const customer = await repos.customers.setCreditLimit(
        req.params.id,
        creditLimit === null ? null : Number(creditLimit)
      );
      if (!customer) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Customer not found');
      res.json({ data: customer });
    })
  );

  return router;
}
