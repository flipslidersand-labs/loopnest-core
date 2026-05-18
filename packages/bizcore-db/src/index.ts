// Export clients
export { default as prismaCoreDb } from './clients/prisma-client.js';
export { kyselyDb, closeKysely } from './clients/kysely-client.js';
export { drizzleDb, closeDrizzle } from './clients/drizzle-client.js';
export { pgPool, closePgPool } from './clients/pg-client.js';
export { redis, closeRedis } from './clients/redis-client.js';

// Export types
export * from './types/kysely-database.js';

// Export Drizzle schema and types
export * from '../drizzle/schema.js';
