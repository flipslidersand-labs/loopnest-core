import { Router, Request, Response } from 'express';
import { RepositoryContainer } from '@loopnest/bizcore-db';
import type { User } from '@loopnest/bizcore-db';
import { asyncHandler, ApiErrorResponse } from '../middleware/errorHandler.js';
import { requireRole } from '../middleware/auth.js';
import { parsePagination } from '../lib/pagination.js';

/**
 * Enforce org isolation: a tenant-scoped token (req.user.orgId set) may only
 * query its own organization. A global admin token (orgId absent) may query any.
 * Returns the effective organizationId to use for the query.
 */
function resolveOrgId(req: Request, requestedOrgId?: string): string | undefined {
  const tokenOrgId = req.user?.orgId;
  if (tokenOrgId) {
    if (requestedOrgId && requestedOrgId !== tokenOrgId) {
      throw new ApiErrorResponse(403, 'FORBIDDEN', 'You may only access your own organization');
    }
    return tokenOrgId;
  }
  return requestedOrgId;
}

export function userRoutes(repos: RepositoryContainer) {
  const router = Router();

  router.get(
    '/',
    requireRole('viewer', 'editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const { skip, take } = parsePagination(req.query, { defaultTake: 10 });
      const role = req.query.role as string | undefined;
      const orgId = resolveOrgId(req, req.query.organizationId as string | undefined);

      let users, count;
      if (orgId) {
        users = await repos.users.findByOrganization(orgId, { skip, take });
        count = await repos.users.count({ organizationId: orgId });
      } else if (role) {
        users = await repos.users.findByRole(role as User['role'], { skip, take });
        count = await repos.users.count({ role: role as User['role'] });
      } else {
        users = await repos.users.findAll({ skip, take });
        count = await repos.users.count();
      }
      res.json({ data: users, pagination: { skip, take, total: count }, filter: { role, organizationId: orgId } });
    })
  );

  router.get(
    '/email/:email',
    requireRole('viewer', 'editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const user = await repos.users.findByEmail(req.params.email);
      if (!user) throw new ApiErrorResponse(404, 'NOT_FOUND', 'User not found');
      // Enforce org isolation: tenant-scoped callers may only see users in their org
      const tokenOrgId = req.user?.orgId;
      if (tokenOrgId && user.organizationId !== tokenOrgId) {
        throw new ApiErrorResponse(404, 'NOT_FOUND', 'User not found');
      }
      res.json({ data: user });
    })
  );

  router.get(
    '/:id',
    requireRole('viewer', 'editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const user = await repos.users.findById(req.params.id);
      if (!user) throw new ApiErrorResponse(404, 'NOT_FOUND', 'User not found');
      // Enforce org isolation: tenant-scoped callers may only see users in their org
      const tokenOrgId = req.user?.orgId;
      if (tokenOrgId && user.organizationId !== tokenOrgId) {
        throw new ApiErrorResponse(404, 'NOT_FOUND', 'User not found');
      }
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
      // Tenant-scoped admin may only create users in their own org
      resolveOrgId(req, organizationId);
      const user = await repos.users.create({ name, nameEn, email, organizationId, role, profile });
      res.status(201).json({ data: user });
    })
  );

  router.patch(
    '/:id',
    requireRole('admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const { name, email, organizationId, role, profile } = req.body;
      // Verify target user belongs to the caller's org before updating
      const existing = await repos.users.findById(req.params.id);
      if (!existing) throw new ApiErrorResponse(404, 'NOT_FOUND', 'User not found');
      const tokenOrgId = req.user?.orgId;
      if (tokenOrgId && existing.organizationId !== tokenOrgId) {
        throw new ApiErrorResponse(403, 'FORBIDDEN', 'You may only modify users in your organization');
      }
      const user = await repos.users.update(req.params.id, { name, email, organizationId, role, profile });
      res.json({ data: user });
    })
  );

  router.delete(
    '/:id',
    requireRole('admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const existing = await repos.users.findById(req.params.id);
      if (!existing) throw new ApiErrorResponse(404, 'NOT_FOUND', 'User not found');
      const tokenOrgId = req.user?.orgId;
      if (tokenOrgId && existing.organizationId !== tokenOrgId) {
        throw new ApiErrorResponse(403, 'FORBIDDEN', 'You may only delete users in your organization');
      }
      const success = await repos.users.delete(req.params.id);
      if (!success) throw new ApiErrorResponse(404, 'NOT_FOUND', 'User not found');
      res.json({ data: { success: true } });
    })
  );

  return router;
}
