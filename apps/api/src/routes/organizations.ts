import { Router, Request, Response } from 'express';
import { RepositoryContainer } from '@loopnest/bizcore-db';
import { asyncHandler, ApiErrorResponse } from '../middleware/errorHandler.js';

export function organizationRoutes(repos: RepositoryContainer) {
  const router = Router();

  // GET /api/organizations - List all organizations
  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const skip = parseInt(req.query.skip as string) || 0;
      const take = parseInt(req.query.take as string) || 10;

      const orgs = await repos.organizations.findAll({ skip, take });
      const count = await repos.organizations.count();

      res.json({
        data: orgs,
        pagination: { skip, take, total: count },
      });
    })
  );

  // GET /api/organizations/:id - Get organization by ID
  router.get(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const org = await repos.organizations.findById(req.params.id);

      if (!org) {
        throw new ApiErrorResponse(404, 'NOT_FOUND', 'Organization not found');
      }

      res.json({ data: org });
    })
  );

  // GET /api/organizations/:id/children - Get children organizations
  router.get(
    '/:id/children',
    asyncHandler(async (req: Request, res: Response) => {
      const org = await repos.organizations.findById(req.params.id);

      if (!org) {
        throw new ApiErrorResponse(404, 'NOT_FOUND', 'Organization not found');
      }

      const children = await repos.organizations.findChildren(req.params.id);

      res.json({
        data: children,
        parent: org,
      });
    })
  );

  // POST /api/organizations - Create organization
  router.post(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const { name, type, parentId } = req.body;

      if (!name || !type) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'Name and type are required');
      }

      const org = await repos.organizations.create({
        name,
        type,
        parentId: parentId || null,
      });

      res.status(201).json({ data: org });
    })
  );

  // PATCH /api/organizations/:id - Update organization
  router.patch(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const { name, type, parentId } = req.body;

      const org = await repos.organizations.update(req.params.id, {
        name,
        type,
        parentId,
      });

      res.json({ data: org });
    })
  );

  // DELETE /api/organizations/:id - Delete organization
  router.delete(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const success = await repos.organizations.delete(req.params.id);

      if (!success) {
        throw new ApiErrorResponse(404, 'NOT_FOUND', 'Organization not found');
      }

      res.json({ data: { success: true } });
    })
  );

  return router;
}
