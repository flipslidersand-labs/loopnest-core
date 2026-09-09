import { Router, Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { WebhookService } from '../services/WebhookService.js';
import { asyncHandler, ApiErrorResponse } from '../middleware/errorHandler.js';
import { requireRole } from '../middleware/auth.js';

const MIN_SECRET_LENGTH = 16;

export const WEBHOOK_EVENT_TYPES = [
  'invoice.created',
  'invoice.paid',
  'payment.recorded',
  'payment.reversed',
  'payment.overdue',
  'quote.submitted',
  'quote.approved',
  'credit_note.issued',
  'credit_note.applied',
  'credit_note.refunded',
  'credit_note.voided',
  'dunning.action',
  'contract.paused',
  'contract.resumed',
] as const;

export type WebhookEventType = typeof WEBHOOK_EVENT_TYPES[number];

function validateEvents(events: unknown): string[] {
  if (!Array.isArray(events) || events.length === 0) {
    throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'events must be a non-empty array');
  }
  const invalid = events.filter(e => !WEBHOOK_EVENT_TYPES.includes(e as WebhookEventType));
  if (invalid.length > 0) {
    throw new ApiErrorResponse(
      400, 'VALIDATION_ERROR',
      `Invalid event type(s): ${invalid.join(', ')}. Valid types: ${WEBHOOK_EVENT_TYPES.join(', ')}`
    );
  }
  return events as string[];
}

export function webhookRoutes(webhookService: WebhookService) {
  const router = Router();

  // List valid event types — viewer+
  router.get(
    '/event-types',
    asyncHandler(async (_req: Request, res: Response) => {
      res.json({ data: WEBHOOK_EVENT_TYPES });
    })
  );

  // List webhooks for this org — viewer+
  router.get(
    '/',
    requireRole('viewer', 'editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const webhooks = await webhookService.list(req.user?.orgId);
      res.json({ data: webhooks, count: webhooks.length });
    })
  );

  // List delivery logs — viewer+, with optional filters
  // Must be before /:id to avoid Express matching "deliveries" as a webhook id
  router.get(
    '/deliveries',
    requireRole('viewer', 'editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const { webhookId, status, eventType, limit, offset } = req.query;
      if (status !== undefined && status !== 'success' && status !== 'failed') {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'status must be "success" or "failed"');
      }
      const result = await webhookService.listDeliveries({
        webhookId: webhookId as string | undefined,
        status:    status as 'success' | 'failed' | undefined,
        eventType: eventType as string | undefined,
        limit:     Math.min(100, Math.max(1, limit  ? parseInt(limit as string,  10) : 20)),
        offset:    Math.max(0,              offset ? parseInt(offset as string, 10) : 0),
      });
      res.json({ data: result.data, total: result.total });
    })
  );

  // Retry a delivery — editor+
  // Must be before /:id for same reason
  router.post(
    '/deliveries/:id/retry',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      try {
        const record = await webhookService.retry(req.params.id, req.user?.orgId);
        res.json({ data: record });
      } catch (err: any) {
        if (err?.code === 'NOT_FOUND') {
          throw new ApiErrorResponse(404, 'NOT_FOUND', err.message);
        }
        throw err;
      }
    })
  );

  // Get one — viewer+
  router.get(
    '/:id',
    requireRole('viewer', 'editor', 'admin'),
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
      const { url, events } = req.body;
      let { secret } = req.body;
      if (!url) throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'url is required');
      const validatedEvents = validateEvents(events);
      try { new URL(url); } catch {
        throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'url must be a valid URL');
      }
      if (secret !== undefined) {
        if (typeof secret !== 'string' || secret.length === 0) {
          throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'secret must be a non-empty string');
        }
        if (secret.length < MIN_SECRET_LENGTH) {
          throw new ApiErrorResponse(400, 'VALIDATION_ERROR', `secret must be at least ${MIN_SECRET_LENGTH} characters`);
        }
      } else {
        // Auto-generate a secret so HMAC signing is always active
        secret = randomBytes(32).toString('hex');
      }
      const webhook = await webhookService.register({
        organizationId: req.user?.orgId,
        url,
        events: validatedEvents,
        secret,
      });
      // Return the plaintext secret once — it is not retrievable again
      res.status(201).json({ data: webhook, secret });
    })
  );

  // Update — editor+
  router.patch(
    '/:id',
    requireRole('editor', 'admin'),
    asyncHandler(async (req: Request, res: Response) => {
      const { url, events, isActive } = req.body;
      let { secret } = req.body;
      if (url) {
        try { new URL(url); } catch {
          throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'url must be a valid URL');
        }
      }
      if (secret !== undefined) {
        if (typeof secret !== 'string' || secret.length === 0) {
          throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'secret must be a non-empty string');
        }
        if (secret.length < MIN_SECRET_LENGTH) {
          throw new ApiErrorResponse(400, 'VALIDATION_ERROR', `secret must be at least ${MIN_SECRET_LENGTH} characters`);
        }
      }
      const validatedEvents = events !== undefined ? validateEvents(events) : undefined;
      const webhook = await webhookService.update(req.params.id, { url, events: validatedEvents, secret, isActive }, req.user?.orgId);
      if (!webhook) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Webhook not found');
      const responseBody: Record<string, unknown> = { data: webhook };
      if (secret !== undefined) responseBody.secret = secret;
      res.json(responseBody);
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
