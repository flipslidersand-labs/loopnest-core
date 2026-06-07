import { Router, Request, Response } from 'express';
import { RepositoryContainer } from '@loopnest/bizcore-db';
import { asyncHandler, ApiErrorResponse } from '../middleware/errorHandler.js';
import { requireRole } from '../middleware/auth.js';

export function customerRoutes(repos: RepositoryContainer) {
  const router = Router();

  // GET /api/customers - List all customers
  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const skip = parseInt(req.query.skip as string) || 0;
      const take = parseInt(req.query.take as string) || 10;

      const customers = await repos.customers.findAll({ skip, take });
      const count = await repos.customers.count();

      res.json({
        data: customers,
        pagination: { skip, take, total: count },
      });
    })
  );

  // GET /api/customers/:id - Get customer by ID
  router.get(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const customer = await repos.customers.findById(req.params.id);

      if (!customer) {
        throw new ApiErrorResponse(404, 'NOT_FOUND', 'Customer not found');
      }

      res.json({ data: customer });
    })
  );

  // POST /api/customers - Create customer
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
      });

      res.status(201).json({ data: customer });
    })
  );

  // PATCH /api/customers/:id - Update customer
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

  // DELETE /api/customers/:id - Delete customer
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
