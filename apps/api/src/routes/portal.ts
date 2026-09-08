import { Router, Request, Response } from 'express';
import { RepositoryContainer } from '@loopnest/bizcore-db';
import { hashPortalPassword, verifyPortalPassword } from '@loopnest/bizcore-db';
import { asyncHandler, ApiErrorResponse } from '../middleware/errorHandler.js';
import { authenticate, requireCustomer, requireRole } from '../middleware/auth.js';
import { signToken } from '../lib/jwt.js';

const PORTAL_TOKEN_TTL = 30 * 24 * 3600; // 30 days
// JWT_SECRET is validated at startup in auth.ts — safe to read here after boot.
const JWT_SECRET = process.env.JWT_SECRET!;

export function portalRoutes(repos: RepositoryContainer) {
  const router = Router();

  // POST /api/portal/login — exchange email + password for a portal JWT
  router.post(
    '/login',
    asyncHandler(async (req: Request, res: Response) => {
      const { email, password } = req.body;
      if (!email || !password) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'email and password are required');
      }

      // Always perform a constant-time-ish lookup to avoid timing-based email enumeration
      const customer = await repos.customers.findByEmail(email);
      if (!customer) {
        // Use a dummy verify to waste the same time as a real verify
        await verifyPortalPassword(password, 'dummy:dummy');
        throw new ApiErrorResponse(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
      }

      const hash = await repos.customers.getPortalPasswordHash(customer.id);
      if (!hash) {
        throw new ApiErrorResponse(401, 'PORTAL_NOT_CONFIGURED', 'Portal access has not been enabled for this account');
      }

      const valid = await verifyPortalPassword(password, hash);
      if (!valid) {
        throw new ApiErrorResponse(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
      }

      const token = signToken(
        { sub: customer.id, role: 'customer', customerId: customer.id },
        JWT_SECRET,
        PORTAL_TOKEN_TTL,
      );
      res.json({ token, expiresIn: PORTAL_TOKEN_TTL, customerId: customer.id, name: customer.name });
    })
  );

  // POST /api/portal/admin/set-password — admin sets a portal password for a customer
  router.post(
    '/admin/set-password',
    requireRole('admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const { customerId, password } = req.body;
      if (!customerId || !password) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'customerId and password are required');
      }
      if (typeof password !== 'string' || password.length < 8) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'password must be at least 8 characters');
      }
      const customer = await repos.customers.findById(customerId);
      if (!customer) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Customer not found');

      const hash = await hashPortalPassword(password);
      await repos.customers.setPortalPasswordHash(customerId, hash);
      res.json({ data: { customerId, message: 'Portal password set successfully' } });
    })
  );

  // All routes below require a valid customer JWT
  router.use(authenticate, requireCustomer);

  // GET /api/portal/me — own profile
  router.get(
    '/me',
    asyncHandler(async (req: Request, res: Response) => {
      const customer = await repos.customers.findById(req.user!.customerId!);
      if (!customer) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Customer not found');
      const creditStatus = await repos.customers.getCreditStatus(customer.id);
      res.json({ data: { ...customer, creditStatus } });
    })
  );

  // GET /api/portal/invoices — own invoice list
  router.get(
    '/invoices',
    asyncHandler(async (req: Request, res: Response) => {
      const customerId = req.user!.customerId!;
      const skip = Math.max(0, Number.parseInt((req.query.skip as string) || '0', 10));
      const take = Math.min(50, Math.max(1, Number.parseInt((req.query.take as string) || '20', 10)));
      const status = req.query.status as string | undefined;

      const [invoices, total] = await Promise.all([
        repos.invoices.findAll({ customerId, skip, take, status }),
        repos.invoices.count({ customerId, status }),
      ]);
      res.json({ data: invoices, pagination: { skip, take, total } });
    })
  );

  // GET /api/portal/invoices/:id — single invoice (customer-scoped)
  router.get(
    '/invoices/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const invoice = await repos.invoices.findById(req.params.id);
      if (!invoice || invoice.customerId !== req.user!.customerId) {
        throw new ApiErrorResponse(404, 'NOT_FOUND', 'Invoice not found');
      }
      res.json({ data: invoice });
    })
  );

  // GET /api/portal/quotes — own quote list
  router.get(
    '/quotes',
    asyncHandler(async (req: Request, res: Response) => {
      const customerId = req.user!.customerId!;
      const skip = Math.max(0, Number.parseInt((req.query.skip as string) || '0', 10));
      const take = Math.min(50, Math.max(1, Number.parseInt((req.query.take as string) || '20', 10)));

      const quotes = await repos.quotes.findByCustomer(customerId, { skip, take });
      const total = await repos.quotes.count({ customerId });
      res.json({ data: quotes, pagination: { skip, take, total } });
    })
  );

  // GET /api/portal/quotes/:id — single quote (customer-scoped)
  router.get(
    '/quotes/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const quote = await repos.quotes.findById(req.params.id);
      if (!quote || quote.customerId !== req.user!.customerId) {
        throw new ApiErrorResponse(404, 'NOT_FOUND', 'Quote not found');
      }
      res.json({ data: quote });
    })
  );

  return router;
}
