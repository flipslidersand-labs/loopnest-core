import { Router, Request, Response } from 'express';
import { AuditService } from '../services/AuditService.js';
import { asyncHandler, ApiErrorResponse } from '../middleware/errorHandler.js';
import { requireRole } from '../middleware/auth.js';

export function auditRoutes(auditService: AuditService) {
  const router = Router();

  // All audit endpoints are admin-only — audit logs are sensitive operational data.
  router.use(requireRole('admin'));

  // GET /api/audit/logs — paginated list with optional filters
  router.get(
    '/logs',
    asyncHandler(async (req: Request, res: Response) => {
      const skip = Number.parseInt(req.query.skip as string) || 0;
      const take = Math.min(Number.parseInt(req.query.take as string) || 20, 100);
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

  // GET /api/audit/requests — HTTP request log with optional filters
  router.get(
    '/requests',
    asyncHandler(async (req: Request, res: Response) => {
      const skip = Number.parseInt(req.query.skip as string) || 0;
      const take = Math.min(Number.parseInt(req.query.take as string) || 20, 100);
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
