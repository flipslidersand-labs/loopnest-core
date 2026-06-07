import { Kysely, sql } from 'kysely';
import { KyselyDatabase } from '../types/kysely-database.js';

export interface WebhookRecord {
  id: string;
  organizationId: string | null;
  url: string;
  events: string[];
  secret: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWebhookInput {
  organizationId?: string;
  url: string;
  events: string[];
  secret?: string;
}

export interface UpdateWebhookInput {
  url?: string;
  events?: string[];
  secret?: string;
  isActive?: boolean;
}

const COLS = [
  'id', 'organization_id', 'url', 'events', 'secret',
  'is_active', 'created_at', 'updated_at',
] as const;

export class WebhookRepository {
  constructor(private readonly db: Kysely<KyselyDatabase>) {}

  async create(input: CreateWebhookInput): Promise<WebhookRecord> {
    const rows = await this.db
      .insertInto('events.webhooks')
      .values({
        organization_id: input.organizationId ?? null,
        url: input.url,
        events: input.events as any,
        secret: input.secret ?? null,
        is_active: true,
      })
      .returning(COLS)
      .execute();
    return this.map(rows[0]);
  }

  async findAll(organizationId?: string): Promise<WebhookRecord[]> {
    let q = this.db.selectFrom('events.webhooks').select(COLS);
    if (organizationId) {
      q = q.where('organization_id', '=', organizationId);
    }
    const rows = await q.orderBy('created_at', 'desc').execute();
    return rows.map(r => this.map(r));
  }

  async findById(id: string, organizationId?: string): Promise<WebhookRecord | null> {
    let q = this.db.selectFrom('events.webhooks').select(COLS).where('id', '=', id);
    if (organizationId) {
      q = q.where('organization_id', '=', organizationId);
    }
    const row = await q.executeTakeFirst();
    return row ? this.map(row) : null;
  }

  async update(id: string, input: UpdateWebhookInput, organizationId?: string): Promise<WebhookRecord | null> {
    const data: Record<string, unknown> = { updated_at: new Date() };
    if (input.url      !== undefined) data.url       = input.url;
    if (input.events   !== undefined) data.events    = input.events;
    if (input.secret   !== undefined) data.secret    = input.secret;
    if (input.isActive !== undefined) data.is_active = input.isActive;

    let q = this.db
      .updateTable('events.webhooks')
      .set(data as any)
      .where('id', '=', id)
      .returning(COLS);
    if (organizationId) {
      q = q.where('organization_id', '=', organizationId);
    }
    const row = await q.executeTakeFirst();
    return row ? this.map(row) : null;
  }

  async delete(id: string, organizationId?: string): Promise<boolean> {
    let q = this.db.deleteFrom('events.webhooks').where('id', '=', id);
    if (organizationId) {
      q = q.where('organization_id', '=', organizationId);
    }
    const result = await q.executeTakeFirst();
    return Number(result?.numDeletedRows ?? 0) > 0;
  }

  /** Find webhooks that should receive the given eventType (exact match or wildcard '*'). */
  async findActiveForEvent(eventType: string, organizationId?: string): Promise<WebhookRecord[]> {
    const rows = await this.db
      .selectFrom('events.webhooks')
      .select(COLS)
      .where('is_active', '=', true)
      .$if(organizationId !== undefined, q => q.where('organization_id', '=', organizationId!))
      .where(eb =>
        eb.or([
          sql<boolean>`events @> ARRAY[${eventType}::text]`,
          sql<boolean>`events @> ARRAY['*'::text]`,
        ])
      )
      .execute();
    return rows.map(r => this.map(r));
  }

  private map(row: any): WebhookRecord {
    return {
      id:             row.id,
      organizationId: row.organization_id,
      url:            row.url,
      events:         Array.isArray(row.events) ? row.events : [],
      secret:         row.secret,
      isActive:       row.is_active,
      createdAt:      row.created_at,
      updatedAt:      row.updated_at,
    };
  }
}
