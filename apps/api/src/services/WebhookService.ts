import { createHmac } from 'crypto';
import { logger } from '../lib/logger.js';
import { webhookDeliveryFailureTotal } from '../observability/metrics.js';
import {
  WebhookRepository,
  WebhookDeliveryRepository,
  WebhookRecord,
  WebhookDeliveryRecord,
  WebhookDeliveryFilter,
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

  async listDeliveries(filter: WebhookDeliveryFilter): Promise<{ data: WebhookDeliveryRecord[]; total: number }> {
    return this.deliveryRepo.list(filter);
  }

  async findDelivery(id: string): Promise<WebhookDeliveryRecord | null> {
    return this.deliveryRepo.findById(id);
  }

  /**
   * Deliver an event to all matching webhooks for the org (fire-and-forget).
   * Errors are logged but never propagate to the caller.
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

  async retry(deliveryId: string, organizationId?: string): Promise<WebhookDeliveryRecord> {
    const delivery = await this.deliveryRepo.findById(deliveryId);
    if (!delivery) throw Object.assign(new Error('Delivery not found'), { code: 'NOT_FOUND' });

    const hook = await this.repo.findById(delivery.webhookId, organizationId);
    if (!hook) throw Object.assign(new Error('Webhook not found or not accessible'), { code: 'NOT_FOUND' });

    return this.dispatchAndRecord(hook, delivery.eventType, delivery.payload);
  }

  private async dispatch(hook: WebhookRecord, eventType: string, payload: object): Promise<void> {
    await this.dispatchAndRecord(hook, eventType, payload as Record<string, unknown>);
  }

  private async dispatchAndRecord(
    hook: WebhookRecord,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<WebhookDeliveryRecord> {
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
    let success = false;

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
        errorMessage = `HTTP ${res.status}`;
      } else {
        success = true;
      }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      webhookDeliveryFailureTotal.inc({ event_type: eventType, status: 'network_error' });
    }

    const record = await this.deliveryRepo.create({
      webhookId:    hook.id,
      eventType,
      payload,
      status:       success ? 'success' : 'failed',
      httpStatus,
      errorMessage,
    });

    if (!success) {
      throw new Error(errorMessage ?? 'Delivery failed');
    }

    return record;
  }
}
