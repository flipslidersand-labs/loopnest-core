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
// Type Exports
// ============================================
export type ApprovalRequest = typeof approvalRequests.$inferSelect;
export type ApprovalRequestInsert = typeof approvalRequests.$inferInsert;
export type ApprovalStep = typeof approvalSteps.$inferSelect;
export type ApprovalStepInsert = typeof approvalSteps.$inferInsert;
