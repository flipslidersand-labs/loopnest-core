import { PrismaClient } from '@prisma/client';

export interface QuoteItemEntity {
  id: string;
  quoteId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  createdAt: Date;
}

export interface QuoteItemInput {
  productId: string;
  quantity: number;
  unitPrice: number;
}

export class QuoteItemRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private map(r: any): QuoteItemEntity {
    return {
      id: r.id,
      quoteId: r.quoteId,
      productId: r.productId,
      quantity: r.quantity,
      unitPrice: Number(r.unitPrice),
      lineTotal: Number(r.lineTotal),
      createdAt: r.createdAt,
    };
  }

  async findByQuote(quoteId: string): Promise<QuoteItemEntity[]> {
    const items = await this.prisma.quoteItem.findMany({
      where: { quoteId },
      orderBy: { createdAt: 'asc' },
    });
    return items.map((i: any) => this.map(i));
  }

  async addItem(quoteId: string, input: QuoteItemInput): Promise<QuoteItemEntity> {
    const lineTotal = Math.round(input.quantity * input.unitPrice * 100) / 100;
    const item = await this.prisma.quoteItem.create({
      data: {
        quoteId,
        productId: input.productId,
        quantity: input.quantity,
        unitPrice: input.unitPrice,
        lineTotal,
      },
    });
    await this.recalculate(quoteId);
    return this.map(item);
  }

  async updateItem(
    itemId: string,
    quoteId: string,
    input: Partial<Pick<QuoteItemInput, 'quantity' | 'unitPrice'>>
  ): Promise<QuoteItemEntity | null> {
    const current = await this.prisma.quoteItem.findFirst({ where: { id: itemId, quoteId } });
    if (!current) return null;

    const qty = input.quantity ?? current.quantity;
    const price = input.unitPrice !== undefined ? input.unitPrice : Number(current.unitPrice);
    const lineTotal = Math.round(qty * price * 100) / 100;

    const updated = await this.prisma.quoteItem.update({
      where: { id: itemId },
      data: {
        ...(input.quantity !== undefined && { quantity: qty }),
        ...(input.unitPrice !== undefined && { unitPrice: price }),
        lineTotal,
      },
    });
    await this.recalculate(quoteId);
    return this.map(updated);
  }

  async removeItem(itemId: string, quoteId: string): Promise<boolean> {
    const exists = await this.prisma.quoteItem.findFirst({ where: { id: itemId, quoteId } });
    if (!exists) return false;
    await this.prisma.quoteItem.delete({ where: { id: itemId } });
    await this.recalculate(quoteId);
    return true;
  }

  // Recomputes subtotal / tax (10%) / total from current items.
  // Only updates quotes still in draft status.
  private async recalculate(quoteId: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE core.quotes
      SET
        subtotal_amount = COALESCE(
          (SELECT SUM(line_total) FROM core.quote_items WHERE quote_id = ${quoteId}::uuid), 0),
        tax_amount = ROUND(COALESCE(
          (SELECT SUM(line_total) FROM core.quote_items WHERE quote_id = ${quoteId}::uuid), 0) * 0.10, 2),
        total_amount = ROUND(COALESCE(
          (SELECT SUM(line_total) FROM core.quote_items WHERE quote_id = ${quoteId}::uuid), 0) * 1.10, 2)
      WHERE id = ${quoteId}::uuid AND status = 'draft'
    `;
  }
}
