import { Router, Request, Response } from 'express';
import { RepositoryContainer } from '@loopnest/bizcore-db';
import { asyncHandler, ApiErrorResponse } from '../middleware/errorHandler.js';
import { requireRole } from '../middleware/auth.js';

export function customerRoutes(repos: RepositoryContainer) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const skip = Number.parseInt(req.query.skip as string) || 0;
      const take = Number.parseInt(req.query.take as string) || 10;
      const orgId = req.user?.orgId;

      const customers = await repos.customers.findAll({ skip, take, organizationId: orgId });
      const count = await repos.customers.count({ organizationId: orgId });

      res.json({
        data: customers,
        pagination: { skip, take, total: count },
      });
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
      const { name, address, phone } = req.body;

      if (!name) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'Name is required');
      }

      const customer = await repos.customers.create({
        name,
        address,
        phone,
        organizationId: req.user?.orgId,
      });

      res.status(201).json({ data: customer });
    })
  );

  router.patch(
    '/:id',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const { name, address, phone } = req.body;

      const customer = await repos.customers.update(req.params.id, {
        name,
        address,
        phone,
      });

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

      res.json({ data: { success: true } });
    })
  );

  return router;
}
