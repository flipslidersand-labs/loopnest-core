// Export clients
export { kyselyDb, setKyselyQueryObserver } from './clients/kysely-client.js';
export { pgPool, closePgPool } from './clients/pg-client.js';
export { redis, closeRedis } from './clients/redis-client.js';

// Export types
export * from './types/kysely-database.js';
export type { Kysely } from 'kysely';

// Export repositories
export { BaseRepository, OrganizationRepository, CustomerRepository, hashPortalPassword, verifyPortalPassword, ProductRepository, QuoteRepository, UserRepository, InvoiceRepository, OutboxRepository, WebhookRepository, WebhookDeliveryRepository, PaymentRepository, CreditNoteRepository, RepositoryContainer } from './repositories/index.js';
export type { FindOptions, CreateInput, UpdateInput, Organization, Customer, Product, QuoteEntity, QuoteWithItems, User, InvoiceRecord, OutboxEvent, WebhookRecord, CreateWebhookInput, UpdateWebhookInput, WebhookDeliveryRecord, CreateWebhookDeliveryInput, WebhookDeliveryFilter, DeliveryStatus, PaymentRecord, PaymentInput, PaymentFilter, PaymentMethod, PaymentStatus, CreditNoteRecord, CreditNoteApplicationRecord, CreditNoteInput, CreditNoteApplicationInput, CreditNoteFilter, CreditNoteType, CreditNoteStatus } from './repositories/index.js';

// Export factory
export { initializeDatabaseServices, getRepositoryContainer } from './factory.js';
export type { DatabaseServices } from './factory.js';

export { encodeCursor, decodeCursor, makeCursor } from './utils/cursor.js';
export type { CursorPayload } from './utils/cursor.js';
