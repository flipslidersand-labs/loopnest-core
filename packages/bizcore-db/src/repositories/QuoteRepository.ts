import { BaseRepository, FindOptions, CreateInput, UpdateInput } from './BaseRepository.js';
import { PrismaClient } from '@prisma/client';

export type DiscountType = 'percentage' | 'fixed';

export interface QuoteEntity {
  id: string;
  quoteNumber: string;
  quoteRequestId: string | null;
  customerId: string;
  subtotalAmount: number;
  taxAmount: number;
  totalAmount: number;
  discountType: DiscountType | null;
  discountValue: number | null;
  discountAmount: number | null;
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'invoiced';
  notes?: string;
  organizationId?: string;
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

export interface QuoteFilter extends FindOptions {
  organizationId?: string;
  status?: string;
  customerId?: string;
}

export class QuoteRepository extends BaseRepository<QuoteEntity> {
  constructor(
    private readonly db: any,
    private readonly prisma: PrismaClient
  ) {
    super();
  }

  async findById(id: string, organizationId?: string): Promise<QuoteEntity | null> {
    const quote = organizationId
      ? await this.prisma.quote.findFirst({ where: { id, organizationId } })
      : await this.prisma.quote.findUnique({ where: { id } });
    return quote ? this.mapToQuote(quote) : null;
  }

  async findByNumber(quoteNumber: string): Promise<QuoteEntity | null> {
    const quote = await this.prisma.quote.findUnique({ where: { quoteNumber } });
    return quote ? this.mapToQuote(quote) : null;
  }

  async findAll(options?: QuoteFilter): Promise<QuoteEntity[]> {
    const where: any = {};
    if (options?.organizationId) where.organizationId = options.organizationId;
    const quotes = await this.prisma.quote.findMany({
      skip: options?.skip,
      take: options?.take,
      orderBy: options?.orderBy || { createdAt: 'desc' },
      where: Object.keys(where).length ? where : undefined,
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

  async findByCustomer(customerId: string, options?: QuoteFilter): Promise<QuoteEntity[]> {
    const quotes = await this.prisma.quote.findMany({
      where: {
        customerId,
        ...(options?.organizationId && { organizationId: options.organizationId }),
      },
      skip: options?.skip,
      take: options?.take,
      orderBy: { createdAt: 'desc' },
    });
    return quotes.map((q: any) => this.mapToQuote(q));
  }

  async findByStatus(status: QuoteEntity['status'], options?: QuoteFilter): Promise<QuoteEntity[]> {
    const quotes = await this.prisma.quote.findMany({
      where: {
        status,
        ...(options?.organizationId && { organizationId: options.organizationId }),
      },
      skip: options?.skip,
      take: options?.take,
      orderBy: { createdAt: 'desc' },
    });
    return quotes.map((q: any) => this.mapToQuote(q));
  }

  async findWithItems(id: string, organizationId?: string): Promise<QuoteWithItems | null> {
    const where = organizationId ? { id, organizationId } : { id };
    const quote = await this.prisma.quote.findFirst({
      where,
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
        unitPrice: Number.parseFloat(item.unitPrice.toString()),
        lineTotal: Number.parseFloat(item.lineTotal.toString()),
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
        organizationId: data.organizationId,
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

  /**
   * Atomic conditional status transition.
   * Updates only if current status matches expectedStatus (and organizationId when scoped).
   * Returns null if the precondition failed (wrong state or wrong owner).
   */
  async transitionStatus(
    id: string,
    expectedStatus: QuoteEntity['status'],
    newStatus: QuoteEntity['status'],
    extraData?: { notes?: string },
    organizationId?: string
  ): Promise<QuoteEntity | null> {
    const result = await this.prisma.quote.updateMany({
      where: {
        id,
        status: expectedStatus,
        ...(organizationId && { organizationId }),
      },
      data: {
        status: newStatus,
        ...(extraData?.notes !== undefined && { notes: extraData.notes }),
      },
    });

    if (result.count === 0) {
      return null;
    }

    const updated = await this.prisma.quote.findUnique({ where: { id } });
    return updated ? this.mapToQuote(updated) : null;
  }

  async delete(id: string): Promise<boolean> {
    await this.prisma.quote.delete({ where: { id } });
    return true;
  }

  async count(where?: { organizationId?: string; status?: string; customerId?: string }): Promise<number> {
    const filter: any = {};
    if (where?.status) filter.status = where.status;
    if (where?.customerId) filter.customerId = where.customerId;
    if (where?.organizationId) filter.organizationId = where.organizationId;
    return this.prisma.quote.count({
      where: Object.keys(filter).length ? filter : undefined,
    });
  }

  /** Apply or update a discount on a quote (draft/pending_approval only). */
  async applyDiscount(
    id: string,
    discountType: DiscountType,
    discountValue: number
  ): Promise<QuoteEntity | null> {
    const quote = await this.prisma.quote.findUnique({ where: { id } });
    if (!quote) return null;

    const subtotal = quote.subtotalAmount ? Number.parseFloat(quote.subtotalAmount.toString()) : 0;
    const discountAmount =
      discountType === 'fixed'
        ? Math.min(discountValue, subtotal)
        : Math.round((subtotal * discountValue) / 100 * 100) / 100;

    const updated = await this.prisma.quote.update({
      where: { id },
      data: {
        discountType,
        discountValue,
        discountAmount,
      },
    });
    return this.mapToQuote(updated);
  }

  /** Remove discount from a quote. */
  async clearDiscount(id: string): Promise<QuoteEntity | null> {
    const updated = await this.prisma.quote.update({
      where: { id },
      data: { discountType: null, discountValue: null, discountAmount: null },
    }).catch(() => null);
    return updated ? this.mapToQuote(updated) : null;
  }

  private mapToQuote(quote: any): QuoteEntity {
    return {
      id: quote.id,
      quoteNumber: quote.quoteNumber,
      quoteRequestId: quote.quoteRequestId,
      customerId: quote.customerId,
      subtotalAmount: quote.subtotalAmount ? Number.parseFloat(quote.subtotalAmount.toString()) : 0,
      taxAmount: quote.taxAmount ? Number.parseFloat(quote.taxAmount.toString()) : 0,
      totalAmount: quote.totalAmount ? Number.parseFloat(quote.totalAmount.toString()) : 0,
      discountType: (quote.discountType as DiscountType | null) ?? null,
      discountValue: quote.discountValue ? Number.parseFloat(quote.discountValue.toString()) : null,
      discountAmount: quote.discountAmount ? Number.parseFloat(quote.discountAmount.toString()) : null,
      status: quote.status,
      notes: quote.notes,
      organizationId: quote.organizationId ?? undefined,
      createdBy: quote.createdBy,
      createdAt: quote.createdAt,
      updatedAt: quote.updatedAt,
    };
  }
}
