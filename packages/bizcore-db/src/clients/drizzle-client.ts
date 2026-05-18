import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../../drizzle/schema.js';

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'loopnest',
  password: process.env.POSTGRES_PASSWORD || 'loopnest_dev_password',
  database: process.env.POSTGRES_DB || 'omni_local',
});

export const drizzleDb = drizzle(pool, { schema });

export async function closeDrizzle() {
  await pool.end();
}
