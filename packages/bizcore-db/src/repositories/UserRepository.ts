import type { Kysely } from 'kysely';
import type { KyselyDatabase } from '../types/kysely-database.js';
import { BaseRepository, FindOptions, CreateInput, UpdateInput } from './BaseRepository.js';
import { randomUUID } from 'node:crypto';

export interface User {
  id: string;
  name: string;
  nameEn?: string;
  email: string;
  organizationId?: string;
  role: string;
  createdAt: Date;
  updatedAt: Date;
}

export class UserRepository extends BaseRepository<User> {
  constructor(private db: Kysely<KyselyDatabase>) {
    super();
  }

  async findById(id: string): Promise<User | null> {
    const row = await this.db
      .selectFrom('core.users')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? this.map(row) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.db
      .selectFrom('core.users')
      .selectAll()
      .where('email', '=', email)
      .executeTakeFirst();
    return row ? this.map(row) : null;
  }

  async findAll(options?: FindOptions): Promise<User[]> {
    let q = this.db.selectFrom('core.users').selectAll().orderBy('name', 'asc');
    if (options?.skip) q = q.offset(options.skip);
    if (options?.take) q = q.limit(options.take);
    const rows = await q.execute();
    return rows.map(r => this.map(r));
  }

  async findOne(where: Partial<User>, options?: FindOptions): Promise<User | null> {
    let q = this.db.selectFrom('core.users').selectAll();
    if (where.email) q = q.where('email', '=', where.email);
    if (where.role)  q = q.where('role', '=', where.role);
    const row = await q.executeTakeFirst();
    return row ? this.map(row) : null;
  }

  async findByOrganization(organizationId: string, options?: FindOptions): Promise<User[]> {
    let q = this.db
      .selectFrom('core.users')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .orderBy('name', 'asc');
    if (options?.skip) q = q.offset(options.skip);
    if (options?.take) q = q.limit(options.take);
    const rows = await q.execute();
    return rows.map(r => this.map(r));
  }

  async findByRole(role: User['role'], options?: FindOptions): Promise<User[]> {
    let q = this.db
      .selectFrom('core.users')
      .selectAll()
      .where('role', '=', role)
      .orderBy('name', 'asc');
    if (options?.skip) q = q.offset(options.skip);
    if (options?.take) q = q.limit(options.take);
    const rows = await q.execute();
    return rows.map(r => this.map(r));
  }

  async create(data: CreateInput<User>): Promise<User> {
    const row = await this.db
      .insertInto('core.users')
      .values({
        id: randomUUID(),
        name: data.name,
        name_en: data.nameEn ?? null,
        email: data.email,
        organization_id: data.organizationId ?? '',
        role: data.role,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return this.map(row);
  }

  async update(id: string, data: UpdateInput<User>): Promise<User> {
    const row = await this.db
      .updateTable('core.users')
      .set({
        ...(data.name !== undefined && { name: data.name }),
        ...(data.email !== undefined && { email: data.email }),
        ...(data.organizationId !== undefined && { organization_id: data.organizationId }),
        ...(data.role !== undefined && { role: data.role }),
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return this.map(row);
  }

  async delete(id: string): Promise<boolean> {
    await this.db
      .deleteFrom('core.users')
      .where('id', '=', id)
      .execute();
    return true;
  }

  async count(where?: Partial<Pick<User, 'role' | 'organizationId'>>): Promise<number> {
    let q = this.db
      .selectFrom('core.users')
      .select(({ fn }) => fn.countAll<string>().as('count'));
    if (where?.role) q = q.where('role', '=', where.role);
    if (where?.organizationId) q = q.where('organization_id', '=', where.organizationId);
    const result = await q.executeTakeFirst();
    return Number(result?.count ?? 0);
  }

  private map(row: any): User {
    return {
      id: row.id,
      name: row.name,
      nameEn: row.name_en ?? undefined,
      email: row.email,
      organizationId: row.organization_id ?? undefined,
      role: row.role,
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? row.created_at,
    };
  }
}
