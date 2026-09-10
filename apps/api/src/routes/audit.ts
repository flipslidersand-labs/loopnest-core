import { Router, Request, Response } from 'express';
import { AuditService } from '../services/AuditService.js';
import { asyncHandler, ApiErrorResponse } from '../middleware/errorHandler.js';
import { requireRole } from '../middleware/auth.js';
import { parsePagination } from '../lib/pagination.js';

export function auditRoutes(auditService: AuditService) {
  const router = Router();

  // All audit endpoints are admin-only — audit logs are sensitive operational data.
  router.use(requireRole('admin'));

  // GET /api/audit/logs — paginated list with optional filters
  router.get(
    '/logs',
    asyncHandler(async (req: Request, res: Response) => {
      const { skip, take } = parsePagination(req.query);
      const filter = {
        actorId:      req.query.actorId as string | undefined,
        resourceType: req.query.resourceType as string | undefined,
        resourceId:   req.query.resourceId as string | undefined,
        action:       req.query.action as string | undefined,
        dateFrom:     req.query.dateFrom as string | undefined,
        dateTo:       req.query.dateTo as string | undefined,
        skip,
        take,
      };

      const [logs, total] = await Promise.all([
        auditService.queryLogs(filter),
        auditService.countLogs(filter),
      ]);

      res.json({ data: logs, pagination: { skip, take, total } });
    })
  );

  // GET /api/audit/logs/:resourceType/:resourceId — full ordered history for one resource
  router.get(
    '/logs/:resourceType/:resourceId',
    asyncHandler(async (req: Request, res: Response) => {
      const { resourceType, resourceId } = req.params;
      if (!resourceType || !resourceId) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'resourceType and resourceId are required');
      }
      const logs = await auditService.getResourceHistory(resourceType, resourceId);
      res.json({ data: logs, resourceType, resourceId, count: logs.length });
    })
  );

  // GET /api/audit/logs/export — download all matching audit logs as CSV
  router.get(
    '/logs/export',
    asyncHandler(async (req: Request, res: Response) => {
      const filter = {
        actorId:      req.query.actorId as string | undefined,
        resourceType: req.query.resourceType as string | undefined,
        resourceId:   req.query.resourceId as string | undefined,
        action:       req.query.action as string | undefined,
        dateFrom:     req.query.dateFrom as string | undefined,
        dateTo:       req.query.dateTo as string | undefined,
        skip: 0,
        take: 10000,
      };

      const logs = await auditService.queryLogs(filter);

      const csvHeader = 'id,actorId,action,resourceType,resourceId,correlationId,createdAt\n';
      const csvRows = logs.map(r =>
        [r.id, r.actorId, r.action, r.resourceType, r.resourceId, r.correlationId ?? '', r.createdAt.toISOString()]
          .map(v => `"${String(v).replace(/"/g, '""')}"`)
          .join(',')
      ).join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${Date.now()}.csv"`);
      res.send(csvHeader + csvRows);
    })
  );

  // GET /api/audit/requests — HTTP request log with optional filters
  router.get(
    '/requests',
    asyncHandler(async (req: Request, res: Response) => {
      const { skip, take } = parsePagination(req.query);
      const statusCode = req.query.statusCode ? Number.parseInt(req.query.statusCode as string) : undefined;
      const filter = {
        actorId:    req.query.actorId as string | undefined,
        statusCode,
        method:     req.query.method as string | undefined,
        path:       req.query.path as string | undefined,
        dateFrom:   req.query.dateFrom as string | undefined,
        dateTo:     req.query.dateTo as string | undefined,
        skip,
        take,
      };

      const [logs, total] = await Promise.all([
        auditService.queryRequestLogs(filter),
        auditService.countRequestLogs(filter),
      ]);

      res.json({ data: logs, pagination: { skip, take, total } });
    })
  );

  return router;
}
