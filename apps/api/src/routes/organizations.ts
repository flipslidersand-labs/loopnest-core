import { Router, Request, Response } from 'express';
import { RepositoryContainer } from '@loopnest/bizcore-db';
import { asyncHandler, ApiErrorResponse } from '../middleware/errorHandler.js';
import { requireRole } from '../middleware/auth.js';
import { parsePagination } from '../lib/pagination.js';

const MAX_HIERARCHY_DEPTH = 50;

/**
 * Is `targetId` the tenant's own org, or a descendant of it? Walks up
 * targetId's parent chain looking for tenantOrgId. Used to keep a
 * tenant-scoped caller (req.user.orgId set) confined to its own org tree;
 * a global-admin token (no orgId) is never subject to this check.
 */
async function isSelfOrDescendant(
  repos: RepositoryContainer,
  targetId: string,
  tenantOrgId: string
): Promise<boolean> {
  if (targetId === tenantOrgId) return true;
  let current = await repos.organizations.findById(targetId);
  let hops = 0;
  while (current?.parentId && hops < MAX_HIERARCHY_DEPTH) {
    if (current.parentId === tenantOrgId) return true;
    current = await repos.organizations.findById(current.parentId);
    hops++;
  }
  return false;
}

/** BFS over the org tree rooted at orgId (itself + all descendants). */
async function findSelfAndDescendants(repos: RepositoryContainer, orgId: string) {
  const root = await repos.organizations.findById(orgId);
  if (!root) return [];
  const result = [root];
  let frontier = [orgId];
  let hops = 0;
  while (frontier.length > 0 && hops < MAX_HIERARCHY_DEPTH) {
    const childLists = await Promise.all(frontier.map(id => repos.organizations.findChildren(id)));
    const children = childLists.flat();
    if (children.length === 0) break;
    result.push(...children);
    frontier = children.map(c => c.id);
    hops++;
  }
  return result;
}

export function organizationRoutes(repos: RepositoryContainer) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const { skip, take } = parsePagination(req.query, { defaultTake: 10 });
      const tenantOrgId = req.user?.orgId;

      if (tenantOrgId) {
        const orgs = await findSelfAndDescendants(repos, tenantOrgId);
        const data = orgs.slice(skip, skip + take);
        res.json({ data, pagination: { skip, take, total: orgs.length } });
        return;
      }

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

      const tenantOrgId = req.user?.orgId;
      if (tenantOrgId && !(await isSelfOrDescendant(repos, org.id, tenantOrgId))) {
        throw new ApiErrorResponse(404, 'NOT_FOUND', 'Organization not found');
      }

      res.json({ data: org });
    })
  );

  router.get(
    '/:id/children',
    asyncHandler(async (req: Request, res: Response) => {
      const org = await repos.organizations.findById(req.params.id);
      if (!org) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Organization not found');

      const tenantOrgId = req.user?.orgId;
      if (tenantOrgId && !(await isSelfOrDescendant(repos, org.id, tenantOrgId))) {
        throw new ApiErrorResponse(404, 'NOT_FOUND', 'Organization not found');
      }

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

      const tenantOrgId = req.user?.orgId;
      if (tenantOrgId && parentId && !(await isSelfOrDescendant(repos, parentId, tenantOrgId))) {
        throw new ApiErrorResponse(403, 'FORBIDDEN', 'parentId must be within your own organization tree');
      }

      const org = await repos.organizations.create({ name, type, parentId: parentId || null });
      res.status(201).json({ data: org });
    })
  );

  router.patch(
    '/:id',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const existing = await repos.organizations.findById(req.params.id);
      if (!existing) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Organization not found');

      const tenantOrgId = req.user?.orgId;
      if (tenantOrgId && !(await isSelfOrDescendant(repos, existing.id, tenantOrgId))) {
        throw new ApiErrorResponse(404, 'NOT_FOUND', 'Organization not found');
      }

      const { name, type, parentId } = req.body;
      if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'Name must be a non-empty string');
      }
      if (type !== undefined && (typeof type !== 'string' || !type.trim())) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'Type must be a non-empty string');
      }
      if (tenantOrgId && parentId && !(await isSelfOrDescendant(repos, parentId, tenantOrgId))) {
        throw new ApiErrorResponse(403, 'FORBIDDEN', 'parentId must be within your own organization tree');
      }

      const org = await repos.organizations.update(req.params.id, { name, type, parentId });
      res.json({ data: org });
    })
  );

  router.delete(
    '/:id',
    requireRole('admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const existing = await repos.organizations.findById(req.params.id);
      if (!existing) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Organization not found');

      const tenantOrgId = req.user?.orgId;
      if (tenantOrgId && !(await isSelfOrDescendant(repos, existing.id, tenantOrgId))) {
        throw new ApiErrorResponse(404, 'NOT_FOUND', 'Organization not found');
      }

      const success = await repos.organizations.delete(req.params.id);
      if (!success) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Organization not found');
      res.json({ data: { success: true } });
    })
  );

  return router;
}
