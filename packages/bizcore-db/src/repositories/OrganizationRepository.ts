import type { Kysely } from 'kysely';
import type { KyselyDatabase } from '../types/kysely-database.js';
import { BaseRepository, FindOptions, CreateInput, UpdateInput } from './BaseRepository.js';
import { randomUUID } from 'node:crypto';

export interface Organization {
  id: string;
  name: string;
  type: 'company' | 'department' | 'division';
  parentId: string | null;
  createdAt: Date;
}

export class OrganizationRepository extends BaseRepository<Organization> {
  constructor(private db: Kysely<KyselyDatabase>) {
    super();
  }

  async findById(id: string): Promise<Organization | null> {
    const row = await this.db
      .selectFrom('core.organizations')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? this.map(row) : null;
  }

  async findAll(options?: FindOptions): Promise<Organization[]> {
    let q = this.db.selectFrom('core.organizations').selectAll().orderBy('name', 'asc');
    if (options?.skip) q = q.offset(options.skip);
    if (options?.take) q = q.limit(options.take);
    const rows = await q.execute();
    return rows.map(r => this.map(r));
  }

  async findOne(where: Partial<Organization>, options?: FindOptions): Promise<Organization | null> {
    let q = this.db.selectFrom('core.organizations').selectAll();
    if (where.name) q = q.where('name', '=', where.name);
    if (where.type) q = q.where('type', '=', where.type);
    const row = await q.executeTakeFirst();
    return row ? this.map(row) : null;
  }

  async findChildren(parentId: string): Promise<Organization[]> {
    const rows = await this.db
      .selectFrom('core.organizations')
      .selectAll()
      .where('parent_id', '=', parentId)
      .orderBy('name', 'asc')
      .execute();
    return rows.map(r => this.map(r));
  }

  async create(data: CreateInput<Organization>): Promise<Organization> {
    const row = await this.db
      .insertInto('core.organizations')
      .values({
        id: randomUUID(),
        name: data.name,
        type: data.type,
        parent_id: data.parentId ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return this.map(row);
  }

  async update(id: string, data: UpdateInput<Organization>): Promise<Organization> {
    const row = await this.db
      .updateTable('core.organizations')
      .set({
        ...(data.name !== undefined && { name: data.name }),
        ...(data.type !== undefined && { type: data.type }),
        ...(data.parentId !== undefined && { parent_id: data.parentId }),
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return this.map(row);
  }

  async delete(id: string): Promise<boolean> {
    await this.db
      .deleteFrom('core.organizations')
      .where('id', '=', id)
      .execute();
    return true;
  }

  async count(where?: Partial<Organization>): Promise<number> {
    const result = await this.db
      .selectFrom('core.organizations')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .executeTakeFirst();
    return Number(result?.count ?? 0);
  }

  private map(row: any): Organization {
    return {
      id: row.id,
      name: row.name,
      type: row.type as Organization['type'],
      parentId: row.parent_id ?? null,
      createdAt: row.created_at,
    };
  }
}
