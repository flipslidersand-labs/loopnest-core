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

export class SearchService {
  constructor(private readonly db: Kysely<KyselyDatabase>) {}

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

    // Validate and default types
    const requestedTypes = types.length > 0
      ? types.filter(t => ALLOWED_TYPES.has(t))
      : ['customer', 'product', 'quote'];

    if (requestedTypes.length === 0) {
      return { results: [], total: 0 };
    }

    const pattern = `%${query.trim()}%`;

    // Build UNION parts from requested types using Kysely sql tagged templates.
    // Each interpolated value becomes a proper bound parameter — no manual $N tracking.
    const parts: RawBuilder<unknown>[] = [];

    if (requestedTypes.includes('customer')) {
      parts.push(
        orgId
          ? sql`SELECT 'customer'::text AS type, id::text, name AS title, COALESCE(address, '') AS excerpt, created_at FROM core.customers WHERE (name ILIKE ${pattern} OR COALESCE(address, '') ILIKE ${pattern}) AND organization_id = ${orgId}`
          : sql`SELECT 'customer'::text AS type, id::text, name AS title, COALESCE(address, '') AS excerpt, created_at FROM core.customers WHERE (name ILIKE ${pattern} OR COALESCE(address, '') ILIKE ${pattern})`,
      );
    }

    if (requestedTypes.includes('product')) {
      parts.push(
        orgId
          ? sql`SELECT 'product'::text AS type, id::text, name AS title, (sku || ' · ' || category) AS excerpt, created_at FROM core.products WHERE (name ILIKE ${pattern} OR sku ILIKE ${pattern} OR category ILIKE ${pattern}) AND organization_id = ${orgId}`
          : sql`SELECT 'product'::text AS type, id::text, name AS title, (sku || ' · ' || category) AS excerpt, created_at FROM core.products WHERE (name ILIKE ${pattern} OR sku ILIKE ${pattern} OR category ILIKE ${pattern})`,
      );
    }

    if (requestedTypes.includes('quote')) {
      parts.push(
        orgId
          ? sql`SELECT 'quote'::text AS type, id::text, quote_number AS title, COALESCE(notes, '') AS excerpt, created_at FROM core.quotes WHERE (quote_number ILIKE ${pattern} OR created_by ILIKE ${pattern} OR COALESCE(notes, '') ILIKE ${pattern}) AND organization_id = ${orgId}`
          : sql`SELECT 'quote'::text AS type, id::text, quote_number AS title, COALESCE(notes, '') AS excerpt, created_at FROM core.quotes WHERE (quote_number ILIKE ${pattern} OR created_by ILIKE ${pattern} OR COALESCE(notes, '') ILIKE ${pattern})`,
      );
    }

    const cte = sql.join(parts, sql` UNION ALL `);

    const [dataResult, countResult] = await Promise.all([
      sql<{ type: string; id: string; title: string; excerpt: string | null; created_at: Date }>`
        WITH results AS (${cte})
        SELECT type, id, title, excerpt, created_at
        FROM results
        ORDER BY created_at DESC
        LIMIT ${take} OFFSET ${skip}
      `.execute(this.db),
      sql<{ count: string }>`
        WITH results AS (${cte})
        SELECT COUNT(*) AS count FROM results
      `.execute(this.db),
    ]);

    return {
      results: dataResult.rows.map((r) => ({
        type:      r.type as 'customer' | 'product' | 'quote',
        id:        r.id as string,
        title:     r.title as string,
        excerpt:   (r.excerpt as string | null) || null,
        createdAt: r.created_at as Date,
      })),
      total: Number.parseInt(countResult.rows[0].count as string, 10),
    };
  }
}
