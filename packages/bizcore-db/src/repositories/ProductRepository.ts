import { PrismaClient } from '@prisma/client';
import { BaseRepository, FindOptions, CreateInput, UpdateInput } from './BaseRepository.js';

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
  constructor(private readonly prisma: PrismaClient) {
    super();
  }

  async findById(id: string, organizationId?: string): Promise<Product | null> {
    const product = organizationId
      ? await this.prisma.product.findFirst({ where: { id, organizationId } })
      : await this.prisma.product.findUnique({ where: { id } });
    return product ? this.mapToProduct(product) : null;
  }

  async findBySku(sku: string): Promise<Product | null> {
    const product = await this.prisma.product.findUnique({ where: { sku } });
    return product ? this.mapToProduct(product) : null;
  }

  async findAll(options?: ProductFilter): Promise<Product[]> {
    const where: any = {};
    if (options?.organizationId) where.organizationId = options.organizationId;
    if ((options as any)?.category) where.category = (options as any).category;
    const products = await this.prisma.product.findMany({
      skip: options?.skip,
      take: options?.take,
      orderBy: options?.orderBy || { name: 'asc' },
      where: Object.keys(where).length ? where : undefined,
    });
    return products.map((p: any) => this.mapToProduct(p));
  }

  async findOne(where: Partial<Product>, options?: FindOptions): Promise<Product | null> {
    const product = await this.prisma.product.findFirst({
      where: {
        ...(where.category && { category: where.category }),
        ...(where.sku && { sku: where.sku }),
      },
    });
    return product ? this.mapToProduct(product) : null;
  }

  async findByCategory(category: string, options?: ProductFilter): Promise<Product[]> {
    const products = await this.prisma.product.findMany({
      where: {
        category,
        ...(options?.organizationId && { organizationId: options.organizationId }),
      },
      skip: options?.skip,
      take: options?.take,
      orderBy: options?.orderBy || { name: 'asc' },
    });
    return products.map((p: any) => this.mapToProduct(p));
  }

  async create(data: CreateInput<Product>): Promise<Product> {
    const product = await this.prisma.product.create({
      data: {
        sku: data.sku,
        name: data.name,
        category: data.category,
        unitPrice: data.unitPrice,
        organizationId: data.organizationId,
      },
    });
    return this.mapToProduct(product);
  }

  async update(id: string, data: UpdateInput<Product>): Promise<Product> {
    const product = await this.prisma.product.update({
      where: { id },
      data: {
        name: data.name,
        category: data.category,
        unitPrice: data.unitPrice,
      },
    });
    return this.mapToProduct(product);
  }

  async delete(id: string): Promise<boolean> {
    await this.prisma.product.delete({ where: { id } });
    return true;
  }

  async count(where?: { organizationId?: string; category?: string }): Promise<number> {
    const filter: any = {};
    if (where?.organizationId) filter.organizationId = where.organizationId;
    if (where?.category) filter.category = where.category;
    return this.prisma.product.count({
      where: Object.keys(filter).length ? filter : undefined,
    });
  }

  private mapToProduct(product: any): Product {
    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      category: product.category,
      unitPrice: Number.parseFloat(product.unitPrice.toString()),
      organizationId: product.organizationId ?? undefined,
      createdAt: product.createdAt,
    };
  }
}
