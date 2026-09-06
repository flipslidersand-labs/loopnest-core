-- Migration 020: Add LISTEN/NOTIFY trigger on outbox_events INSERT
-- When a new event is inserted, NOTIFY 'loopnest_outbox' so EventWorker
-- can wake up immediately instead of waiting for the next poll interval.

CREATE OR REPLACE FUNCTION events.notify_outbox_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify('loopnest_outbox', NEW.id::text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_outbox_notify ON events.outbox_events;
CREATE TRIGGER trg_outbox_notify
  AFTER INSERT ON events.outbox_events
  FOR EACH ROW
  EXECUTE FUNCTION events.notify_outbox_insert();
