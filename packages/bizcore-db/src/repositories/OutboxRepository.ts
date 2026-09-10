import { randomUUID } from 'crypto';

export interface OutboxEvent {
  id: string;
  eventType: string;
  aggregateId: string;
  payload: Record<string, any>;
  status: 'pending' | 'processed' | 'failed';
  createdAt: Date;
  processedAt: Date | null;
  retryCount: number;
}

export class OutboxRepository {
  constructor(private db: any) {}

  async publish(
    eventType: string,
    aggregateId: string,
    payload: Record<string, any>,
    db: any = this.db
  ): Promise<void> {
    const id = randomUUID();
    await db
      .insertInto('events.outbox_events')
      .values({
        id,
        event_type: eventType,
        aggregate_id: aggregateId,
        payload,
        status: 'pending',
        created_at: new Date(),
      })
      .execute();
  }

  /**
   * Atomically claims up to `limit` pending events by folding the previous
   * SELECT-then-UPDATE into a single statement: the candidate ids are chosen
   * with `FOR UPDATE SKIP LOCKED` inside the UPDATE's own subquery, so the row
   * selection and the 'processing' transition happen under the same row locks.
   * This closes the race where two `EventWorker` replicas polling at the same
   * time could both select the same pending ids before either one updated
   * them, and then both dispatch (e.g. `handleInvoiceCreated`, which POSTs to
   * an external, non-idempotent accounting API) the same event.
   */
  async claimPending(limit: number = 50): Promise<OutboxEvent[]> {
    const { sql } = await import('kysely');
    const result = await sql<any>`
      UPDATE events.outbox_events
      SET status = 'processing'
      WHERE id IN (
        SELECT id FROM events.outbox_events
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING
        id,
        event_type,
        aggregate_id,
        payload,
        status,
        created_at,
        processed_at,
        retry_count
    `.execute(this.db);

    const events = result.rows;

    return events.map((e: any) => ({
      id: e.id,
      eventType: e.event_type,
      aggregateId: e.aggregate_id,
      payload: e.payload,
      status: e.status,
      createdAt: e.created_at,
      processedAt: e.processed_at,
      retryCount: e.retry_count,
    }));
  }

  async markProcessed(id: string): Promise<void> {
    await this.db
      .updateTable('events.outbox_events')
      .set({ status: 'processed', processed_at: new Date() })
      .where((eb: any) => eb('id', '=', id))
      .execute();
  }

  /**
   * Record a failed dispatch. Increments retry_count and either re-queues the
   * event ('pending', picked up on the next poll) or dead-letters it ('failed')
   * once it has exhausted maxRetries. This gives at-least-once delivery with a
   * bounded number of attempts instead of losing the event on first failure.
   *
   * Done in one SQL statement so the decision is atomic w.r.t. the current
   * retry_count.
   */
  async markFailed(id: string, maxRetries: number = 5): Promise<void> {
    const { sql } = await import('kysely');
    await sql`
      UPDATE events.outbox_events
      SET retry_count = retry_count + 1,
          status = CASE WHEN retry_count + 1 >= ${maxRetries} THEN 'failed' ELSE 'pending' END,
          processed_at = NULL
      WHERE id = ${id}
    `.execute(this.db);
  }
}
