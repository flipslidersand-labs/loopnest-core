import { createHmac } from 'crypto';
import { logger } from '../lib/logger.js';
import { webhookDeliveryFailureTotal } from '../observability/metrics.js';
import { ApiErrorResponse } from '../middleware/errorHandler.js';
import {
  WebhookRepository,
  WebhookDeliveryRepository,
  WebhookDelivery,
  WebhookDeliveryFilter,
  WebhookRecord,
  CreateWebhookInput,
  UpdateWebhookInput,
} from '@loopnest/bizcore-db';

export class WebhookService {
  constructor(
    private readonly repo: WebhookRepository,
    private readonly deliveryRepo: WebhookDeliveryRepository,
  ) {}

  async register(input: CreateWebhookInput): Promise<WebhookRecord> {
    return this.repo.create(input);
  }

  async list(organizationId?: string): Promise<WebhookRecord[]> {
    return this.repo.findAll(organizationId);
  }

  async findById(id: string, organizationId?: string): Promise<WebhookRecord | null> {
    return this.repo.findById(id, organizationId);
  }

  async update(id: string, input: UpdateWebhookInput, organizationId?: string): Promise<WebhookRecord | null> {
    return this.repo.update(id, input, organizationId);
  }

  async delete(id: string, organizationId?: string): Promise<boolean> {
    return this.repo.delete(id, organizationId);
  }

  /**
   * Deliver an event to all matching webhooks for the org (fire-and-forget).
   * Each attempt is persisted to webhook_deliveries regardless of outcome.
   */
  async deliver(orgId: string | undefined, eventType: string, payload: object): Promise<void> {
    if (!orgId) return;
    const hooks = await this.repo.findActiveForEvent(eventType, orgId);
    for (const hook of hooks) {
      this.dispatch(hook, eventType, payload).catch(err => {
        logger.error({ hookId: hook.id, url: hook.url, err }, 'webhook delivery failed');
      });
    }
  }

  async listDeliveries(filter: WebhookDeliveryFilter): Promise<{ data: WebhookDelivery[]; total: number }> {
    const [data, total] = await Promise.all([
      this.deliveryRepo.findAll(filter),
      this.deliveryRepo.count(filter),
    ]);
    return { data, total };
  }

  async retryDelivery(deliveryId: string): Promise<WebhookDelivery> {
    const delivery = await this.deliveryRepo.findById(deliveryId);
    if (!delivery) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Delivery not found');
    const hook = await this.repo.findById(delivery.webhookId);
    if (!hook) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Webhook not found or deleted');
    return this.dispatch(hook, delivery.eventType, delivery.payload);
  }

  private async dispatch(hook: WebhookRecord, eventType: string, payload: object): Promise<WebhookDelivery> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      event:     eventType,
      data:      payload,
      timestamp: new Date().toISOString(),
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-LoopNest-Timestamp': timestamp,
    };
    if (hook.secret) {
      const sig = createHmac('sha256', hook.secret).update(`${timestamp}.${body}`).digest('hex');
      headers['X-LoopNest-Signature'] = `sha256=${sig}`;
    }

    let httpStatus: number | null = null;
    let errorMessage: string | null = null;
    let status: 'success' | 'failed' = 'success';

    try {
      const res = await fetch(hook.url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(5000),
      });
      httpStatus = res.status;
      if (!res.ok) {
        webhookDeliveryFailureTotal.inc({ event_type: eventType, status: String(res.status) });
        status = 'failed';
        errorMessage = `HTTP ${res.status}`;
      }
    } catch (err) {
      status = 'failed';
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    return this.deliveryRepo.create({
      webhookId: hook.id,
      eventType,
      payload,
      status,
      httpStatus,
      errorMessage,
    });
  }
}
