export interface ExchangeRate {
  currencyCode: string;
  rateToJpy: number;
  effectiveDate: Date;
  updatedAt: Date;
}

export interface ExchangeRateInput {
  currencyCode: string;
  rateToJpy: number;
  effectiveDate: Date;
}

const COLS = ['currency_code', 'rate_to_jpy', 'effective_date', 'updated_at'] as const;

export class ExchangeRateRepository {
  constructor(private db: any) {}

  async findAll(): Promise<ExchangeRate[]> {
    const rows = await this.db
      .selectFrom('core.exchange_rates')
      .select(COLS)
      .orderBy('currency_code', 'asc')
      .execute();
    return rows.map((r: any) => this.map(r));
  }

  async findByCode(code: string): Promise<ExchangeRate | null> {
    const r = await this.db
      .selectFrom('core.exchange_rates')
      .select(COLS)
      .where('currency_code', '=', code.toUpperCase())
      .executeTakeFirst();
    return r ? this.map(r) : null;
  }

  async upsert(data: ExchangeRateInput): Promise<ExchangeRate> {
    const r = await this.db
      .insertInto('core.exchange_rates')
      .values({
        currency_code: data.currencyCode.toUpperCase(),
        rate_to_jpy: data.rateToJpy.toString(),
        effective_date: data.effectiveDate,
        updated_at: new Date(),
      })
      .onConflict((oc: any) =>
        oc.column('currency_code').doUpdateSet({
          rate_to_jpy: data.rateToJpy.toString(),
          effective_date: data.effectiveDate,
          updated_at: new Date(),
        })
      )
      .returning(COLS)
      .executeTakeFirst();
    return this.map(r);
  }

  private map(r: any): ExchangeRate {
    return {
      currencyCode: r.currency_code,
      rateToJpy: parseFloat(r.rate_to_jpy.toString()),
      effectiveDate: r.effective_date,
      updatedAt: r.updated_at,
    };
  }
}
