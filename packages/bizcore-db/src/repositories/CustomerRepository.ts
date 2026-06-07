import { PrismaClient } from '@prisma/client';
import { BaseRepository, FindOptions, CreateInput, UpdateInput } from './BaseRepository.js';

export interface Customer {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  organizationId?: string;
  createdAt: Date;
}

export interface CustomerFilter extends FindOptions {
  organizationId?: string;
}

export class CustomerRepository extends BaseRepository<Customer> {
  constructor(private readonly prisma: PrismaClient) {
    super();
  }

  async findById(id: string, organizationId?: string): Promise<Customer | null> {
    const customer = organizationId
      ? await this.prisma.customer.findFirst({ where: { id, organizationId } })
      : await this.prisma.customer.findUnique({ where: { id } });
    return customer ? this.mapToCustomer(customer) : null;
  }

  async findAll(options?: CustomerFilter): Promise<Customer[]> {
    const customers = await this.prisma.customer.findMany({
      skip: options?.skip,
      take: options?.take,
      orderBy: options?.orderBy || { name: 'asc' },
      where: options?.organizationId ? { organizationId: options.organizationId } : undefined,
    });
    return customers.map((c: any) => this.mapToCustomer(c));
  }

  async findOne(where: Partial<Customer>, options?: FindOptions): Promise<Customer | null> {
    const customer = await this.prisma.customer.findFirst({
      where: where.name ? { name: where.name } : {},
    });
    return customer ? this.mapToCustomer(customer) : null;
  }

  async create(data: CreateInput<Customer>): Promise<Customer> {
    const customer = await this.prisma.customer.create({
      data: {
        name: data.name,
        address: data.address,
        phone: data.phone,
        organizationId: data.organizationId,
      },
    });
    return this.mapToCustomer(customer);
  }

  async update(id: string, data: UpdateInput<Customer>): Promise<Customer> {
    const customer = await this.prisma.customer.update({
      where: { id },
      data: {
        name: data.name,
        address: data.address,
        phone: data.phone,
      },
    });
    return this.mapToCustomer(customer);
  }

  async delete(id: string): Promise<boolean> {
    await this.prisma.customer.delete({ where: { id } });
    return true;
  }

  async count(where?: { organizationId?: string }): Promise<number> {
    return this.prisma.customer.count({
      where: where?.organizationId ? { organizationId: where.organizationId } : undefined,
    });
  }

  private mapToCustomer(customer: any): Customer {
    return {
      id: customer.id,
      name: customer.name,
      address: customer.address,
      phone: customer.phone,
      organizationId: customer.organizationId ?? undefined,
      createdAt: customer.createdAt,
    };
  }
}
