import type { Kysely } from 'kysely';
import type { KyselyDatabase } from '../types/kysely-database.js';
import { BaseRepository, FindOptions, CreateInput, UpdateInput } from './BaseRepository.js';
import { randomUUID } from 'node:crypto';

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  unitPrice: number;
  organizationId?: string;
  createdAt: Date;
}

export interface ProductFilter extends FindOptions {
  organizationId?: string;
  category?: string;
}

export class ProductRepository extends BaseRepository<Product> {
  constructor(private db: Kysely<KyselyDatabase>) {
    super();
  }

  async findById(id: string, organizationId?: string): Promise<Product | null> {
    let q = this.db
      .selectFrom('core.products')
      .selectAll()
      .where('id', '=', id);
    if (organizationId) q = q.where('organization_id', '=', organizationId);
    const row = await q.executeTakeFirst();
    return row ? this.map(row) : null;
  }

  async findBySku(sku: string): Promise<Product | null> {
    const row = await this.db
      .selectFrom('core.products')
      .selectAll()
      .where('sku', '=', sku)
      .executeTakeFirst();
    return row ? this.map(row) : null;
  }

  async findAll(options?: ProductFilter): Promise<Product[]> {
    let q = this.db.selectFrom('core.products').selectAll().orderBy('name', 'asc');
    if (options?.organizationId) q = q.where('organization_id', '=', options.organizationId);
    if (options?.category) q = q.where('category', '=', options.category);
    if (options?.skip) q = q.offset(options.skip);
    if (options?.take) q = q.limit(options.take);
    const rows = await q.execute();
    return rows.map(r => this.map(r));
  }

  async findOne(where: Partial<Product>, options?: FindOptions): Promise<Product | null> {
    let q = this.db.selectFrom('core.products').selectAll();
    if (where.category) q = q.where('category', '=', where.category);
    if (where.sku)      q = q.where('sku', '=', where.sku);
    const row = await q.executeTakeFirst();
    return row ? this.map(row) : null;
  }

  async findByCategory(category: string, options?: ProductFilter): Promise<Product[]> {
    let q = this.db
      .selectFrom('core.products')
      .selectAll()
      .where('category', '=', category)
      .orderBy('name', 'asc');
    if (options?.organizationId) q = q.where('organization_id', '=', options.organizationId);
    if (options?.skip) q = q.offset(options.skip);
    if (options?.take) q = q.limit(options.take);
    const rows = await q.execute();
    return rows.map(r => this.map(r));
  }

  async create(data: CreateInput<Product>): Promise<Product> {
    const row = await this.db
      .insertInto('core.products')
      .values({
        id: randomUUID(),
        sku: data.sku,
        name: data.name,
        category: data.category,
        unit_price: data.unitPrice,
        organization_id: data.organizationId ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return this.map(row);
  }

  async update(id: string, data: UpdateInput<Product>): Promise<Product> {
    const row = await this.db
      .updateTable('core.products')
      .set({
        ...(data.name !== undefined && { name: data.name }),
        ...(data.category !== undefined && { category: data.category }),
        ...(data.unitPrice !== undefined && { unit_price: data.unitPrice }),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return this.map(row);
  }

  async delete(id: string): Promise<boolean> {
    await this.db
      .deleteFrom('core.products')
      .where('id', '=', id)
      .execute();
    return true;
  }

  async count(where?: { organizationId?: string; category?: string }): Promise<number> {
    let q = this.db
      .selectFrom('core.products')
      .select(({ fn }) => fn.countAll<string>().as('count'));
    if (where?.organizationId) q = q.where('organization_id', '=', where.organizationId);
    if (where?.category) q = q.where('category', '=', where.category);
    const result = await q.executeTakeFirst();
    return Number(result?.count ?? 0);
  }

  private map(row: any): Product {
    return {
      id: row.id,
      sku: row.sku,
      name: row.name,
      category: row.category,
      unitPrice: Number.parseFloat(row.unit_price.toString()),
      organizationId: row.organization_id ?? undefined,
      createdAt: row.created_at,
    };
  }
}
