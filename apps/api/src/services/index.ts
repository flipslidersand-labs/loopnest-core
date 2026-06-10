export { QuoteService, type QuoteWorkflowAction } from './QuoteService.js';
export { ApprovalService, type ApprovalRequest, type ApprovalStep } from './ApprovalService.js';
export { InvoiceService, type InvoiceCreationResult } from './InvoiceService.js';
export { AuditService, type AuditLogEntry } from './AuditService.js';
export { ReportingService } from './ReportingService.js';
export { WebhookService } from './WebhookService.js';
export { SearchService } from './SearchService.js';
export { PaymentService, type RecordPaymentInput, type InvoiceBalance } from './PaymentService.js';
export { EventWorker } from './EventWorker.js';

import { RepositoryContainer } from '@loopnest/bizcore-db';
import { QuoteService } from './QuoteService.js';
import { ApprovalService } from './ApprovalService.js';
import { InvoiceService } from './InvoiceService.js';
import { AuditService } from './AuditService.js';
import { ReportingService } from './ReportingService.js';
import { WebhookService } from './WebhookService.js';
import { SearchService } from './SearchService.js';
import { PaymentService } from './PaymentService.js';
import { EventWorker } from './EventWorker.js';

export class ServiceContainer {
  readonly quotes: QuoteService;
  readonly approvals: ApprovalService;
  readonly invoices: InvoiceService;
  readonly audit: AuditService;
  readonly reporting: ReportingService;
  readonly webhooks: WebhookService;
  readonly search: SearchService;
  readonly payments: PaymentService;
  readonly eventWorker: EventWorker;

  constructor(
    repos: RepositoryContainer,
    pgPool: any,
    kyselyDb: any
  ) {
    this.quotes = new QuoteService(repos);
    this.approvals = new ApprovalService(repos, kyselyDb);
    this.invoices = new InvoiceService(repos);
    this.audit = new AuditService(pgPool);
    this.reporting = new ReportingService(pgPool);
    this.webhooks = new WebhookService(repos.webhooks);
    this.search = new SearchService(pgPool);
    this.payments = new PaymentService(repos, kyselyDb);
    this.eventWorker = new EventWorker(repos, pgPool, this.webhooks);
  }

  async close(): Promise<void> {
    this.eventWorker.stop();
  }
}
