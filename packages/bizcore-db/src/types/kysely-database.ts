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
// Database Schema
// ============================================
export interface KyselyDatabase {
  'core.quote_requests': QuoteRequestTable;
  'core.quotes': QuoteTable;
  'core.quote_items': QuoteItemTable;
  'finance.invoices': InvoiceTable;
  'finance.invoice_items': InvoiceItemTable;
  'finance.accounting_exports': AccountingExportTable;
}
