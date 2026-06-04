#!/usr/bin/env bash
# Outbox → accounting-API dispatch: happy path + outage/retry/recovery.
#
# This suite manages the mock accounting API (:3001) itself so it can simulate
# an outage. The API server must already be running with a fast outbox poll
# (EVENT_WORKER_INTERVAL_MS) and MOCK_ACCOUNTING_API_URL=http://localhost:3001
# (run-all.sh sets these).
set +e
source "$(dirname "$0")/lib.sh"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MOCK_PORT="${MOCK_ACCOUNTING_PORT:-3991}"
MOCK_URL="http://localhost:$MOCK_PORT"
MOCK_PID=""

start_mock() { # extra env passed through
  env "$@" MOCK_ACCOUNTING_PORT=$MOCK_PORT node "$ROOT/apps/mock-accounting-api/server.mjs" \
    > /tmp/loopnest-mock-accounting.log 2>&1 &
  MOCK_PID=$!
  until curl -s -m1 -o /dev/null "$MOCK_URL/health"; do
    kill -0 "$MOCK_PID" 2>/dev/null || { echo "mock failed to start"; cat /tmp/loopnest-mock-accounting.log; return 1; }
    sleep 0.3
  done
}
stop_mock() {
  [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null
  # wait for the port to free
  while curl -s -m1 -o /dev/null "$MOCK_URL/health"; do sleep 0.3; done
  MOCK_PID=""
}
trap stop_mock EXIT

# Poll a DB scalar until it equals an expected value or times out.
wait_for() { # <sql> <expected> <timeout_s>
  local sql=$1 expected=$2 timeout=${3:-15} waited=0
  while [ "$waited" -lt "$timeout" ]; do
    [ "$(db_scalar "$sql")" = "$expected" ] && return 0
    sleep 1; waited=$((waited + 1))
  done
  return 1
}

echo "=== Outbox → Accounting Dispatch ==="
echo ""

# The outbox is strict FIFO. Clear any backlog from prior runs so a freshly
# created event is dispatched promptly rather than starved behind old ones.
db_scalar "DELETE FROM events.outbox_events" >/dev/null

# ---------------------------------------------------------------------------
# Happy path: invoice → event dispatched → exported → recorded.
# ---------------------------------------------------------------------------
echo "Happy path"
start_mock || { fail "mock API did not start"; summary; exit 1; }

read -r QID INVOICE_ID < <(make_invoice)
EVT="SELECT status FROM events.outbox_events WHERE event_type='invoice_created' AND payload->>'invoiceId'='$INVOICE_ID'"

if wait_for "$EVT" "processed" 15; then
  pass "invoice_created event reached 'processed'"
else
  fail "event not processed (status=$(db_scalar "$EVT"))"
fi

EXPORTED=$(curl -s "$MOCK_URL/api/exports/$INVOICE_ID" | jq -r '.invoiceId // "none"')
check "accounting API received the export" "$INVOICE_ID" "$EXPORTED"

SUCCESS_ROWS=$(db_scalar "SELECT count(*) FROM finance.accounting_exports WHERE invoice_id='$INVOICE_ID' AND status='success'")
check "accounting_exports has a success row" "1" "$SUCCESS_ROWS"

# ---------------------------------------------------------------------------
# Outage + retry + recovery: with the accounting API down, the event must be
# retried (re-queued, not lost); once it recovers, the event must complete.
# ---------------------------------------------------------------------------
echo ""
echo "Outage → retry → recovery"
stop_mock   # accounting API is now DOWN

read -r QID2 INVOICE_ID2 < <(make_invoice)
EVT2="SELECT status FROM events.outbox_events WHERE event_type='invoice_created' AND payload->>'invoiceId'='$INVOICE_ID2'"
RETRY2="SELECT retry_count FROM events.outbox_events WHERE event_type='invoice_created' AND payload->>'invoiceId'='$INVOICE_ID2'"

# While down, the event must NOT be 'processed', and retry_count must climb.
sleep 4
STATUS_DOWN=$(db_scalar "$EVT2")
RETRIES_DOWN=$(db_scalar "$RETRY2")
if [ "$STATUS_DOWN" != "processed" ] && [ "${RETRIES_DOWN:-0}" -ge 1 ]; then
  pass "event retried while accounting API down (status=$STATUS_DOWN, retries=$RETRIES_DOWN, not lost)"
else
  fail "event not retried as expected (status=$STATUS_DOWN, retries=$RETRIES_DOWN)"
fi

FAILED_ROWS=$(db_scalar "SELECT count(*) FROM finance.accounting_exports WHERE invoice_id='$INVOICE_ID2' AND status='failed'")
if [ "${FAILED_ROWS:-0}" -ge 1 ]; then
  pass "failed export attempt recorded ($FAILED_ROWS row/s)"
else
  fail "no failed accounting_exports row recorded"
fi

# Recover: bring the accounting API back; the event should complete.
start_mock || { fail "mock API did not restart"; summary; exit 1; }
if wait_for "$EVT2" "processed" 15; then
  pass "event recovered to 'processed' after API came back"
else
  fail "event did not recover (status=$(db_scalar "$EVT2"))"
fi
RECOVERED=$(curl -s "$MOCK_URL/api/exports/$INVOICE_ID2" | jq -r '.invoiceId // "none"')
check "export delivered after recovery" "$INVOICE_ID2" "$RECOVERED"

stop_mock
summary
