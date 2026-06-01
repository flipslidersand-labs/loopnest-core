import prismaCoreDb from './clients/prisma-client.js';
import { kyselyDb, closeKysely } from './clients/kysely-client.js';
import { drizzleDb, closeDrizzle } from './clients/drizzle-client.js';
import { pgPool, closePgPool } from './clients/pg-client.js';
import { redis, closeRedis } from './clients/redis-client.js';
import { RepositoryContainer } from './repositories/RepositoryContainer.js';

export interface DatabaseServices {
  repos: RepositoryContainer;
  pgPool: any;
  drizzleDb: any;
  kyselyDb: any;
  close: () => Promise<void>;
}

/**
 * Initialize all database services and return repository container.
 * Call close() when shutting down the application.
 */
export async function initializeDatabaseServices(): Promise<DatabaseServices> {
  const prisma = prismaCoreDb;
  const db = kyselyDb;

  const repos = new RepositoryContainer(prisma, db);

  return {
    repos,
    pgPool,
    drizzleDb,
    kyselyDb: db,
    async close() {
      await Promise.all([
        prisma.$disconnect(),
        closeKysely(),
        closeDrizzle(),
        closePgPool(),
        closeRedis(),
      ]);
    },
  };
}

/**
 * Get repository container from existing clients (for testing or advanced usage).
 */
export function getRepositoryContainer(prisma: any, db: any): RepositoryContainer {
  return new RepositoryContainer(prisma, db);
}
