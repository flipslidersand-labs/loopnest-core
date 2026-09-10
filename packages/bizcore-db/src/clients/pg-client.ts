import { Pool } from 'pg';

/**
 * The single pg.Pool for this process — also used as the Kysely dialect's
 * pool (see kysely-client.ts). Previously each client created its own Pool
 * against the same DB, doubling idle connection usage per replica (#124).
 *
 * node-postgres defaults connectionTimeoutMillis to 0 (no timeout), so a
 * connection-acquire attempt against an unreachable Postgres hangs forever —
 * this is what makes GET /ready (which runs `pgPool.query('SELECT 1')` with
 * no wrapper of its own) hang during a DB outage instead of failing fast.
 */
const pgPool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'loopnest',
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB || 'omni_local',
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});

pgPool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

export { pgPool };

let ended = false;

/** Idempotent — safe to call from both closePgPool() and closeKysely() since
 * they now share this one pool. */
export async function closePgPool() {
  if (ended) return;
  ended = true;
  await pgPool.end();
}
