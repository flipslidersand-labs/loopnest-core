import { randomUUID } from 'crypto';
import { sql } from 'kysely';

export interface TemplateItem {
  productId: string;
  quantity: number;
  unitPrice: number;
  notes?: string;
}

export interface QuoteTemplate {
  id: string;
  name: string;
  description: string | null;
  items: TemplateItem[];
  organizationId: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuoteTemplateInput {
  name: string;
  description?: string;
  items: TemplateItem[];
  organizationId?: string;
  createdBy: string;
}

export class QuoteTemplateRepository {
  constructor(private db: any) {}

  async findAll(organizationId?: string): Promise<QuoteTemplate[]> {
    let q = this.db
      .selectFrom('core.quote_templates')
      .selectAll()
      .orderBy('created_at', 'desc');
    if (organizationId) {
      q = q.where('organization_id', '=', organizationId);
    }
    const rows = await q.execute();
    return rows.map((r: any) => this.map(r));
  }

  async findById(id: string, organizationId?: string): Promise<QuoteTemplate | null> {
    let q = this.db
      .selectFrom('core.quote_templates')
      .selectAll()
      .where('id', '=', id);
    if (organizationId) {
      q = q.where('organization_id', '=', organizationId);
    }
    const row = await q.executeTakeFirst();
    return row ? this.map(row) : null;
  }

  async create(data: QuoteTemplateInput): Promise<QuoteTemplate> {
    const id = randomUUID();
    const now = new Date();
    const row = await this.db
      .insertInto('core.quote_templates')
      .values({
        id,
        name: data.name,
        description: data.description ?? null,
        items: JSON.stringify(data.items),
        organization_id: data.organizationId ?? null,
        created_by: data.createdBy,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirst();
    return this.map(row);
  }

  async delete(id: string, organizationId?: string): Promise<boolean> {
    let q = this.db.deleteFrom('core.quote_templates').where('id', '=', id);
    if (organizationId) q = q.where('organization_id', '=', organizationId);
    const result = await q.executeTakeFirst();
    return Number(result?.numDeletedRows ?? 0) > 0;
  }

  /** Generate the next auto-incremented quote number: QUO-YYYYMM-NNNNNN */
  async nextQuoteNumber(): Promise<string> {
    const result = await sql<{ nextval: string }>`
      SELECT nextval('core.quote_number_seq') AS nextval
    `.execute(this.db);
    const seq = Number(result.rows[0].nextval);
    const now = new Date();
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    return `QUO-${ym}-${String(seq).padStart(6, '0')}`;
  }

  private map(r: any): QuoteTemplate {
    const items: TemplateItem[] =
      typeof r.items === 'string' ? JSON.parse(r.items) : (r.items ?? []);
    return {
      id: r.id,
      name: r.name,
      description: r.description ?? null,
      items,
      organizationId: r.organization_id ?? null,
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}
