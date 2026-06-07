// Export clients
export { default as prismaCoreDb } from './clients/prisma-client.js';
export { kyselyDb, closeKysely } from './clients/kysely-client.js';
export { drizzleDb, closeDrizzle } from './clients/drizzle-client.js';
export { pgPool, closePgPool } from './clients/pg-client.js';
export { redis, closeRedis } from './clients/redis-client.js';

// Export types
export * from './types/kysely-database.js';

// Export Drizzle schema and types (selectively to avoid conflicts)
export { outboxEvents, invoices, approvalRequests, approvalSteps } from '../drizzle/schema.js';
export type { OutboxEventInsert, ApprovalRequest, ApprovalRequestInsert, ApprovalStep, ApprovalStepInsert } from '../drizzle/schema.js';

// Export repositories
export { BaseRepository, OrganizationRepository, CustomerRepository, ProductRepository, QuoteRepository, UserRepository, InvoiceRepository, OutboxRepository, WebhookRepository, RepositoryContainer } from './repositories/index.js';
export type { FindOptions, CreateInput, UpdateInput, Organization, Customer, Product, QuoteEntity, QuoteWithItems, User, InvoiceRecord, OutboxEvent, WebhookRecord, CreateWebhookInput, UpdateWebhookInput } from './repositories/index.js';

// Export factory
export { initializeDatabaseServices, getRepositoryContainer } from './factory.js';
export type { DatabaseServices } from './factory.js';
