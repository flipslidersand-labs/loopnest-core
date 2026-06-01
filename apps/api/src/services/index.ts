export { QuoteService, type QuoteWorkflowAction } from './QuoteService.js';
export { ApprovalService, type ApprovalRequest, type ApprovalStep } from './ApprovalService.js';
export { InvoiceService, type InvoiceCreationResult } from './InvoiceService.js';
export { AuditService, type AuditLogEntry } from './AuditService.js';
export { EventWorker } from './EventWorker.js';

import { RepositoryContainer } from '@loopnest/bizcore-db';
import { QuoteService } from './QuoteService.js';
import { ApprovalService } from './ApprovalService.js';
import { InvoiceService } from './InvoiceService.js';
import { AuditService } from './AuditService.js';
import { EventWorker } from './EventWorker.js';

/**
 * Service container - provides all business logic services
 */
export class ServiceContainer {
  readonly quotes: QuoteService;
  readonly approvals: ApprovalService;
  readonly invoices: InvoiceService;
  readonly audit: AuditService;
  readonly eventWorker: EventWorker;

  constructor(
    repos: RepositoryContainer,
    pgPool: any,
    drizzleDb: any
  ) {
    this.quotes = new QuoteService(repos);
    this.approvals = new ApprovalService(repos, drizzleDb);
    this.invoices = new InvoiceService(repos);
    this.audit = new AuditService(pgPool);
    this.eventWorker = new EventWorker(repos);
  }

  async close(): Promise<void> {
    this.eventWorker.stop();
  }
}
