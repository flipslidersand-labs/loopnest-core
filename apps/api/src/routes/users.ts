import { Router, Request, Response } from 'express';
import { RepositoryContainer } from '@loopnest/bizcore-db';
import type { User } from '@loopnest/bizcore-db';
import { asyncHandler, ApiErrorResponse } from '../middleware/errorHandler.js';
import { requireRole } from '../middleware/auth.js';

export function userRoutes(repos: RepositoryContainer) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const skip = Number.parseInt(req.query.skip as string) || 0;
      const take = Number.parseInt(req.query.take as string) || 10;
      const role = req.query.role as string;
      const organizationId = req.query.organizationId as string;
      let users, count;
      if (organizationId) {
        users = await repos.users.findByOrganization(organizationId, { skip, take });
        count = await repos.users.count({ organizationId });
      } else if (role) {
        users = await repos.users.findByRole(role as User['role'], { skip, take });
        count = await repos.users.count({ role: role as User['role'] });
      } else {
        users = await repos.users.findAll({ skip, take });
        count = await repos.users.count();
      }
      res.json({ data: users, pagination: { skip, take, total: count }, filter: { role, organizationId } });
    })
  );

  router.get(
    '/email/:email',
    asyncHandler(async (req: Request, res: Response) => {
      const user = await repos.users.findByEmail(req.params.email);
      if (!user) throw new ApiErrorResponse(404, 'NOT_FOUND', 'User not found');
      res.json({ data: user });
    })
  );

  router.get(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const user = await repos.users.findById(req.params.id);
      if (!user) throw new ApiErrorResponse(404, 'NOT_FOUND', 'User not found');
      res.json({ data: user });
    })
  );

  router.post(
    '/',
    requireRole('admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const { name, nameEn, email, organizationId, role, profile } = req.body;
      if (!name || !email || !organizationId || !role) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'name, email, organizationId, and role are required');
      }
      const user = await repos.users.create({ name, nameEn, email, organizationId, role, profile });
      res.status(201).json({ data: user });
    })
  );

  router.patch(
    '/:id',
    requireRole('admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const { name, email, organizationId, role, profile } = req.body;
      const user = await repos.users.update(req.params.id, { name, email, organizationId, role, profile });
      res.json({ data: user });
    })
  );

  router.delete(
    '/:id',
    requireRole('admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const success = await repos.users.delete(req.params.id);
      if (!success) throw new ApiErrorResponse(404, 'NOT_FOUND', 'User not found');
      res.json({ data: { success: true } });
    })
  );

  return router;
}
