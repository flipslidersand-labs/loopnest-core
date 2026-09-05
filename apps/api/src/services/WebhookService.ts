import { createHmac } from 'crypto';
import { logger } from '../lib/logger.js';
import {
  WebhookRepository,
  WebhookRecord,
  CreateWebhookInput,
  UpdateWebhookInput,
} from '@loopnest/bizcore-db';

export class WebhookService {
  constructor(private readonly repo: WebhookRepository) {}

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
   * Errors are logged but never propagate to the caller.
   */
  async deliver(orgId: string | undefined, eventType: string, payload: object): Promise<void> {
    if (!orgId) return; // unscoped tokens have no org to route to
    const hooks = await this.repo.findActiveForEvent(eventType, orgId);
    for (const hook of hooks) {
      this.dispatch(hook, eventType, payload).catch(err => {
        logger.error({ hookId: hook.id, url: hook.url, err }, 'webhook delivery failed');
      });
    }
  }

  private async dispatch(hook: WebhookRecord, eventType: string, payload: object): Promise<void> {
    const body = JSON.stringify({
      event:     eventType,
      data:      payload,
      timestamp: new Date().toISOString(),
    });

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (hook.secret) {
      const sig = createHmac('sha256', hook.secret).update(body).digest('hex');
      headers['X-LoopNest-Signature'] = `sha256=${sig}`;
    }

    const res = await fetch(hook.url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} from ${hook.url}`);
  }
}
