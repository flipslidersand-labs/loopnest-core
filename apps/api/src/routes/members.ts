import { Router, Request, Response } from 'express';
import { RepositoryContainer } from '@loopnest/bizcore-db';
import { asyncHandler, ApiErrorResponse } from '../middleware/errorHandler.js';
import { requireRole } from '../middleware/auth.js';

// Business (job-title) roles stored in core.users — matches the DB CHECK constraint.
const VALID_ROLES = new Set(['director', 'manager', 'senior', 'sales_rep']);

/**
 * Assert the caller is allowed to manage the target org's members.
 * - A token without orgId (global admin) may manage any org.
 * - A token with orgId may only manage its own org.
 */
function assertOrgAccess(req: Request, targetOrgId: string): void {
  if (req.user?.orgId && req.user.orgId !== targetOrgId) {
    throw new ApiErrorResponse(403, 'FORBIDDEN', 'You may only manage your own organization');
  }
}

export function memberRoutes(repos: RepositoryContainer) {
  // mergeParams so :orgId from the parent path is visible here
  const router = Router({ mergeParams: true });

  // GET /api/organizations/:orgId/members — any authenticated user (org-scoped)
  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const { orgId } = req.params as { orgId: string };
      assertOrgAccess(req, orgId);

      // Validate org exists
      const org = await repos.organizations.findById(orgId);
      if (!org) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Organization not found');

      const skip  = Math.max(0, Number.parseInt((req.query.skip  as string) || '0',  10));
      const take  = Math.min(100, Math.max(1, Number.parseInt((req.query.take as string) || '20', 10)));
      const role  = req.query.role as string | undefined;

      const [members, total] = await Promise.all([
        role
          ? repos.users.findByOrganization(orgId, { skip, take }).then(us => us.filter(u => u.role === role))
          : repos.users.findByOrganization(orgId, { skip, take }),
        repos.users.count({ organizationId: orgId, ...(role ? { role } : {}) }),
      ]);

      res.json({ data: members, pagination: { skip, take, total } });
    })
  );

  // POST /api/organizations/:orgId/members — admin only
  router.post(
    '/',
    requireRole('admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const { orgId } = req.params as { orgId: string };
      assertOrgAccess(req, orgId);

      const org = await repos.organizations.findById(orgId);
      if (!org) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Organization not found');

      const { name, email, role, nameEn } = req.body as {
        name?: string; email?: string; role?: string; nameEn?: string;
      };
      if (!name || !email || !role) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'name, email, and role are required');
      }
      if (!VALID_ROLES.has(role)) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', `role must be one of: ${[...VALID_ROLES].join(', ')}`);
      }

      // Conflict check — email must be unique
      const existing = await repos.users.findByEmail(email);
      if (existing) {
        throw new ApiErrorResponse(409, 'CONFLICT', 'A user with that email already exists');
      }

      const user = await repos.users.create({ name, nameEn, email, organizationId: orgId, role });
      res.status(201).json({ data: user });
    })
  );

  // PATCH /api/organizations/:orgId/members/:userId — admin only (change role)
  router.patch(
    '/:userId',
    requireRole('admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const { orgId, userId } = req.params as { orgId: string; userId: string };
      assertOrgAccess(req, orgId);

      const member = await repos.users.findById(userId);
      if (member?.organizationId !== orgId) {
        throw new ApiErrorResponse(404, 'NOT_FOUND', 'Member not found in this organization');
      }

      const { role } = req.body as { role?: string };
      if (!role) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'role is required');
      }
      if (!VALID_ROLES.has(role)) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', `role must be one of: ${[...VALID_ROLES].join(', ')}`);
      }

      const updated = await repos.users.update(userId, { role });
      res.json({ data: updated });
    })
  );

  // DELETE /api/organizations/:orgId/members/:userId — admin only
  router.delete(
    '/:userId',
    requireRole('admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const { orgId, userId } = req.params as { orgId: string; userId: string };
      assertOrgAccess(req, orgId);

      const member = await repos.users.findById(userId);
      if (member?.organizationId !== orgId) {
        throw new ApiErrorResponse(404, 'NOT_FOUND', 'Member not found in this organization');
      }

      await repos.users.delete(userId);
      res.json({ data: { success: true } });
    })
  );

  return router;
}
