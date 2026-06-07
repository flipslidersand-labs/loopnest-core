import { Router, Request, Response } from 'express';
import { RepositoryContainer } from '@loopnest/bizcore-db';
import { asyncHandler, ApiErrorResponse } from '../middleware/errorHandler.js';
import { requireRole } from '../middleware/auth.js';

export function productRoutes(repos: RepositoryContainer) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const skip = Number.parseInt(req.query.skip as string) || 0;
      const take = Number.parseInt(req.query.take as string) || 10;
      const category = req.query.category as string;
      let products, count;
      if (category) {
        products = await repos.products.findByCategory(category, { skip, take });
        count = await repos.products.count({ category } as any);
      } else {
        products = await repos.products.findAll({ skip, take });
        count = await repos.products.count();
      }
      res.json({ data: products, pagination: { skip, take, total: count }, filter: category ? { category } : undefined });
    })
  );

  router.get(
    '/sku/:sku',
    asyncHandler(async (req: Request, res: Response) => {
      const product = await repos.products.findBySku(req.params.sku);
      if (!product) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Product not found');
      res.json({ data: product });
    })
  );

  router.get(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const product = await repos.products.findById(req.params.id);
      if (!product) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Product not found');
      res.json({ data: product });
    })
  );

  router.post(
    '/',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const { sku, name, category, unitPrice } = req.body;
      if (!sku || !name || !category || unitPrice === undefined) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'SKU, name, category, and unitPrice are required');
      }
      const product = await repos.products.create({ sku, name, category, unitPrice });
      res.status(201).json({ data: product });
    })
  );

  router.patch(
    '/:id',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const { name, category, unitPrice, stockQuantity } = req.body;
      const product = await repos.products.update(req.params.id, { name, category, unitPrice, stockQuantity });
      res.json({ data: product });
    })
  );

  router.delete(
    '/:id',
    requireRole('admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const success = await repos.products.delete(req.params.id);
      if (!success) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Product not found');
      res.json({ data: { success: true } });
    })
  );

  return router;
}
