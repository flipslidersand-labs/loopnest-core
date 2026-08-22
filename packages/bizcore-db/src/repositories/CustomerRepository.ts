import { PrismaClient } from '@prisma/client';
import { BaseRepository, FindOptions, CreateInput, UpdateInput } from './BaseRepository.js';

export interface Customer {
  id: string;
  name: string;
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

  /** Set or clear a customer's credit limit. Pass null to make unlimited. */
  async setCreditLimit(id: string, creditLimit: number | null): Promise<Customer | null> {
    const customer = await this.prisma.customer.update({
      where: { id },
      data: { creditLimit },
    }).catch(() => null);
    return customer ? this.mapToCustomer(customer) : null;
  }

  /** Atomically increment credit_used. Returns updated customer. */
  async incrementCreditUsed(id: string, amount: number): Promise<Customer | null> {
    const customer = await this.prisma.customer.update({
      where: { id },
      data: { creditUsed: { increment: amount } },
    }).catch(() => null);
    return customer ? this.mapToCustomer(customer) : null;
  }

  /** Atomically decrement credit_used (on payment). Floor at 0. */
  async decrementCreditUsed(id: string, amount: number): Promise<Customer | null> {
    const raw = await this.prisma.customer.findUnique({ where: { id } });
    if (!raw) return null;
    const current = raw.creditUsed ? Number(raw.creditUsed.toString()) : 0;
    const next = Math.max(0, current - amount);
    const customer = await this.prisma.customer.update({
      where: { id },
      data: { creditUsed: next },
    });
    return this.mapToCustomer(customer);
  }

  /** Compute credit status snapshot for a customer. */
  async getCreditStatus(id: string): Promise<CreditStatus | null> {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) return null;
    const limit = customer.creditLimit ? Number(customer.creditLimit.toString()) : null;
    const used = customer.creditUsed ? Number(customer.creditUsed.toString()) : 0;
    return {
      customerId: id,
      creditLimit: limit,
      creditUsed: used,
      creditAvailable: limit !== null ? Math.max(0, limit - used) : null,
      isUnlimited: limit === null,
      isOverLimit: limit !== null && used > limit,
    };
  }

  private mapToCustomer(customer: any): Customer {
    return {
      id: customer.id,
      name: customer.name,
      address: customer.address,
      phone: customer.phone,
      organizationId: customer.organizationId ?? undefined,
      creditLimit: customer.creditLimit ? Number(customer.creditLimit.toString()) : null,
      creditUsed: customer.creditUsed ? Number(customer.creditUsed.toString()) : 0,
      createdAt: customer.createdAt,
    };
  }
}
