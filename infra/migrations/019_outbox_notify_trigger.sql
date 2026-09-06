-- M30: LISTEN/NOTIFY trigger for the transactional outbox
-- A lightweight trigger fires pg_notify('outbox_event') on every INSERT.
-- EventWorker listens on a dedicated connection; it wakes immediately instead
-- of waiting for the next poll interval (default 5 s → ≤200 ms under light load).
-- The fallback poll (60 s by default) covers missed notifies on reconnect.

CREATE OR REPLACE FUNCTION events.notify_outbox_insert()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('outbox_event', NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_outbox_notify ON events.outbox_events;
DROP TRIGGER IF EXISTS trg_outbox_notify_retry ON events.outbox_events;

-- Fire on INSERT (new events) and on UPDATE when status transitions back to
-- 'pending' (retry re-queue). Without the UPDATE trigger, LISTEN/NOTIFY
-- would miss retried events until the 60 s fallback poll.
CREATE TRIGGER trg_outbox_notify
  AFTER INSERT ON events.outbox_events
  FOR EACH ROW EXECUTE FUNCTION events.notify_outbox_insert();

CREATE TRIGGER trg_outbox_notify_retry
  AFTER UPDATE OF status ON events.outbox_events
  FOR EACH ROW
  WHEN (NEW.status = 'pending')
  EXECUTE FUNCTION events.notify_outbox_insert();
