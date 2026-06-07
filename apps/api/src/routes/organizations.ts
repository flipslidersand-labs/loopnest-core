import { Router, Request, Response } from 'express';
import { RepositoryContainer } from '@loopnest/bizcore-db';
import { asyncHandler, ApiErrorResponse } from '../middleware/errorHandler.js';
import { requireRole } from '../middleware/auth.js';

export function organizationRoutes(repos: RepositoryContainer) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const skip = Number.parseInt(req.query.skip as string) || 0;
      const take = Number.parseInt(req.query.take as string) || 10;
      const orgs = await repos.organizations.findAll({ skip, take });
      const count = await repos.organizations.count();
      res.json({ data: orgs, pagination: { skip, take, total: count } });
    })
  );

  router.get(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const org = await repos.organizations.findById(req.params.id);
      if (!org) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Organization not found');
      res.json({ data: org });
    })
  );

  router.get(
    '/:id/children',
    asyncHandler(async (req: Request, res: Response) => {
      const org = await repos.organizations.findById(req.params.id);
      if (!org) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Organization not found');
      const children = await repos.organizations.findChildren(req.params.id);
      res.json({ data: children, parent: org });
    })
  );

  router.post(
    '/',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const { name, type, parentId } = req.body;
      if (!name || !type) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'Name and type are required');
      }
      const org = await repos.organizations.create({ name, type, parentId: parentId || null });
      res.status(201).json({ data: org });
    })
  );

  router.patch(
    '/:id',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const { name, type, parentId } = req.body;
      const org = await repos.organizations.update(req.params.id, { name, type, parentId });
      res.json({ data: org });
    })
  );

  router.delete(
    '/:id',
    requireRole('admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const success = await repos.organizations.delete(req.params.id);
      if (!success) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Organization not found');
      res.json({ data: { success: true } });
    })
  );

  return router;
}
