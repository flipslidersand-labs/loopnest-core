import { Pool } from 'pg';

const pgPool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'loopnest',
  password: process.env.POSTGRES_PASSWORD || 'loopnest_dev_password',
  database: process.env.POSTGRES_DB || 'omni_local',
});

pgPool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

export { pgPool };

export async function closePgPool() {
  await pgPool.end();
}
