import { Router, Request, Response } from 'express';
import { RepositoryContainer } from '@loopnest/bizcore-db';
import { signToken } from '../lib/jwt.js';
import { authenticate } from '../middleware/auth.js';
import { requireCustomer } from '../middleware/auth.js';
import { asyncHandler, ApiErrorResponse } from '../middleware/errorHandler.js';

const JWT_SECRET = process.env.JWT_SECRET || 'loopnest_dev_secret';
const PORTAL_TOKEN_TTL = 60 * 60 * 24 * 30; // 30 days

export function portalRoutes(repos: RepositoryContainer) {
  const router = Router();

  // Public — no authenticate middleware
  router.post(
    '/login',
    asyncHandler(async (req: Request, res: Response) => {
      const { customerId } = req.body;
      if (!customerId || typeof customerId !== 'string') {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'customerId is required');
      }
      const customer = await repos.customers.findById(customerId);
      if (!customer) {
        throw new ApiErrorResponse(401, 'UNAUTHORIZED', 'Invalid customerId');
      }
      const token = signToken(
        { sub: customerId, role: 'customer', customerId },
        JWT_SECRET,
        PORTAL_TOKEN_TTL,
      );
      res.json({ token, expiresIn: PORTAL_TOKEN_TTL });
    })
  );

  // All routes below require a valid customer token
  router.use(authenticate, requireCustomer);

  router.get(
    '/me',
    asyncHandler(async (req: Request, res: Response) => {
      const customer = await repos.customers.findById(req.customerId!);
      if (!customer) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Customer not found');
      res.json({ data: customer });
    })
  );

  router.get(
    '/invoices',
    asyncHandler(async (req: Request, res: Response) => {
      const page   = Math.max(1, parseInt(req.query.page   as string || '1',  10));
      const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit as string || '20', 10)));
      const offset = (page - 1) * limit;

      const all = await repos.invoices.findAll({ customerId: req.customerId });
      const data = all.slice(offset, offset + limit);
      res.json({ data, total: all.length, page, limit });
    })
  );

  router.get(
    '/invoices/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const invoice = await repos.invoices.findById(req.params.id);
      if (!invoice || invoice.customerId !== req.customerId) {
        throw new ApiErrorResponse(404, 'NOT_FOUND', 'Invoice not found');
      }
      res.json({ data: invoice });
    })
  );

  router.get(
    '/quotes',
    asyncHandler(async (req: Request, res: Response) => {
      const page   = Math.max(1, parseInt(req.query.page   as string || '1',  10));
      const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit as string || '20', 10)));
      const offset = (page - 1) * limit;

      const all = await repos.quotes.findAll({ customerId: req.customerId });
      const data = all.slice(offset, offset + limit);
      res.json({ data, total: all.length, page, limit });
    })
  );

  return router;
}
