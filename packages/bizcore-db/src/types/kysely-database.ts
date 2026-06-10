import { Generated, Insertable, Selectable, Updateable } from 'kysely';

// ============================================
// core.quote_requests
// ============================================
export interface QuoteRequestTable {
  id: Generated<string>;
  customer_id: string;
  requested_by: string;
  contact_email: string;
  requested_items: any; // JSONB
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
  metadata: any; // JSONB
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
  request_payload: any; // JSONB
  response_payload: any | null; // JSONB
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
  metadata: any | null; // JSONB
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
  payload: any; // JSONB
  status: string;
  created_at: Generated<Date>;
  processed_at: Date | null;
  retry_count: number;
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
  'events.outbox_events': OutboxEventTable;
  'events.webhooks': WebhookTable;
}
