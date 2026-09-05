/** Minimal structural type for pg.Pool used in apps/api services. */
export interface PgPool {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
