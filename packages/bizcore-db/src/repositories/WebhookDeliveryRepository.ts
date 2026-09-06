import { Kysely } from 'kysely';
import { KyselyDatabase } from '../types/kysely-database.js';

export type DeliveryStatus = 'success' | 'failed';

export interface WebhookDeliveryRecord {
  id: string;
  webhookId: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: DeliveryStatus;
  httpStatus: number | null;
  errorMessage: string | null;
  deliveredAt: Date;
}

export interface CreateWebhookDeliveryInput {
  webhookId: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: DeliveryStatus;
  httpStatus?: number | null;
  errorMessage?: string | null;
}

export interface WebhookDeliveryFilter {
  webhookId?: string;
  status?: DeliveryStatus;
  eventType?: string;
  limit?: number;
  offset?: number;
}

const COLS = [
  'id', 'webhook_id', 'event_type', 'payload',
  'status', 'http_status', 'error_message', 'delivered_at',
] as const;

export class WebhookDeliveryRepository {
  constructor(private readonly db: Kysely<KyselyDatabase>) {}

  async create(input: CreateWebhookDeliveryInput): Promise<WebhookDeliveryRecord> {
    const row = await this.db
      .insertInto('events.webhook_deliveries')
      .values({
        webhook_id:    input.webhookId,
        event_type:    input.eventType,
        payload:       input.payload as any,
        status:        input.status,
        http_status:   input.httpStatus ?? null,
        error_message: input.errorMessage ?? null,
      })
      .returning(COLS)
      .executeTakeFirstOrThrow();
    return this.map(row);
  }

  async findById(id: string): Promise<WebhookDeliveryRecord | null> {
    const row = await this.db
      .selectFrom('events.webhook_deliveries')
      .select(COLS)
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? this.map(row) : null;
  }

  async list(filter: WebhookDeliveryFilter = {}): Promise<{ data: WebhookDeliveryRecord[]; total: number }> {
    const limit  = filter.limit  ?? 20;
    const offset = filter.offset ?? 0;

    let q = this.db.selectFrom('events.webhook_deliveries').select(COLS);
    if (filter.webhookId) q = q.where('webhook_id',  '=', filter.webhookId);
    if (filter.status)    q = q.where('status',      '=', filter.status);
    if (filter.eventType) q = q.where('event_type',  '=', filter.eventType);

    let cq = this.db
      .selectFrom('events.webhook_deliveries')
      .select(eb => eb.fn.countAll<string>().as('cnt'));
    if (filter.webhookId) cq = cq.where('webhook_id',  '=', filter.webhookId);
    if (filter.status)    cq = cq.where('status',      '=', filter.status);
    if (filter.eventType) cq = cq.where('event_type',  '=', filter.eventType);

    const [rows, countRow] = await Promise.all([
      q.orderBy('delivered_at', 'desc').limit(limit).offset(offset).execute(),
      cq.executeTakeFirst(),
    ]);

    return {
      data:  rows.map(r => this.map(r)),
      total: parseInt(countRow?.cnt ?? '0', 10),
    };
  }

  private map(row: any): WebhookDeliveryRecord {
    return {
      id:           row.id,
      webhookId:    row.webhook_id,
      eventType:    row.event_type,
      payload:      row.payload,
      status:       row.status,
      httpStatus:   row.http_status ?? null,
      errorMessage: row.error_message ?? null,
      deliveredAt:  row.delivered_at,
    };
  }
}
