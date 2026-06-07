import { Router, Request, Response } from 'express';
import { WebhookService } from '../services/WebhookService.js';
import { asyncHandler, ApiErrorResponse } from '../middleware/errorHandler.js';
import { requireRole } from '../middleware/auth.js';

export function webhookRoutes(webhookService: WebhookService) {
  const router = Router();

  // List webhooks for this org — viewer+
  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const webhooks = await webhookService.list(req.user?.orgId);
      res.json({ data: webhooks, count: webhooks.length });
    })
  );

  // Get one — viewer+
  router.get(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const webhook = await webhookService.findById(req.params.id, req.user?.orgId);
      if (!webhook) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Webhook not found');
      res.json({ data: webhook });
    })
  );

  // Register — editor+
  router.post(
    '/',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const { url, events, secret } = req.body;
      if (!url) throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'url is required');
      if (!Array.isArray(events) || events.length === 0) {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'events must be a non-empty array');
      }
      try { new URL(url); } catch {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'url must be a valid URL');
      }
      const webhook = await webhookService.register({
        organizationId: req.user?.orgId,
        url,
        events,
        secret,
      });
      res.status(201).json({ data: webhook });
    })
  );

  // Update — editor+
  router.patch(
    '/:id',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const { url, events, secret, isActive } = req.body;
      if (url) {
        try { new URL(url); } catch {
          throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'url must be a valid URL');
        }
      }
      const webhook = await webhookService.update(req.params.id, { url, events, secret, isActive }, req.user?.orgId);
      if (!webhook) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Webhook not found');
      res.json({ data: webhook });
    })
  );

  // Delete — admin
  router.delete(
    '/:id',
    requireRole('admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const deleted = await webhookService.delete(req.params.id, req.user?.orgId);
      if (!deleted) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Webhook not found');
      res.json({ data: { success: true } });
    })
  );

  return router;
}
