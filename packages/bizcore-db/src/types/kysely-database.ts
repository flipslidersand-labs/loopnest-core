import { Generated, Insertable, Selectable, Updateable } from 'kysely';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

// ============================================
// core.quote_requests
// ============================================
export interface QuoteRequestTable {
  id: Generated<string>;
  customer_id: string;
  requested_by: string;
  contact_email: string;
  requested_items: JsonValue; // JSONB
  notes: string | null;
  status: string;
  created_by: string;
  created_at: Generated<Date>;
}

export type QuoteRequest = Selectable<QuoteRequestTable>;
export type NewQuoteRequest = Insertable<QuoteRequestTable>;
export type QuoteRequestUpdate = Updateable<QuoteRequestTable>;

// ============================================
// core.quotes
// ============================================
export interface QuoteTable {
  id: Generated<string>;
  quote_number: string;
  quote_request_id: string;
  customer_id: string;
  organization_id: string | null;
  subtotal_amount: number;
  tax_amount: number;
  total_amount: number;
  status: string;
  notes: string | null;
  created_by: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export type Quote = Selectable<QuoteTable>;
export type NewQuote = Insertable<QuoteTable>;
export type QuoteUpdate = Updateable<QuoteTable>;

// ============================================
// core.quote_items
// ============================================
export interface QuoteItemTable {
  id: Generated<string>;
  quote_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  notes: string | null;
}

export type QuoteItem = Selectable<QuoteItemTable>;
export type NewQuoteItem = Insertable<QuoteItemTable>;
export type QuoteItemUpdate = Updateable<QuoteItemTable>;

// ============================================
// finance.invoices
// ============================================
export interface InvoiceTable {
  id: Generated<string>;
  invoice_number: string;
  quote_id: string;
  customer_id: string;
  registration_number: string;
  subtotal_amount: number;
  tax_amount: number;
  total_amount: number;
  issue_date: Date;
  payment_due_date: Date;
  status: string;
  paid_at: Date | null;
  metadata: JsonValue | null; // JSONB
  created_by: string;
  created_at: Generated<Date>;
}

export type Invoice = Selectable<InvoiceTable>;
export type NewInvoice = Insertable<InvoiceTable>;
export type InvoiceUpdate = Updateable<InvoiceTable>;

// ============================================
// finance.invoice_items
// ============================================
export interface InvoiceItemTable {
  id: Generated<string>;
  invoice_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  notes: string | null;
}

export type InvoiceItem = Selectable<InvoiceItemTable>;
export type NewInvoiceItem = Insertable<InvoiceItemTable>;
export type InvoiceItemUpdate = Updateable<InvoiceItemTable>;

// ============================================
// finance.accounting_exports
// ============================================
export interface AccountingExportTable {
  id: Generated<string>;
  invoice_id: string;
  exported_at: Date;
  status: string;
  request_payload: JsonValue; // JSONB
  response_payload: JsonValue | null; // JSONB
  error_message: string | null;
}

export type AccountingExport = Selectable<AccountingExportTable>;
export type NewAccountingExport = Insertable<AccountingExportTable>;
export type AccountingExportUpdate = Updateable<AccountingExportTable>;

// ============================================
// finance.payments
// ============================================
export interface PaymentTable {
  id: Generated<string>;
  invoice_id: string;
  organization_id: string | null;
  amount: number;
  method: string; // 'bank_transfer' | 'credit_card' | 'cash' | 'offset'
  paid_on: Date;
  reference: string | null;
  status: string; // 'confirmed' | 'reversed'
  reversed_at: Date | null;
  reversal_reason: string | null;
  metadata: JsonValue | null; // JSONB
  created_by: string | null;
  created_at: Generated<Date>;
}

export type Payment = Selectable<PaymentTable>;
export type NewPayment = Insertable<PaymentTable>;
export type PaymentUpdate = Updateable<PaymentTable>;

// ============================================
// events.outbox_events
// ============================================
export interface OutboxEventTable {
  id: string;
  event_type: string;
  aggregate_id: string;
  payload: JsonValue; // JSONB
  status: string;
  created_at: Generated<Date>;
  processed_at: Generated<Date | null>;
  retry_count: Generated<number>;
}

export type OutboxEvent = Selectable<OutboxEventTable>;
export type NewOutboxEvent = Insertable<OutboxEventTable>;
export type OutboxEventUpdate = Updateable<OutboxEventTable>;

// ============================================
// events.webhooks
// ============================================
export interface WebhookTable {
  id: Generated<string>;
  organization_id: string | null;
  url: string;
  events: string[];
  secret: string | null;
  is_active: boolean;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export type WebhookRow = Selectable<WebhookTable>;
export type NewWebhook = Insertable<WebhookTable>;
export type WebhookUpdate = Updateable<WebhookTable>;

// ============================================
// finance.credit_notes
// ============================================
export interface CreditNoteTable {
  id: Generated<string>;
  organization_id: string | null;
  invoice_id: string | null;
  credit_number: string;
  amount: number;
  reason: string;
  cn_type: string; // 'return' | 'pricing_error' | 'goodwill' | 'adjustment'
  status: string;  // 'issued' | 'partially_applied' | 'fully_applied' | 'refunded' | 'void'
  applied_amount: number;
  refunded_amount: number;
  issued_at: Generated<Date>;
  metadata: JsonValue | null;
  created_by: string | null; // VARCHAR(255) — matches payments.created_by
  created_at: Generated<Date>;
}

export type CreditNote = Selectable<CreditNoteTable>;
export type NewCreditNote = Insertable<CreditNoteTable>;
export type CreditNoteUpdate = Updateable<CreditNoteTable>;

// ============================================
// finance.credit_note_applications
// ============================================
export interface CreditNoteApplicationTable {
  id: Generated<string>;
  credit_note_id: string;
  invoice_id: string;
  amount: number;
  applied_at: Generated<Date>;
  applied_by: string | null; // VARCHAR(255)
  notes: string | null;
}

export type CreditNoteApplication = Selectable<CreditNoteApplicationTable>;
export type NewCreditNoteApplication = Insertable<CreditNoteApplicationTable>;

// ============================================
// workflow.approval_requests
// ============================================
export interface ApprovalRequestTable {
  id: Generated<string>;
  quote_id: string;
  total_amount: string; // NUMERIC stored as string in pg driver
  route_type: string;
  status: string;
  created_at: Generated<Date>;
  completed_at: Date | null;
}

export type ApprovalRequestRow = Selectable<ApprovalRequestTable>;
export type NewApprovalRequest = Insertable<ApprovalRequestTable>;
export type ApprovalRequestUpdate = Updateable<ApprovalRequestTable>;

// ============================================
// workflow.approval_steps
// ============================================
export interface ApprovalStepTable {
  id: Generated<string>;
  approval_request_id: string;
  step_order: number;
  approver_id: string;
  status: string;
  approved_at: Date | null;
  comment: string | null;
}

export type ApprovalStepRow = Selectable<ApprovalStepTable>;
export type NewApprovalStep = Insertable<ApprovalStepTable>;
export type ApprovalStepUpdate = Updateable<ApprovalStepTable>;

// ============================================
// Database Schema
// ============================================
export interface KyselyDatabase {
  'core.quote_requests': QuoteRequestTable;
  'core.quotes': QuoteTable;
  'core.quote_items': QuoteItemTable;
  'finance.invoices': InvoiceTable;
  'finance.invoice_items': InvoiceItemTable;
  'finance.accounting_exports': AccountingExportTable;
  'finance.payments': PaymentTable;
  'finance.credit_notes': CreditNoteTable;
  'finance.credit_note_applications': CreditNoteApplicationTable;
  'events.outbox_events': OutboxEventTable;
  'events.webhooks': WebhookTable;
  'workflow.approval_requests': ApprovalRequestTable;
  'workflow.approval_steps': ApprovalStepTable;
}
