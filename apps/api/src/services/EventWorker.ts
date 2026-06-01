import { RepositoryContainer } from '@loopnest/bizcore-db';

export class EventWorker {
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(private repos: RepositoryContainer) {}

  start(intervalMs: number = 5000): void {
    console.log(`🔄 EventWorker started (interval: ${intervalMs}ms)`);
    this.timer = setInterval(() => this.processBatch(), intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('⏸️  EventWorker stopped');
    }
  }

  private async processBatch(): Promise<void> {
    if (this.isProcessing) return;

    this.isProcessing = true;
    try {
      const events = await this.repos.outbox.claimPending(50);

      if (events.length > 0) {
        console.log(`📨 Processing ${events.length} pending events`);
      }

      for (const event of events) {
        try {
          await this.dispatch(event);
          await this.repos.outbox.markProcessed(event.id);
        } catch (error) {
          console.error(`❌ Failed to dispatch event ${event.id}:`, error);
          await this.repos.outbox.markFailed(event.id);
        }
      }
    } catch (error) {
      console.error('❌ Error in EventWorker batch processing:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  private async dispatch(event: any): Promise<void> {
    const { eventType, aggregateId, payload } = event;

    switch (eventType) {
      case 'quote_submitted':
        await this.handleQuoteSubmitted(aggregateId, payload);
        break;
      case 'quote_approved':
        await this.handleQuoteApproved(aggregateId, payload);
        break;
      case 'quote_rejected':
        await this.handleQuoteRejected(aggregateId, payload);
        break;
      case 'invoice_created':
        await this.handleInvoiceCreated(aggregateId, payload);
        break;
      default:
        console.warn(`Unknown event type: ${eventType}`);
    }
  }

  private async handleQuoteSubmitted(quoteId: string, payload: any): Promise<void> {
    console.log(`✅ Quote submitted: ${quoteId}`);
  }

  private async handleQuoteApproved(quoteId: string, payload: any): Promise<void> {
    console.log(`✅ Quote approved: ${quoteId}`);
  }

  private async handleQuoteRejected(quoteId: string, payload: any): Promise<void> {
    console.log(`❌ Quote rejected: ${quoteId}`);
  }

  private async handleInvoiceCreated(quoteId: string, payload: any): Promise<void> {
    console.log(`✅ Invoice created for quote: ${quoteId}`, payload);

    try {
      const mockAccountingApiUrl = process.env.MOCK_ACCOUNTING_API_URL || 'http://localhost:3001';
      const response = await fetch(`${mockAccountingApiUrl}/api/exports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteId,
          invoiceId: payload.invoiceId,
          invoiceNumber: payload.invoiceNumber,
          customerId: payload.customerId,
          totalAmount: payload.totalAmount,
          exportedAt: new Date().toISOString(),
        }),
      });
      if (response.ok) {
        console.log(`📤 Exported to accounting API for invoice ${payload.invoiceNumber}`);
      }
    } catch (error) {
      console.warn(`⚠️  Could not export to accounting API:`, error);
    }
  }
}
