import { Router, Request, Response } from 'express';
import { asyncHandler, ApiErrorResponse } from '../middleware/errorHandler.js';
import { SearchService } from '../services/SearchService.js';

const MAX_TAKE = 50;

export function searchRoutes(searchService: SearchService) {
  const router = Router();

  // GET /api/search?q=...&types=customer,product,quote&skip=0&take=20
  // Any authenticated user (all roles) can search.
  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const q = (req.query.q as string | undefined)?.trim() ?? '';
      if (!q) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'q is required');
      }
      if (q.length > 200) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'q must not exceed 200 characters');
      }

      const rawTypes = (req.query.types as string | undefined) ?? '';
      const types = rawTypes ? rawTypes.split(',').map(t => t.trim()).filter(Boolean) : [];

      const skip = Math.max(0, Number.parseInt((req.query.skip as string) || '0', 10));
      const take = Math.min(MAX_TAKE, Math.max(1, Number.parseInt((req.query.take as string) || '20', 10)));

      const { results, total } = await searchService.search(q, types, skip, take, req.user?.orgId);

      res.json({
        data: results,
        query: q,
        pagination: { skip, take, total },
      });
    })
  );

  return router;
}
