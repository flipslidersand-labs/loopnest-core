import { Pool } from 'pg';

const pgPool = new Pool({
  host:     process.env.POSTGRES_HOST     || 'localhost',
  port:     parseInt(process.env.POSTGRES_PORT || '5432'),
  user:     process.env.POSTGRES_USER     || 'loopnest',
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB       || 'omni_local',
  max:                    parseInt(process.env.PG_POOL_MAX                    || '10'),
  connectionTimeoutMillis: parseInt(process.env.PG_CONNECTION_TIMEOUT_MS     || '5000'),
  idleTimeoutMillis:       parseInt(process.env.PG_IDLE_TIMEOUT_MS            || '30000'),
  statement_timeout:       parseInt(process.env.PG_STATEMENT_TIMEOUT_MS       || '30000'),
});

pgPool.on('error', (err) => {
  console.error('Unexpected error on idle pg client', err);
});

export { pgPool };

export async function closePgPool() {
  await pgPool.end();
}
