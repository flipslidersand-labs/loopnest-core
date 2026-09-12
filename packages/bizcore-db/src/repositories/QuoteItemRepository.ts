import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { KyselyDatabase } from '../types/kysely-database.js';
import { randomUUID } from 'node:crypto';

export interface QuoteItemEntity {
  id: string;
  quoteId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  discountPct: number | null;
  discountAmt: number | null;
  lineTotal: number;
  createdAt: Date;
}

export interface QuoteItemInput {
  productId: string;
  quantity: number;
  unitPrice: number;
  discountPct?: number | null;
  discountAmt?: number | null;
}

export class QuoteItemRepository {
  constructor(private db: Kysely<KyselyDatabase>) {}

  private map(r: any): QuoteItemEntity {
    return {
      id: r.id,
      quoteId: r.quote_id,
      productId: r.product_id,
      quantity: r.quantity,
      unitPrice: Number(r.unit_price),
      discountPct: r.discount_pct !== null && r.discount_pct !== undefined ? Number(r.discount_pct) : null,
      discountAmt: r.discount_amt !== null && r.discount_amt !== undefined ? Number(r.discount_amt) : null,
      lineTotal: Number(r.line_total),
      createdAt: r.created_at,
    };
  }

  private calcLineTotal(unitPrice: number, quantity: number, discountPct: number | null | undefined, discountAmt: number | null | undefined): number {
    const base = unitPrice * quantity;
    const afterPct = discountPct ? base * (1 - discountPct / 100) : base;
    const afterAmt = discountAmt ? afterPct - discountAmt : afterPct;
    return Math.max(0, Math.round(afterAmt * 100) / 100);
  }

  async findByQuote(quoteId: string): Promise<QuoteItemEntity[]> {
    const rows = await this.db
      .selectFrom('core.quote_items')
      .selectAll()
      .where('quote_id', '=', quoteId)
      .orderBy('created_at', 'asc')
      .execute();
    return rows.map(r => this.map(r));
  }

  async addItem(quoteId: string, input: QuoteItemInput): Promise<QuoteItemEntity> {
    if (input.discountPct != null && input.discountAmt != null) {
      throw new Error('Specify discountPct or discountAmt, not both');
    }
    const lineTotal = this.calcLineTotal(input.unitPrice, input.quantity, input.discountPct, input.discountAmt);
    const row = await this.db
      .insertInto('core.quote_items')
      .values({
        id: randomUUID(),
        quote_id: quoteId,
        product_id: input.productId,
        quantity: input.quantity,
        unit_price: input.unitPrice,
        discount_pct: input.discountPct ?? null,
        discount_amt: input.discountAmt ?? null,
        line_total: lineTotal,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.recalculate(quoteId);
    return this.map(row);
  }

  async updateItem(
    itemId: string,
    quoteId: string,
    input: Partial<Pick<QuoteItemInput, 'quantity' | 'unitPrice'>>
  ): Promise<QuoteItemEntity | null> {
    const current = await this.db
      .selectFrom('core.quote_items')
      .selectAll()
      .where('id', '=', itemId)
      .where('quote_id', '=', quoteId)
      .executeTakeFirst();
    if (!current) return null;

    const qty = input.quantity ?? current.quantity;
    const price = input.unitPrice !== undefined ? input.unitPrice : Number(current.unit_price);
    const discountPct = Number(current.discount_pct) || null;
    const discountAmt = Number(current.discount_amt) || null;
    const lineTotal = this.calcLineTotal(price, qty, discountPct, discountAmt);

    const updated = await this.db
      .updateTable('core.quote_items')
      .set({
        ...(input.quantity !== undefined && { quantity: qty }),
        ...(input.unitPrice !== undefined && { unit_price: price }),
        line_total: lineTotal,
      })
      .where('id', '=', itemId)
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.recalculate(quoteId);
    return this.map(updated);
  }

  async removeItem(itemId: string, quoteId: string): Promise<boolean> {
    const exists = await this.db
      .selectFrom('core.quote_items')
      .select('id')
      .where('id', '=', itemId)
      .where('quote_id', '=', quoteId)
      .executeTakeFirst();
    if (!exists) return false;

    await this.db
      .deleteFrom('core.quote_items')
      .where('id', '=', itemId)
      .execute();
    await this.recalculate(quoteId);
    return true;
  }

  private async recalculate(quoteId: string): Promise<void> {
    await sql`
      UPDATE core.quotes
      SET
        subtotal_amount = COALESCE(
          (SELECT SUM(line_total) FROM core.quote_items WHERE quote_id = ${quoteId}::uuid), 0),
        tax_amount = ROUND(COALESCE(
          (SELECT SUM(line_total) FROM core.quote_items WHERE quote_id = ${quoteId}::uuid), 0) * 0.10, 2),
        total_amount = ROUND(COALESCE(
          (SELECT SUM(line_total) FROM core.quote_items WHERE quote_id = ${quoteId}::uuid), 0) * 1.10, 2)
      WHERE id = ${quoteId}::uuid AND status = 'draft'
    `.execute(this.db);
  }
}
