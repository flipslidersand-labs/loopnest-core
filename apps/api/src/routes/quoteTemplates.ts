import { Router, Request, Response } from 'express';
import { RepositoryContainer } from '@loopnest/bizcore-db';
import { asyncHandler, ApiErrorResponse } from '../middleware/errorHandler.js';
import { requireRole } from '../middleware/auth.js';

export function quoteTemplateRoutes(repos: RepositoryContainer) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const templates = await repos.quoteTemplates.findAll(req.user?.orgId);
      res.json({ data: templates });
    })
  );

  router.get(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const template = await repos.quoteTemplates.findById(req.params.id, req.user?.orgId);
      if (!template) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Template not found');
      res.json({ data: template });
    })
  );

  router.post(
    '/',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const { name, description, items } = req.body;
      if (!name || typeof name !== 'string') {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'name is required');
      }
      if (!Array.isArray(items) || items.length === 0) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'items must be a non-empty array');
      }
      for (const item of items) {
        if (!item.productId || typeof item.quantity !== 'number' || typeof item.unitPrice !== 'number') {
          throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'Each item needs productId, quantity (number), unitPrice (number)');
        }
      }
      const template = await repos.quoteTemplates.create({
        name,
        description,
        items,
        organizationId: req.user?.orgId,
        createdBy: req.user?.sub ?? 'system',
      });
      res.status(201).json({ data: template });
    })
  );

  router.delete(
    '/:id',
    requireRole('admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const deleted = await repos.quoteTemplates.delete(req.params.id, req.user?.orgId);
      if (!deleted) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Template not found');
      res.status(204).send();
    })
  );

  return router;
}
