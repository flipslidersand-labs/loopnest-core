import type { Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import type { KyselyDatabase } from '../types/kysely-database.js';

export type WebhookDeliveryStatus = 'success' | 'failed';

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: WebhookDeliveryStatus;
  httpStatus: number | null;
  errorMessage: string | null;
  deliveredAt: Date;
}

export interface WebhookDeliveryFilter {
  webhookId?: string;
  status?: WebhookDeliveryStatus;
  eventType?: string;
  skip?: number;
  take?: number;
}

export class WebhookDeliveryRepository {
  constructor(private readonly db: Kysely<KyselyDatabase>) {}

  async create(data: {
    webhookId: string;
    eventType: string;
    payload: object;
    status: WebhookDeliveryStatus;
    httpStatus?: number | null;
    errorMessage?: string | null;
  }): Promise<WebhookDelivery> {
    const row = await this.db
      .insertInto('events.webhook_deliveries')
      .values({
        id: randomUUID(),
        webhook_id: data.webhookId,
        event_type: data.eventType,
        payload: data.payload as Record<string, unknown>,
        status: data.status,
        http_status: data.httpStatus ?? null,
        error_message: data.errorMessage ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return this.map(row);
  }

  async findById(id: string): Promise<WebhookDelivery | null> {
    const row = await this.db
      .selectFrom('events.webhook_deliveries')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? this.map(row) : null;
  }

  async findAll(filter: WebhookDeliveryFilter = {}): Promise<WebhookDelivery[]> {
    let q = this.db
      .selectFrom('events.webhook_deliveries')
      .selectAll()
      .orderBy('delivered_at', 'desc');
    if (filter.webhookId) q = q.where('webhook_id', '=', filter.webhookId);
    if (filter.status)    q = q.where('status', '=', filter.status);
    if (filter.eventType) q = q.where('event_type', '=', filter.eventType);
    if (filter.skip)      q = q.offset(filter.skip);
    q = q.limit(filter.take ?? 20);
    const rows = await q.execute();
    return rows.map(r => this.map(r));
  }

  async count(filter: Omit<WebhookDeliveryFilter, 'skip' | 'take'> = {}): Promise<number> {
    let q = this.db
      .selectFrom('events.webhook_deliveries')
      .select(({ fn }) => fn.countAll<string>().as('count'));
    if (filter.webhookId) q = q.where('webhook_id', '=', filter.webhookId);
    if (filter.status)    q = q.where('status', '=', filter.status);
    if (filter.eventType) q = q.where('event_type', '=', filter.eventType);
    const result = await q.executeTakeFirst();
    return Number(result?.count ?? 0);
  }

  private map(row: any): WebhookDelivery {
    return {
      id: row.id,
      webhookId: row.webhook_id,
      eventType: row.event_type,
      payload: row.payload as Record<string, unknown>,
      status: row.status as WebhookDeliveryStatus,
      httpStatus: row.http_status ?? null,
      errorMessage: row.error_message ?? null,
      deliveredAt: row.delivered_at,
    };
  }
}
