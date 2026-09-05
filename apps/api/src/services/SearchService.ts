export interface SearchResult {
  type: 'customer' | 'product' | 'quote';
  id: string;
  title: string;
  excerpt: string | null;
  createdAt: Date;
}

const ALLOWED_TYPES = new Set(['customer', 'product', 'quote']);

import type { PgPool } from '../lib/pg-pool-types.js';

export class SearchService {
  constructor(private readonly pgPool: PgPool) {}

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

    // Build UNION from requested types only
    const unions: string[] = [];
    const params: unknown[] = [pattern];

    const orgCondition = orgId
      ? (() => { params.push(orgId); return `AND organization_id = $${params.length}`; })()
      : '';

    if (requestedTypes.includes('customer')) {
      unions.push(`
        SELECT 'customer'::text AS type,
               id::text,
               name AS title,
               COALESCE(address, '') AS excerpt,
               created_at
        FROM core.customers
        WHERE (name ILIKE $1 OR COALESCE(address, '') ILIKE $1)
          ${orgCondition}
      `);
    }

    if (requestedTypes.includes('product')) {
      unions.push(`
        SELECT 'product'::text AS type,
               id::text,
               name AS title,
               (sku || ' · ' || category) AS excerpt,
               created_at
        FROM core.products
        WHERE (name ILIKE $1 OR sku ILIKE $1 OR category ILIKE $1)
          ${orgCondition}
      `);
    }

    if (requestedTypes.includes('quote')) {
      unions.push(`
        SELECT 'quote'::text AS type,
               id::text,
               quote_number AS title,
               COALESCE(notes, '') AS excerpt,
               created_at
        FROM core.quotes
        WHERE (quote_number ILIKE $1 OR created_by ILIKE $1 OR COALESCE(notes, '') ILIKE $1)
          ${orgCondition}
      `);
    }

    const cte = unions.join('\n      UNION ALL\n      ');

    params.push(take, skip);
    const limitParam  = params.length - 1;
    const offsetParam = params.length;

    const [dataResult, countResult] = await Promise.all([
      this.pgPool.query(
        `WITH results AS (${cte})
         SELECT type, id, title, excerpt, created_at
         FROM results
         ORDER BY created_at DESC
         LIMIT $${limitParam} OFFSET $${offsetParam}`,
        params
      ),
      this.pgPool.query(
        `WITH results AS (${cte}) SELECT COUNT(*) FROM results`,
        params.slice(0, params.length - 2) // exclude limit/offset
      ),
    ]);

    return {
      results: dataResult.rows.map((r) => ({
        type:      r.type as SearchResult['type'],
        id:        r.id as string,
        title:     r.title as string,
        excerpt:   (r.excerpt as string | null | undefined) || null,
        createdAt: r.created_at as Date,
      })),
      total: Number.parseInt(countResult.rows[0].count as string, 10),
    };
  }
}
