import { kyselyDb, closeKysely } from './clients/kysely-client.js';
import { pgPool, closePgPool } from './clients/pg-client.js';
import { redis, closeRedis } from './clients/redis-client.js';
import { RepositoryContainer } from './repositories/RepositoryContainer.js';
import type { Pool } from 'pg';
import type { Kysely } from 'kysely';
import type { KyselyDatabase } from './types/kysely-database.js';

export interface DatabaseServices {
  repos: RepositoryContainer;
  pgPool: Pool;
  kyselyDb: Kysely<KyselyDatabase>;
  close: () => Promise<void>;
}

/**
 * Initialize all database services and return repository container.
 * Call close() when shutting down the application.
 */
export async function initializeDatabaseServices(): Promise<DatabaseServices> {
  const db = kyselyDb;
  const repos = new RepositoryContainer(db);

  return {
    repos,
    pgPool,
    kyselyDb: db,
    async close() {
      await Promise.all([
        closeKysely(),
        closePgPool(),
        closeRedis(),
      ]);
    },
  };
}

/**
 * Get repository container from an existing Kysely instance (for testing).
 */
export function getRepositoryContainer(db: Kysely<KyselyDatabase>): RepositoryContainer {
  return new RepositoryContainer(db);
}
