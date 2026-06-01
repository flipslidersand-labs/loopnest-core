import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer,
  decimal,
  text,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ============================================
// workflow.approval_requests (承認依頼)
// ============================================
export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    quoteId: uuid('quote_id').notNull(),
    totalAmount: decimal('total_amount', { precision: 12, scale: 2 }).notNull(),
    routeType: varchar('route_type', { length: 50 }).notNull(), // 'standard' / 'high_value'
    status: varchar('status', { length: 50 }).notNull(), // 'pending' / 'approved' / 'rejected'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => ({
    schema: 'workflow',
  })
);

// ============================================
// workflow.approval_steps (承認ステップ)
// ============================================
export const approvalSteps = pgTable(
  'approval_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    approvalRequestId: uuid('approval_request_id').notNull(),
    stepOrder: integer('step_order').notNull(),
    approverId: uuid('approver_id').notNull(),
    status: varchar('status', { length: 50 }).notNull(), // 'pending' / 'approved' / 'rejected'
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    comment: text('comment'),
  },
  (table) => ({
    schema: 'workflow',
  })
);

// ============================================
// events.outbox_events (イベントアウトボックス)
// ============================================
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    aggregateId: varchar('aggregate_id', { length: 36 }).notNull(),
    payload: jsonb('payload').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    retryCount: integer('retry_count').notNull().default(0),
  },
  (table) => ({
    schema: 'events',
    statusCreatedIdx: index().on(table.status, table.createdAt),
  })
);

// ============================================
// finance.invoices (請求書)
// ============================================
export const invoices = pgTable(
  'invoices',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    quoteId: varchar('quote_id', { length: 36 }).notNull(),
    invoiceNumber: varchar('invoice_number', { length: 100 }).notNull(),
    customerId: varchar('customer_id', { length: 36 }).notNull(),
    subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull(),
    taxAmount: decimal('tax_amount', { precision: 12, scale: 2 }).notNull(),
    totalAmount: decimal('total_amount', { precision: 12, scale: 2 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('issued'),
    createdBy: varchar('created_by', { length: 36 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    schema: 'finance',
    quoteIdIdx: index().on(table.quoteId),
    invoiceNumberUnique: uniqueIndex().on(table.invoiceNumber),
  })
);

// ============================================
// Type Exports
// ============================================
export type ApprovalRequest = typeof approvalRequests.$inferSelect;
export type ApprovalRequestInsert = typeof approvalRequests.$inferInsert;
export type ApprovalStep = typeof approvalSteps.$inferSelect;
export type ApprovalStepInsert = typeof approvalSteps.$inferInsert;
export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type OutboxEventInsert = typeof outboxEvents.$inferInsert;
export type Invoice = typeof invoices.$inferSelect;
export type InvoiceInsert = typeof invoices.$inferInsert;
