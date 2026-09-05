import { Router, Request, Response } from 'express';
import { RepositoryContainer } from '@loopnest/bizcore-db';
import { asyncHandler, ApiErrorResponse } from '../middleware/errorHandler.js';
import { requireRole } from '../middleware/auth.js';

export function recurringContractRoutes(repos: RepositoryContainer) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const skip = Number.parseInt(req.query.skip as string) || 0;
      const take = Number.parseInt(req.query.take as string) || 20;
      const customerId = req.query.customerId as string | undefined;
      const status = req.query.status as string | undefined;

      const contracts = await repos.recurringContracts.findAll({ customerId, status: status as 'active' | 'paused' | 'cancelled' | 'completed' | undefined, skip, take });
      res.json({ data: contracts, pagination: { skip, take } });
    })
  );

  router.get(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const contract = await repos.recurringContracts.findById(req.params.id);
      if (!contract) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Recurring contract not found');
      res.json({ data: contract });
    })
  );

  router.post(
    '/',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const {
        customerId, name, description,
        intervalUnit, intervalValue,
        amount, taxRate,
        startsAt, endsAt,
        lineItems,
      } = req.body;

      if (!customerId || !name) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'customerId and name are required');
      }
      if (!['day', 'week', 'month', 'year'].includes(intervalUnit)) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'intervalUnit must be day, week, month, or year');
      }
      const iv = Number(intervalValue);
      if (!Number.isInteger(iv) || iv < 1) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'intervalValue must be a positive integer');
      }
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'amount must be a positive number');
      }
      if (!startsAt || !/^\d{4}-\d{2}-\d{2}$/.test(startsAt)) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'startsAt must be YYYY-MM-DD');
      }
      if (endsAt && !/^\d{4}-\d{2}-\d{2}$/.test(endsAt)) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'endsAt must be YYYY-MM-DD');
      }

      const contract = await repos.recurringContracts.create({
        customerId,
        name,
        description,
        intervalUnit,
        intervalValue: iv,
        amount: amt,
        taxRate: taxRate != null ? Number(taxRate) : 0.10,
        startsAt,
        endsAt,
        lineItems,
        createdBy: req.user?.sub ?? 'system',
      });
      res.status(201).json({ data: contract });
    })
  );

  router.patch(
    '/:id/pause',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const contract = await repos.recurringContracts.findById(req.params.id);
      if (!contract) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Recurring contract not found');
      if (contract.status !== 'active') {
        throw new ApiErrorResponse(409, 'INVALID_STATUS', `Contract is ${contract.status}, cannot pause`);
      }
      const updated = await repos.recurringContracts.updateStatus(req.params.id, 'paused');
      res.json({ data: updated });
    })
  );

  router.patch(
    '/:id/resume',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const contract = await repos.recurringContracts.findById(req.params.id);
      if (!contract) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Recurring contract not found');
      if (contract.status !== 'paused') {
        throw new ApiErrorResponse(409, 'INVALID_STATUS', `Contract is ${contract.status}, cannot resume`);
      }
      const updated = await repos.recurringContracts.updateStatus(req.params.id, 'active');
      res.json({ data: updated });
    })
  );

  router.patch(
    '/:id/cancel',
    requireRole('admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const contract = await repos.recurringContracts.findById(req.params.id);
      if (!contract) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Recurring contract not found');
      if (contract.status === 'cancelled' || contract.status === 'completed') {
        throw new ApiErrorResponse(409, 'INVALID_STATUS', `Contract is already ${contract.status}`);
      }
      const updated = await repos.recurringContracts.updateStatus(req.params.id, 'cancelled');
      res.json({ data: updated });
    })
  );

  return router;
}
