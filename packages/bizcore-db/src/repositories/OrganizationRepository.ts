import { PrismaClient } from '@prisma/client';
import { BaseRepository, FindOptions, CreateInput, UpdateInput } from './BaseRepository.js';

export interface Organization {
  id: string;
  name: string;
  type: 'company' | 'department' | 'division';
  parentId: string | null;
  createdAt: Date;
}

export class OrganizationRepository extends BaseRepository<Organization> {
  constructor(private prisma: PrismaClient) {
    super();
  }

  async findById(id: string): Promise<Organization | null> {
    const org = await this.prisma.organization.findUnique({
      where: { id },
    });
    return org ? this.mapToOrganization(org) : null;
  }

  async findAll(options?: FindOptions): Promise<Organization[]> {
    const orgs = await this.prisma.organization.findMany({
      skip: options?.skip,
      take: options?.take,
      orderBy: options?.orderBy || { name: 'asc' },
    });
    return orgs.map((org: any) => this.mapToOrganization(org));
  }

  async findOne(where: Partial<Organization>, options?: FindOptions): Promise<Organization | null> {
    const org = await this.prisma.organization.findFirst({
      where: {
        ...(where.name && { name: where.name }),
        ...(where.type && { type: where.type }),
      },
    });
    return org ? this.mapToOrganization(org) : null;
  }

  async findChildren(parentId: string): Promise<Organization[]> {
    const orgs = await this.prisma.organization.findMany({
      where: { parentId },
      orderBy: { name: 'asc' },
    });
    return orgs.map((org: any) => this.mapToOrganization(org));
  }

  async create(data: CreateInput<Organization>): Promise<Organization> {
    const org = await this.prisma.organization.create({
      data: {
        name: data.name,
        type: data.type,
        parentId: data.parentId,
      },
    });
    return this.mapToOrganization(org);
  }

  async update(id: string, data: UpdateInput<Organization>): Promise<Organization> {
    const org = await this.prisma.organization.update({
      where: { id },
      data: {
        name: data.name,
        type: data.type,
        parentId: data.parentId,
      },
    });
    return this.mapToOrganization(org);
  }

  async delete(id: string): Promise<boolean> {
    await this.prisma.organization.delete({
      where: { id },
    });
    return true;
  }

  async count(where?: Partial<Organization>): Promise<number> {
    return this.prisma.organization.count();
  }

  private mapToOrganization(org: any): Organization {
    return {
      id: org.id,
      name: org.name,
      type: org.type,
      parentId: org.parentId,
      createdAt: org.createdAt,
    };
  }
}
