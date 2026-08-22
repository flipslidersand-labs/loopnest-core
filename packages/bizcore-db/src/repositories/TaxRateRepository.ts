import { randomUUID } from 'crypto';

export interface TaxRate {
  id: string;
  name: string;
  rate: number;
  isDefault: boolean;
  validFrom: Date;
  validTo: Date | null;
  createdAt: Date;
}

export interface TaxRateInput {
  name: string;
  rate: number;
  isDefault?: boolean;
  validFrom?: Date;
  validTo?: Date | null;
}

const COLS = ['id', 'name', 'rate', 'is_default', 'valid_from', 'valid_to', 'created_at'] as const;

export class TaxRateRepository {
  constructor(private db: any) {}

  async findAll(): Promise<TaxRate[]> {
    const rows = await this.db
      .selectFrom('core.tax_rates')
      .select(COLS)
      .orderBy('valid_from', 'desc')
      .execute();
    return rows.map((r: any) => this.map(r));
  }

  async findById(id: string): Promise<TaxRate | null> {
    const r = await this.db
      .selectFrom('core.tax_rates')
      .select(COLS)
      .where('id', '=', id)
      .executeTakeFirst();
    return r ? this.map(r) : null;
  }

  async findDefault(): Promise<TaxRate | null> {
    const r = await this.db
      .selectFrom('core.tax_rates')
      .select(COLS)
      .where('is_default', '=', true)
      .executeTakeFirst();
    return r ? this.map(r) : null;
  }

  async create(data: TaxRateInput): Promise<TaxRate> {
    const id = randomUUID();
    const r = await this.db
      .insertInto('core.tax_rates')
      .values({
        id,
        name: data.name,
        rate: data.rate.toString(),
        is_default: data.isDefault ?? false,
        valid_from: data.validFrom ?? new Date(),
        valid_to: data.validTo ?? null,
        created_at: new Date(),
      })
      .returning(COLS)
      .executeTakeFirst();
    return this.map(r);
  }

  async setDefault(id: string): Promise<TaxRate | null> {
    // Clear existing default then set new one — two statements in sequence
    await this.db
      .updateTable('core.tax_rates')
      .set({ is_default: false })
      .where('is_default', '=', true)
      .execute();
    const r = await this.db
      .updateTable('core.tax_rates')
      .set({ is_default: true })
      .where('id', '=', id)
      .returning(COLS)
      .executeTakeFirst();
    return r ? this.map(r) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('core.tax_rates')
      .where('id', '=', id)
      .where('is_default', '=', false)
      .executeTakeFirst();
    return Number(result?.numDeletedRows ?? 0) > 0;
  }

  private map(r: any): TaxRate {
    return {
      id: r.id,
      name: r.name,
      rate: parseFloat(r.rate.toString()),
      isDefault: r.is_default,
      validFrom: r.valid_from,
      validTo: r.valid_to ?? null,
      createdAt: r.created_at,
    };
  }
}
