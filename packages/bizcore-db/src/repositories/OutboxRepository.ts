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
    payload: Record<string, any>
  ): Promise<void> {
    const id = randomUUID();
    await this.db
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

  async claimPending(limit: number = 50): Promise<OutboxEvent[]> {
    const pendingIds = await this.db
      .selectFrom('events.outbox_events')
      .select('id')
      .where((eb: any) => eb('status', '=', 'pending'))
      .orderBy('created_at', 'asc')
      .limit(limit)
      .execute();

    if (pendingIds.length === 0) {
      return [];
    }

    const ids = pendingIds.map((row: any) => row.id);

    const events = await this.db
      .updateTable('events.outbox_events')
      .set({ status: 'processing' })
      .where((eb: any) => {
        if (ids.length === 0) return eb.noWhere();
        return eb('id', 'in', ids);
      })
      .returning([
        'id',
        'event_type',
        'aggregate_id',
        'payload',
        'status',
        'created_at',
        'processed_at',
        'retry_count',
      ])
      .execute();

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
