import { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

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
// core.exchange_rates
// ============================================
export interface ExchangeRateTable {
  currency_code: string;   // ISO 4217 PK (e.g. 'USD')
  // NUMERIC column: pg returns it as a string; repositories .toString() on write.
  rate_to_jpy: ColumnType<string, string | number, string | number>;
  effective_date: Date;
  updated_at: Generated<Date>;
}

export type ExchangeRateRow = Selectable<ExchangeRateTable>;
export type NewExchangeRate = Insertable<ExchangeRateTable>;
export type ExchangeRateUpdate = Updateable<ExchangeRateTable>;

// ============================================
// core.organizations
// ============================================
export interface OrganizationTable {
  id: Generated<string>;
  name: string;
  type: string; // 'company' | 'department' | 'division'
  parent_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export type OrganizationRow = Selectable<OrganizationTable>;
export type NewOrganization = Insertable<OrganizationTable>;
export type OrganizationUpdate = Updateable<OrganizationTable>;

// ============================================
// core.customers
// ============================================
export interface CustomerTable {
  id: Generated<string>;
  name: string;
  contact_email: string | null;
  phone: string | null;
  address: string | null;
  organization_id: string | null;
  credit_limit: number | null;
  credit_used: Generated<number>;
  created_at: Generated<Date>;
  portal_password_hash: string | null;
}

export type CustomerRow = Selectable<CustomerTable>;
export type NewCustomer = Insertable<CustomerTable>;
export type CustomerUpdate = Updateable<CustomerTable>;

// ============================================
// core.products
// ============================================
export interface ProductTable {
  id: Generated<string>;
  sku: string;
  name: string;
  category: string;
  unit_price: number;
  stock_quantity: Generated<number>;
  organization_id: string | null;
  created_at: Generated<Date>;
}

export type ProductRow = Selectable<ProductTable>;
export type NewProduct = Insertable<ProductTable>;
export type ProductUpdate = Updateable<ProductTable>;

// ============================================
// core.users
// ============================================
export interface UserTable {
  id: Generated<string>;
  email: string;
  name: string;
  name_en: string | null;
  organization_id: string;
  role: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date | null>;
}

export type UserRow = Selectable<UserTable>;
export type NewUser = Insertable<UserTable>;
export type UserUpdate = Updateable<UserTable>;

// ============================================
// core.quotes
// ============================================
export interface QuoteTable {
  id: Generated<string>;
  quote_number: string;
  quote_request_id: string | null;
  customer_id: string;
  organization_id: string | null;
  subtotal_amount: number;
  tax_amount: number;
  total_amount: number;
  discount_type: string | null;
  discount_value: number | null;
  discount_amount: number | null;
  expires_at: Date | null;
  status: string;
  notes: string | null;
  created_by: string;
  currency: Generated<string>;        // ISO 4217, default 'JPY'
  exchange_rate: Generated<number>;   // rate to JPY, default 1.0
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
  discount_pct: number | null;
  discount_amt: number | null;
  notes: string | null;
  created_at: Generated<Date>;
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
  quote_id: string | null; // nullable since recurring-billing invoices have no quote (M12)
  contract_id: string | null;
  customer_id: string;
  registration_number: string;
  subtotal_amount: number;
  tax_amount: number;
  // NUMERIC column: pg returns it as a string; InvoiceRepository .toString() on write.
  discount_amount: ColumnType<string | null, string | number | null | undefined, string | number | null>;
  total_amount: number;
  issue_date: Date;
  payment_due_date: Date;
  status: string;
  paid_at: Date | null;
  currency: Generated<string>;        // ISO 4217, default 'JPY'
  exchange_rate: Generated<number>;   // rate to JPY, default 1.0
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
  discount_pct: number | null;
  discount_amt: number | null;
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
  paid_on: Date | string;
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
// events.webhook_deliveries
// ============================================
export interface WebhookDeliveryTable {
  id: Generated<string>;
  webhook_id: string;
  event_type: string;
  payload: JsonValue; // JSONB
  status: 'success' | 'failed';
  http_status: number | null;
  error_message: string | null;
  delivered_at: Generated<Date>;
}

export type WebhookDeliveryRow = Selectable<WebhookDeliveryTable>;
export type NewWebhookDelivery = Insertable<WebhookDeliveryTable>;

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
// core.tax_rates
// ============================================
export interface TaxRateTable {
  id: Generated<string>;
  name: string;
  // NUMERIC column: pg returns it as a string; repositories .toString() on write.
  rate: ColumnType<string, string | number, string | number>;
  is_default: Generated<boolean>;
  valid_from: Generated<Date>;
  valid_to: Date | null;
  created_at: Generated<Date>;
}

export type TaxRateRow = Selectable<TaxRateTable>;
export type NewTaxRate = Insertable<TaxRateTable>;
export type TaxRateUpdate = Updateable<TaxRateTable>;

// ============================================
// core.quote_templates
// ============================================
export interface QuoteTemplateTable {
  id: Generated<string>;
  name: string;
  description: string | null;
  items: Generated<JsonValue>; // JSONB array of {productId, quantity, unitPrice, notes?}
  organization_id: string | null;
  created_by: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export type QuoteTemplateRow = Selectable<QuoteTemplateTable>;
export type NewQuoteTemplate = Insertable<QuoteTemplateTable>;
export type QuoteTemplateUpdate = Updateable<QuoteTemplateTable>;

// ============================================
// finance.invoice_installments
// ============================================
export interface InstallmentTable {
  id: Generated<string>;
  invoice_id: string;
  seq: number;
  due_date: Date | string;
  // NUMERIC column: pg returns it as a string; repositories .toString() on write.
  amount: ColumnType<string, string | number, string | number>;
  status: Generated<string>; // 'pending' | 'paid' | 'cancelled'
  paid_at: Date | null;
  created_at: Generated<Date>;
}

export type InstallmentRow = Selectable<InstallmentTable>;
export type NewInstallment = Insertable<InstallmentTable>;
export type InstallmentUpdate = Updateable<InstallmentTable>;

// ============================================
// core.recurring_contracts
// ============================================
export interface RecurringContractTable {
  id: Generated<string>;
  customer_id: string;
  name: string;
  description: string | null;
  interval_unit: string; // 'day' | 'week' | 'month' | 'year'
  interval_value: number;
  // NUMERIC columns: pg returns them as strings; repositories .toString() on write.
  amount: ColumnType<string, string | number, string | number>;
  tax_rate: ColumnType<string, string | number, string | number>;
  status: Generated<string>; // 'active' | 'paused' | 'cancelled' | 'completed'
  starts_at: Date | string;
  ends_at: Date | string | null;
  next_billing_at: Date | string;
  line_items: Generated<JsonValue>; // JSONB array of { name, quantity, unit_price }
  pause_reason: string | null;
  pause_until: Date | string | null;
  created_by: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export type RecurringContractRow = Selectable<RecurringContractTable>;
export type NewRecurringContract = Insertable<RecurringContractTable>;
export type RecurringContractUpdate = Updateable<RecurringContractTable>;

// ============================================
// core.dunning_rules / finance.dunning_logs
// ============================================
export interface DunningRuleTable {
  id: Generated<string>;
  name: string;
  days_overdue: number;
  action: Generated<string>; // 'reminder' | 'warning' | 'suspend' | 'collection'
  message_template: string | null;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export type DunningRuleRow = Selectable<DunningRuleTable>;
export type NewDunningRule = Insertable<DunningRuleTable>;
export type DunningRuleUpdate = Updateable<DunningRuleTable>;

export interface DunningLogTable {
  id: Generated<string>;
  invoice_id: string;
  rule_id: string;
  days_overdue: number;
  action: string;
  sent_at: Generated<Date>;
}

export type DunningLogRow = Selectable<DunningLogTable>;
export type NewDunningLog = Insertable<DunningLogTable>;

// ============================================
// Database Schema
// ============================================
export interface KyselyDatabase {
  'core.exchange_rates': ExchangeRateTable;
  'core.quote_requests': QuoteRequestTable;
  'core.organizations': OrganizationTable;
  'core.customers': CustomerTable;
  'core.products': ProductTable;
  'core.users': UserTable;
  'core.quotes': QuoteTable;
  'core.quote_items': QuoteItemTable;
  'core.tax_rates': TaxRateTable;
  'core.quote_templates': QuoteTemplateTable;
  'core.recurring_contracts': RecurringContractTable;
  'core.dunning_rules': DunningRuleTable;
  'finance.invoices': InvoiceTable;
  'finance.invoice_items': InvoiceItemTable;
  'finance.invoice_installments': InstallmentTable;
  'finance.accounting_exports': AccountingExportTable;
  'finance.payments': PaymentTable;
  'finance.credit_notes': CreditNoteTable;
  'finance.credit_note_applications': CreditNoteApplicationTable;
  'finance.dunning_logs': DunningLogTable;
  'events.outbox_events': OutboxEventTable;
  'events.webhooks': WebhookTable;
  'events.webhook_deliveries': WebhookDeliveryTable;
  'workflow.approval_requests': ApprovalRequestTable;
  'workflow.approval_steps': ApprovalStepTable;
}
