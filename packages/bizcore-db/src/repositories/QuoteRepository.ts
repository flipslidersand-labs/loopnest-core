import { BaseRepository, FindOptions, CreateInput, UpdateInput } from './BaseRepository.js';
import { PrismaClient } from '@prisma/client';

export interface QuoteEntity {
  id: string;
  quoteNumber: string;
  quoteRequestId: string | null;
  customerId: string;
  subtotalAmount: number;
  taxAmount: number;
  totalAmount: number;
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'invoiced';
  notes?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuoteWithItems extends QuoteEntity {
  items?: Array<{
    id: string;
    productId: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
}

export class QuoteRepository extends BaseRepository<QuoteEntity> {
  constructor(
    private readonly db: any,
    private readonly prisma: PrismaClient
  ) {
    super();
  }

  async findById(id: string): Promise<QuoteEntity | null> {
    const quote = await this.prisma.quote.findUnique({
      where: { id },
    });
    return quote ? this.mapToQuote(quote) : null;
  }

  async findByNumber(quoteNumber: string): Promise<QuoteEntity | null> {
    const quote = await this.prisma.quote.findUnique({
      where: { quoteNumber },
    });
    return quote ? this.mapToQuote(quote) : null;
  }

  async findAll(options?: FindOptions): Promise<QuoteEntity[]> {
    const quotes = await this.prisma.quote.findMany({
      skip: options?.skip,
      take: options?.take,
      orderBy: options?.orderBy || { createdAt: 'desc' },
    });
    return quotes.map((q: any) => this.mapToQuote(q));
  }

  async findOne(where: Partial<QuoteEntity>, options?: FindOptions): Promise<QuoteEntity | null> {
    const quote = await this.prisma.quote.findFirst({
      where: {
        ...(where.status && { status: where.status }),
        ...(where.customerId && { customerId: where.customerId }),
      },
    });
    return quote ? this.mapToQuote(quote) : null;
  }

  async findByCustomer(customerId: string, options?: FindOptions): Promise<QuoteEntity[]> {
    const quotes = await this.prisma.quote.findMany({
      where: { customerId },
      skip: options?.skip,
      take: options?.take,
      orderBy: { createdAt: 'desc' },
    });
    return quotes.map((q: any) => this.mapToQuote(q));
  }

  async findByStatus(status: QuoteEntity['status'], options?: FindOptions): Promise<QuoteEntity[]> {
    const quotes = await this.prisma.quote.findMany({
      where: { status },
      skip: options?.skip,
      take: options?.take,
      orderBy: { createdAt: 'desc' },
    });
    return quotes.map((q: any) => this.mapToQuote(q));
  }

  async findWithItems(id: string): Promise<QuoteWithItems | null> {
    const quote = await this.prisma.quote.findUnique({
      where: { id },
      include: {
        quoteItems: {
          select: {
            id: true,
            productId: true,
            quantity: true,
            unitPrice: true,
            lineTotal: true,
          },
        },
      },
    });

    if (!quote) return null;

    return {
      ...this.mapToQuote(quote),
      items: quote.quoteItems.map((item: any) => ({
        id: item.id,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: parseFloat(item.unitPrice.toString()),
        lineTotal: parseFloat(item.lineTotal.toString()),
      })),
    };
  }

  async create(data: CreateInput<QuoteEntity>): Promise<QuoteEntity> {
    const quote = await this.prisma.quote.create({
      data: {
        quoteNumber: data.quoteNumber,
        quoteRequestId: data.quoteRequestId,
        customerId: data.customerId,
        subtotalAmount: data.subtotalAmount,
        taxAmount: data.taxAmount,
        totalAmount: data.totalAmount,
        status: data.status || 'draft',
        notes: data.notes,
        createdBy: data.createdBy,
      },
    });
    return this.mapToQuote(quote);
  }

  async update(id: string, data: UpdateInput<QuoteEntity>): Promise<QuoteEntity> {
    const quote = await this.prisma.quote.update({
      where: { id },
      data: {
        status: data.status,
        subtotalAmount: data.subtotalAmount,
        taxAmount: data.taxAmount,
        totalAmount: data.totalAmount,
        notes: data.notes,
      },
    });
    return this.mapToQuote(quote);
  }

  async delete(id: string): Promise<boolean> {
    await this.prisma.quote.delete({ where: { id } });
    return true;
  }

  async count(where?: Partial<QuoteEntity>): Promise<number> {
    return this.prisma.quote.count(
      where?.status ? { where: { status: where.status } } : undefined
    );
  }

  private mapToQuote(quote: any): QuoteEntity {
    return {
      id: quote.id,
      quoteNumber: quote.quoteNumber,
      quoteRequestId: quote.quoteRequestId,
      customerId: quote.customerId,
      subtotalAmount: quote.subtotalAmount ? parseFloat(quote.subtotalAmount.toString()) : 0,
      taxAmount: quote.taxAmount ? parseFloat(quote.taxAmount.toString()) : 0,
      totalAmount: quote.totalAmount ? parseFloat(quote.totalAmount.toString()) : 0,
      status: quote.status,
      notes: quote.notes,
      createdBy: quote.createdBy,
      createdAt: quote.createdAt,
      updatedAt: quote.updatedAt,
    };
  }
}
