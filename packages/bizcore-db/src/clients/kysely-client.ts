import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { KyselyDatabase } from '../types/kysely-database.js';

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'loopnest',
  password: process.env.POSTGRES_PASSWORD || 'loopnest_dev_password',
  database: process.env.POSTGRES_DB || 'omni_local',
});

export const kyselyDb = new Kysely<KyselyDatabase>({
  dialect: new PostgresDialect({ pool }),
});

export async function closeKysely() {
  await pool.end();
}
