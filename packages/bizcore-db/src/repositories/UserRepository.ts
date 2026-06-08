import { PrismaClient } from '@prisma/client';
import { BaseRepository, FindOptions, CreateInput, UpdateInput } from './BaseRepository.js';

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
  constructor(private prisma: PrismaClient) {
    super();
  }

  async findById(id: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    return user ? this.mapToUser(user) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    return user ? this.mapToUser(user) : null;
  }

  async findAll(options?: FindOptions): Promise<User[]> {
    const users = await this.prisma.user.findMany({
      skip: options?.skip,
      take: options?.take,
      orderBy: options?.orderBy || { name: 'asc' },
    });
    return users.map((u: any) => this.mapToUser(u));
  }

  async findOne(where: Partial<User>, options?: FindOptions): Promise<User | null> {
    const user = await this.prisma.user.findFirst({
      where: {
        ...(where.email && { email: where.email }),
        ...(where.role && { role: where.role }),
      },
    });
    return user ? this.mapToUser(user) : null;
  }

  async findByOrganization(organizationId: string, options?: FindOptions): Promise<User[]> {
    const users = await this.prisma.user.findMany({
      where: { organizationId },
      skip: options?.skip,
      take: options?.take,
      orderBy: options?.orderBy || { name: 'asc' },
    });
    return users.map((u: any) => this.mapToUser(u));
  }

  async findByRole(role: User['role'], options?: FindOptions): Promise<User[]> {
    const users = await this.prisma.user.findMany({
      where: { role },
      skip: options?.skip,
      take: options?.take,
      orderBy: { name: 'asc' },
    });
    return users.map((u: any) => this.mapToUser(u));
  }

  async create(data: CreateInput<User>): Promise<User> {
    const user = await this.prisma.user.create({
      data: {
        name: data.name,
        nameEn: data.nameEn,
        email: data.email,
        organizationId: data.organizationId,
        role: data.role,
      },
    });
    return this.mapToUser(user);
  }

  async update(id: string, data: UpdateInput<User>): Promise<User> {
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        name: data.name,
        email: data.email,
        organizationId: data.organizationId,
        role: data.role,
      },
    });
    return this.mapToUser(user);
  }

  async delete(id: string): Promise<boolean> {
    await this.prisma.user.delete({ where: { id } });
    return true;
  }

  async count(where?: Partial<Pick<User, 'role' | 'organizationId'>>): Promise<number> {
    return this.prisma.user.count({
      where: {
        ...(where?.role ? { role: where.role } : {}),
        ...(where?.organizationId ? { organizationId: where.organizationId } : {}),
      },
    });
  }

  private mapToUser(user: any): User {
    return {
      id: user.id,
      name: user.name,
      nameEn: user.nameEn,
      email: user.email,
      organizationId: user.organizationId,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
