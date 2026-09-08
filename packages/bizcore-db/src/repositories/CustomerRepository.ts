import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { KyselyDatabase } from '../types/kysely-database.js';
import { BaseRepository, FindOptions, CreateInput, UpdateInput } from './BaseRepository.js';
import { randomUUID } from 'node:crypto';
import { decodeCursor, makeCursor } from '../utils/cursor.js';

export interface CustomerPage {
  data: Customer[];
  pagination: { limit: number; nextCursor: string | null };
}

export interface Customer {
  id: string;
  name: string;
  email?: string;
  address?: string;
  phone?: string;
  organizationId?: string;
  creditLimit: number | null;
  creditUsed: number;
  createdAt: Date;
}

export interface CreditStatus {
  customerId: string;
  creditLimit: number | null;
  creditUsed: number;
  creditAvailable: number | null;
  isUnlimited: boolean;
  isOverLimit: boolean;
}

export interface CustomerFilter extends FindOptions {
  organizationId?: string;
  cursor?: string; // opaque cursor from CustomerPage.pagination.nextCursor
}

export class CustomerRepository extends BaseRepository<Customer> {
  constructor(private db: Kysely<KyselyDatabase>) {
    super();
  }

  async findById(id: string, organizationId?: string): Promise<Customer | null> {
    let q = this.db
      .selectFrom('core.customers')
      .selectAll()
      .where('id', '=', id);
    if (organizationId) q = q.where('organization_id', '=', organizationId);
    const row = await q.executeTakeFirst();
    return row ? this.map(row) : null;
  }

  async findAll(options?: CustomerFilter): Promise<Customer[]> {
    if (options?.skip !== undefined) {
      process.stderr.write('[CustomerRepository] skip/take is deprecated; use findPage() instead\n');
    }
    let q = this.db.selectFrom('core.customers').selectAll()
      .orderBy('created_at', 'desc')
      .orderBy('id', 'asc');
    if (options?.organizationId) q = q.where('organization_id', '=', options.organizationId);
    if (options?.skip) q = q.offset(options.skip);
    if (options?.take) q = q.limit(options.take);
    const rows = await q.execute();
    return rows.map(r => this.map(r));
  }

  async findPage(options?: CustomerFilter): Promise<CustomerPage> {
    const limit = Math.min(options?.take ?? 20, 100);
    let q = this.db.selectFrom('core.customers').selectAll()
      .orderBy('created_at', 'desc')
      .orderBy('id', 'asc')
      .limit(limit + 1);
    if (options?.organizationId) q = q.where('organization_id', '=', options.organizationId);
    if (options?.cursor) {
      const c = decodeCursor(options.cursor);
      if (c) {
        const ts = new Date(c.createdAt);
        q = q.where((eb: any) => eb.or([
          eb('created_at', '<', ts),
          eb.and([eb('created_at', '=', ts), eb('id', '>', c.id)]),
        ]));
      }
    }
    const rows = await q.execute();
    const hasMore = rows.length > limit;
    const data = rows.slice(0, limit).map(r => this.map(r));
    const nextCursor = hasMore ? makeCursor(data[data.length - 1]) : null;
    return { data, pagination: { limit, nextCursor } };
  }

  async findOne(where: Partial<Customer>, options?: FindOptions): Promise<Customer | null> {
    let q = this.db.selectFrom('core.customers').selectAll();
    if (where.name) q = q.where('name', '=', where.name);
    const row = await q.executeTakeFirst();
    return row ? this.map(row) : null;
  }

  async create(data: CreateInput<Customer>): Promise<Customer> {
    const row = await this.db
      .insertInto('core.customers')
      .values({
        id: randomUUID(),
        name: data.name,
        address: data.address ?? null,
        phone: data.phone ?? null,
        organization_id: data.organizationId ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return this.map(row);
  }

  async update(id: string, data: UpdateInput<Customer>): Promise<Customer> {
    const row = await this.db
      .updateTable('core.customers')
      .set({
        ...(data.name !== undefined && { name: data.name }),
        ...(data.address !== undefined && { address: data.address }),
        ...(data.phone !== undefined && { phone: data.phone }),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return this.map(row);
  }

  async delete(id: string): Promise<boolean> {
    await this.db
      .deleteFrom('core.customers')
      .where('id', '=', id)
      .execute();
    return true;
  }

  async count(where?: { organizationId?: string }): Promise<number> {
    let q = this.db
      .selectFrom('core.customers')
      .select(({ fn }) => fn.countAll<string>().as('count'));
    if (where?.organizationId) q = q.where('organization_id', '=', where.organizationId);
    const result = await q.executeTakeFirst();
    return Number(result?.count ?? 0);
  }

  async setCreditLimit(id: string, creditLimit: number | null): Promise<Customer | null> {
    const row = await this.db
      .updateTable('core.customers')
      .set({ credit_limit: creditLimit })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst()
      .catch(() => undefined);
    return row ? this.map(row) : null;
  }

  async incrementCreditUsed(id: string, amount: number): Promise<Customer | null> {
    const row = await this.db
      .updateTable('core.customers')
      .set({ credit_used: sql`credit_used + ${amount}` })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst()
      .catch(() => undefined);
    return row ? this.map(row) : null;
  }

  async decrementCreditUsed(id: string, amount: number): Promise<Customer | null> {
    const row = await this.db
      .updateTable('core.customers')
      .set({ credit_used: sql`GREATEST(0, credit_used - ${amount})` })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst()
      .catch(() => undefined);
    return row ? this.map(row) : null;
  }

  async getCreditStatus(id: string): Promise<CreditStatus | null> {
    const row = await this.db
      .selectFrom('core.customers')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) return null;
    const limit = row.credit_limit !== null ? Number(row.credit_limit) : null;
    const used = Number(row.credit_used);
    return {
      customerId: id,
      creditLimit: limit,
      creditUsed: used,
      creditAvailable: limit !== null ? Math.max(0, limit - used) : null,
      isUnlimited: limit === null,
      isOverLimit: limit !== null && used > limit,
    };
  }

  private map(row: any): Customer {
    return {
      id: row.id,
      name: row.name,
      email: row.contact_email ?? undefined,
      address: row.address ?? undefined,
      phone: row.phone ?? undefined,
      organizationId: row.organization_id ?? undefined,
      creditLimit: row.credit_limit !== null ? Number(row.credit_limit) : null,
      creditUsed: Number(row.credit_used ?? 0),
      createdAt: row.created_at,
    };
  }
}
