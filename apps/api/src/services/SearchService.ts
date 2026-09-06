export interface SearchResult {
  type: 'customer' | 'product' | 'quote';
  id: string;
  title: string;
  excerpt: string | null;
  createdAt: Date;
}

const ALLOWED_TYPES = new Set(['customer', 'product', 'quote']);

import { sql, type Kysely, type RawBuilder } from 'kysely';
import type { KyselyDatabase } from '@loopnest/bizcore-db';

interface SearchRow {
  type: string;
  id: string;
  title: string;
  excerpt: string | null;
  created_at: Date;
}

export class SearchService {
  constructor(private readonly kyselyDb: Kysely<KyselyDatabase>) {}

  async search(
    query: string,
    types: string[],
    skip = 0,
    take = 20,
    orgId?: string
  ): Promise<{ results: SearchResult[]; total: number }> {
    if (!query || query.trim().length === 0) {
      return { results: [], total: 0 };
    }

    const requestedTypes = types.length > 0
      ? types.filter(t => ALLOWED_TYPES.has(t))
      : ['customer', 'product', 'quote'];

    if (requestedTypes.length === 0) {
      return { results: [], total: 0 };
    }

    const pattern = `%${query.trim()}%`;
    const orgFilter: RawBuilder<unknown> = orgId
      ? sql`AND organization_id = ${orgId}`
      : sql``;

    const parts: RawBuilder<unknown>[] = [];

    if (requestedTypes.includes('customer')) {
      parts.push(sql`
        SELECT 'customer'::text AS type,
               id::text,
               name AS title,
               COALESCE(address, '') AS excerpt,
               created_at
        FROM core.customers
        WHERE (name ILIKE ${pattern} OR COALESCE(address, '') ILIKE ${pattern})
          ${orgFilter}
      `);
    }

    if (requestedTypes.includes('product')) {
      parts.push(sql`
        SELECT 'product'::text AS type,
               id::text,
               name AS title,
               (sku || ' · ' || category) AS excerpt,
               created_at
        FROM core.products
        WHERE (name ILIKE ${pattern} OR sku ILIKE ${pattern} OR category ILIKE ${pattern})
          ${orgFilter}
      `);
    }

    if (requestedTypes.includes('quote')) {
      parts.push(sql`
        SELECT 'quote'::text AS type,
               id::text,
               quote_number AS title,
               COALESCE(notes, '') AS excerpt,
               created_at
        FROM core.quotes
        WHERE (quote_number ILIKE ${pattern} OR created_by ILIKE ${pattern} OR COALESCE(notes, '') ILIKE ${pattern})
          ${orgFilter}
      `);
    }

    const cte = sql.join(parts, sql` UNION ALL `);

    const [dataResult, countResult] = await Promise.all([
      sql<SearchRow>`
        WITH results AS (${cte})
        SELECT type, id, title, excerpt, created_at
        FROM results
        ORDER BY created_at DESC
        LIMIT ${take} OFFSET ${skip}
      `.execute(this.kyselyDb),
      sql<{ count: string }>`
        WITH results AS (${cte}) SELECT COUNT(*) FROM results
      `.execute(this.kyselyDb),
    ]);

    return {
      results: dataResult.rows.map((r) => ({
        type:      r.type as SearchResult['type'],
        id:        r.id,
        title:     r.title,
        excerpt:   r.excerpt || null,
        createdAt: r.created_at,
      })),
      total: Number.parseInt(countResult.rows[0].count, 10),
    };
  }
}
